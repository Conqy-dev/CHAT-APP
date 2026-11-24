"""Real-time tests: two users connected over WebSockets at the same time."""
import json

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect


def open_socket(base_url, client, origin=None):
    """Open a WebSocket as this logged-in user (sends their session cookie in the handshake)."""
    cookie = "; ".join(f"{k}={v}" for k, v in client.cookies.items())
    headers = {"Cookie": cookie, "Origin": origin or base_url}
    return connect(base_url.replace("http", "ws") + "/ws", additional_headers=headers)


def receive(ws):
    return json.loads(ws.recv(timeout=3))


@pytest.fixture
def chat(base_url, new_user):
    """Alice and Bob, a conversation between them, and an open socket for each."""
    alice, bob = new_user(), new_user()
    cid = alice.post(f"/api/conversations/{bob.user['id']}").json()["id"]
    with open_socket(base_url, alice) as wa, open_socket(base_url, bob) as wb:
        yield alice, bob, cid, wa, wb


def test_message_reaches_both_users_live(chat):
    alice, bob, cid, wa, wb = chat
    wa.send(json.dumps({"type": "send_message", "conversation_id": cid, "content": " hello "}))
    for ws in (wa, wb):  # sender gets it back as confirmation, receiver gets it live
        event = receive(ws)
        assert event["type"] == "new_message"
        assert event["message"]["content"] == "hello" and event["message"]["sender_id"] == alice.user["id"]
    assert bob.get(f"/api/conversations/{cid}/messages").json()[-1]["content"] == "hello"  # saved too


def test_message_sent_over_http_is_pushed_live(chat):
    alice, bob, cid, wa, wb = chat
    alice.post(f"/api/conversations/{cid}/messages", json={"content": "via http"})
    assert receive(wb)["message"]["content"] == "via http"


@pytest.mark.parametrize("event, error", [
    ([1, 2], "Invalid message format"),
    ({"type": "dance"}, "Unknown WebSocket event"),
    ({"type": "send_message", "conversation_id": "1", "content": "x"}, "Invalid conversation ID"),
    ({"type": "send_message", "conversation_id": True, "content": "x"}, "Invalid conversation ID"),
    ({"type": "send_message", "conversation_id": 1, "content": 5}, "Message must be text"),
    ({"type": "send_message", "conversation_id": 1, "content": "   "}, "Messages must contain 1–4000 characters"),
    ({"type": "send_message", "conversation_id": 1, "content": "x" * 4001}, "Messages must contain 1–4000 characters"),
    ({"type": "send_message", "conversation_id": 999999, "content": "x"}, "Conversation not found"),
])
def test_invalid_events_get_an_error_and_socket_stays_open(chat, event, error):
    *_, wa, wb = chat
    wa.send(json.dumps(event))
    assert receive(wa) == {"type": "error", "message": error}
    wa.send(json.dumps({"type": "dance"}))  # still connected afterwards
    assert receive(wa)["type"] == "error"


def test_outsider_cannot_post_into_conversation(base_url, new_user, chat):
    *_, cid, wa, wb = chat
    with open_socket(base_url, new_user()) as wc:
        wc.send(json.dumps({"type": "send_message", "conversation_id": cid, "content": "sneaky"}))
        assert receive(wc)["message"] == "You cannot access this conversation"


def test_handshake_rejected_without_login_or_from_other_site(base_url, new_user):
    import httpx
    with pytest.raises(InvalidStatus):
        open_socket(base_url, httpx.Client())  # no session cookie
    with pytest.raises(InvalidStatus):
        open_socket(base_url, new_user(), origin="http://evil.example")
