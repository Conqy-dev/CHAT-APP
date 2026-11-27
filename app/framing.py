"""Message framing for the raw TCP protocol: newline-delimited JSON (NDJSON).

TCP delivers an ordered *byte stream*, not separate messages. A single read() can
return half a message, or several messages glued together. So every message is sent
as one line of JSON ending in b"\\n", and the receiver keeps unfinished bytes in a
buffer until the newline arrives. json.dumps() escapes newlines inside strings, so a
raw b"\\n" can only ever mean "end of message"."""
import json

MAX_FRAME = 64 * 1024  # refuse absurdly long lines instead of buffering forever


class FrameTooLarge(Exception):
    pass


def encode(message: dict) -> bytes:
    """dict -> one framed message (UTF-8 JSON + newline)."""
    return (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")


class LineFramer:
    """Turns the chunks returned by successive socket reads into complete frames."""

    def __init__(self, max_frame: int = MAX_FRAME):
        self.buffer = bytearray()
        self.max_frame = max_frame

    def feed(self, data: bytes) -> list[bytes]:
        """Add newly received bytes; return every frame that is now complete (newline removed)."""
        self.buffer += data
        frames = []
        while (end := self.buffer.find(b"\n")) != -1:
            frame = bytes(self.buffer[:end])
            del self.buffer[:end + 1]
            if len(frame) > self.max_frame:
                raise FrameTooLarge
            frames.append(frame.rstrip(b"\r"))  # also accept \r\n line endings (telnet, netcat)
        if len(self.buffer) > self.max_frame:  # a "line" that never ends
            raise FrameTooLarge
        return frames
