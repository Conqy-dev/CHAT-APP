"""Unit tests for newline-delimited JSON framing: TCP reads never line up with message boundaries."""
import json

import pytest

from app.framing import FrameTooLarge, LineFramer, encode


def test_one_message_split_across_several_reads():
    framer, data = LineFramer(), encode({"type": "ping", "id": 1})
    assert framer.feed(data[:3]) == []
    assert framer.feed(data[3:10]) == []
    assert framer.feed(data[10:]) == [data.rstrip(b"\n")]
    assert framer.buffer == b""


def test_several_messages_combined_in_one_read():
    framer = LineFramer()
    frames = framer.feed(encode({"n": 1}) + encode({"n": 2}) + encode({"n": 3}))
    assert [json.loads(f)["n"] for f in frames] == [1, 2, 3]


def test_combined_and_split_at_the_same_time():
    framer = LineFramer()
    stream = encode({"n": 1}) + encode({"n": 2})
    first = framer.feed(stream[:-4])          # message 1 complete, message 2 cut off
    second = framer.feed(stream[-4:])
    assert [json.loads(f)["n"] for f in first + second] == [1, 2]


def test_every_possible_split_point_gives_the_same_messages():
    stream = encode({"text": "héllo 👋"}) + encode({"text": "line\nbreak inside string"})
    for cut in range(len(stream) + 1):        # includes cuts in the middle of multi-byte UTF-8 characters
        framer = LineFramer()
        frames = framer.feed(stream[:cut]) + framer.feed(stream[cut:])
        assert [json.loads(f)["text"] for f in frames] == ["héllo 👋", "line\nbreak inside string"]


def test_crlf_and_blank_lines():
    assert LineFramer().feed(b'{"a":1}\r\n\n') == [b'{"a":1}', b""]


def test_oversized_frame_is_rejected():
    framer = LineFramer(max_frame=10)
    with pytest.raises(FrameTooLarge):
        framer.feed(b"x" * 11)                # no newline yet, but already too long
    with pytest.raises(FrameTooLarge):
        LineFramer(max_frame=10).feed(b"y" * 20 + b"\n")
