"""Raw TCP server tests: real sockets, several clients at once, framing edge cases, abrupt disconnects."""
import json
import socket
import struct
import time

import pytest
from websockets.sync.client import connect

from app.framing import LineFramer, encode


class Conn:
    """A minimal raw TCP client for tests."""

    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)  # send small writes immediately
        self.framer, self.pending = LineFramer(), []
        assert self.recv()["type"] == "welcome"

    def send(self, **message):
        self.sock.sendall(encode(message))

    def recv(self):
        while not self.pending:
            data = self.sock.recv(4096)
            assert data, "server closed the connection"
            self.pending += [json.loads(f) for f in self.framer.feed(data)]
        return self.pending.pop(0)

    def request(self, **message):
        self.send(**message)
        return self.recv()

    def abort(self):
        """Close with RST instead of FIN, like a crashed client."""
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        self.sock.close()


@pytest.fixture
def tcp(tcp_port):
    conns = []

    def make():
        conns.append(Conn(tcp_port))
        return conns[-1]

    yield make
    for c in conns:
        c.sock.close()


_n = iter(range(10**6))


def login(conn, name=None):
    name = name or f"tcp{next(_n)}_{time.time_ns() % 10**6}"
    reply = conn.request(type="register", username=name, password="password1")
    assert reply["type"] == "login_ok", reply
    return reply["user"]


def chat_between(a, b_user):
    reply = a.request(type="open", username=b_user["username"])
    assert reply["type"] == "conversation"
    return reply["id"]


def test_ping_works_without_login(tcp):
    assert tcp().request(type="ping", id=7) == {"type": "pong", "id": 7}


def test_two_tcp_users_chat_both_ways(tcp):
    a, b = tcp(), tcp()
    ua, ub = login(a), login(b)
    cid = chat_between(a, ub)
    a.send(type="send_message", conversation_id=cid, content="hi bob")
    for conn in (a, b):
        event = conn.recv()
        assert event["type"] == "new_message"
        assert event["message"]["content"] == "hi bob" and event["message"]["sender_username"] == ua["username"]
    b.send(type="send_message", conversation_id=cid, content="hi alice")
    assert a.recv()["message"]["content"] == "hi alice"
    history = a.request(type="history", conversation_id=cid)["messages"]
    assert [m["content"] for m in history] == ["hi bob", "hi alice"]


def test_tcp_and_browser_users_share_conversations(tcp, base_url, new_user):
    web_user = new_user()
    t = tcp()
    login(t)
    cid = chat_between(t, web_user.user)
    cookie = "; ".join(f"{k}={v}" for k, v in web_user.cookies.items())
    with connect(base_url.replace("http", "ws") + "/ws", additional_headers={"Cookie": cookie, "Origin": base_url}) as ws:
        t.send(type="send_message", conversation_id=cid, content="from terminal")
        assert json.loads(ws.recv(timeout=3))["message"]["content"] == "from terminal"
        ws.send(json.dumps({"type": "send_message", "conversation_id": cid, "content": "from browser"}))
        assert t.recv()["message"]["content"] in ("from terminal", "from browser")  # own echo may come first


def test_split_and_combined_frames_over_a_real_socket(tcp):
    c = tcp()
    two = encode({"type": "ping", "id": 1}) + encode({"type": "ping", "id": 2})
    c.sock.sendall(two)                                  # two messages in one write
    assert [c.recv()["id"], c.recv()["id"]] == [1, 2]
    one = encode({"type": "ping", "id": 3})
    for part in (one[:4], one[4:9], one[9:]):            # one message in three writes
        c.sock.sendall(part)
        time.sleep(0.05)
    assert c.recv() == {"type": "pong", "id": 3}


@pytest.mark.parametrize("raw, error", [
    (b"this is not json\n", "Invalid JSON: send one JSON object per line"),
    (b"\xff\xfe\n", "Invalid JSON: send one JSON object per line"),
    (b"[1, 2, 3]\n", "Invalid message format"),
    (b'{"type": "dance"}\n', "Unknown command"),
    (b'{"type": "users", "search": "a"}\n', "Log in first"),
    (b'{"type": "login", "username": "x"}\n', "username: String should have at least 3 characters"),
    (b'{"type": "register", "username": "bad name", "password": "password1"}\n',
     "username: Username can only contain letters, numbers and underscores"),
    (b'{"type": "login", "username": "nobody_here", "password": "pw"}\n', "Invalid username or password"),
])
def test_malformed_input_gets_error_and_connection_survives(tcp, raw, error):
    c = tcp()
    c.sock.sendall(raw)
    assert c.recv() == {"type": "error", "message": error}
    assert c.request(type="ping", id=1)["type"] == "pong"  # still connected and working


def test_send_message_validation_and_access(tcp):
    a, b, outsider = tcp(), tcp(), tcp()
    login(a)
    ub = login(b)
    login(outsider)
    cid = chat_between(a, ub)
    assert a.request(type="send_message", conversation_id=cid, content="  ")["message"] == \
        "Messages must contain 1–4000 characters"
    assert outsider.request(type="send_message", conversation_id=cid, content="x")["message"] == \
        "You cannot access this conversation"
    assert a.request(type="open", username="no_such_user")["message"] == "User not found"


def test_oversized_frame_closes_only_that_connection(tcp):
    bad, good = tcp(), tcp()
    bad.sock.sendall(b"x" * (70 * 1024))  # no newline, over the 64 KiB limit
    assert bad.recv() == {"type": "error", "message": "Message too large"}
    assert good.request(type="ping", id=1)["type"] == "pong"


def test_three_clients_with_reconnect_and_abrupt_disconnect(tcp, server_log):
    a, b, c = tcp(), tcp(), tcp()
    ua, ub, uc = login(a), login(b), login(c)
    ab, ac = chat_between(a, ub), chat_between(a, uc)

    c.abort()                                            # C crashes (RST) while A and B stay connected
    time.sleep(0.3)
    a.send(type="send_message", conversation_id=ab, content="still here?")
    assert b.recv()["message"]["content"] == "still here?"
    assert a.recv()["message"]["content"] == "still here?"

    c2 = tcp()                                           # C reconnects on a new connection
    assert c2.request(type="login", username=uc["username"], password="password1")["type"] == "login_ok"
    a.send(type="send_message", conversation_id=ac, content="welcome back")
    assert c2.recv()["message"]["content"] == "welcome back"
    assert a.recv()["message"]["content"] == "welcome back"
    assert c2.request(type="history", conversation_id=ac)["messages"][-1]["content"] == "welcome back"

    log = server_log.read_text(encoding="utf-8")
    assert f"logged in as {uc['username']}" in log
    assert "reason=connection reset by peer (RST received)" in log or "reason=client closed" in log


def test_clean_quit_is_logged(tcp, server_log):
    c = tcp()
    user = login(c)
    assert c.request(type="quit") == {"type": "bye"}
    c.sock.close()                                       # client closes first -> server reads EOF (FIN)
    time.sleep(0.3)
    assert f"user={user['username']} reason=client closed the connection (FIN received)" in \
        server_log.read_text(encoding="utf-8")
