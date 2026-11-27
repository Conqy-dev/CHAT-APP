# ConqChat TCP Message Protocol

**Transport:** TCP, server port **5000** (configurable with `TCP_PORT`).
**Framing:** newline-delimited JSON (NDJSON). Every message is one JSON object encoded as UTF-8 and terminated by a single `\n` (0x0A). `\r\n` is also accepted.
**Maximum frame:** 64 KiB. A longer line gets the error `Message too large`, and the connection is closed.

## Why framing is needed

TCP delivers an ordered **byte stream** with no message boundaries. One `recv()` can return:
- **part** of a message (a large message, or one sent in pieces), or
- **several** messages joined together (the sender wrote quickly, or Nagle's algorithm coalesced small writes).

The receiver ([`app/framing.py`](../app/framing.py), `LineFramer`) appends every chunk to a buffer and extracts a frame each time it finds `\n`. Unfinished bytes stay buffered until the next read. `json.dumps` escapes newlines inside strings as `\n`, so a raw `0x0A` byte can only mean "end of message".

```
bytes on the wire : {"type":"ping","id":1}\n{"type":"ping","id":2}\n{"type":"pi   ng","id":3}\n
recv() #1 returns : {"type":"ping","id":1}\n{"type":"ping","id":2}\n{"type":"pi      -> 2 frames, 12 bytes buffered
recv() #2 returns : ng","id":3}\n                                                    -> 1 frame,  0 bytes buffered
```

## Session

1. The client opens a TCP connection (3-way handshake). The server immediately sends `welcome`.
2. The client sends `register` or `login`. Only `ping` and `quit` work before logging in.
3. Either side may send at any time. The server pushes `new_message` whenever someone messages you, from a terminal or a browser.
4. **Normal close:** the client sends `quit`, the server answers `bye`, the **client closes first** (FIN), and the server reads end-of-stream and closes too.
5. **Abnormal close:**
   - a crash or abort sends RST, logged as `connection reset by peer`
   - silence with no FIN or RST is detected by TCP keepalive after about 90 s
   - a client that stops reading is dropped after a 5 s send timeout

## Client → server

| `type` | Other fields | Login? | Reply |
|---|---|---|---|
| `register` | `username` (3–24 chars: a-z, 0-9, `_`), `password` (8–128 chars) | no | `login_ok` |
| `login` | `username`, `password` | no | `login_ok` |
| `ping` | `id` (any JSON value) | no | `pong` with the same `id` |
| `quit` | none | no | `bye` |
| `users` | `search` | yes | `users` |
| `open` | `username` | yes | `conversation` (creates it on first use) |
| `conversations` | none | yes | `conversations` |
| `history` | `conversation_id`, `limit` (1–100, default 20) | yes | `history` |
| `send_message` | `conversation_id`, `content` (1–4000 chars after trimming) | yes | `new_message` to **both** members |

## Server → client

| `type` | Fields |
|---|---|
| `welcome` | `message` |
| `login_ok` | `user {id, username}` |
| `users` | `users [{id, username}]` |
| `conversation` | `id`, `other_user {id, username}` |
| `conversations` | `conversations [{id, other_user, last_message, created_at}]` |
| `history` | `conversation_id`, `messages [message]` (oldest first) |
| `new_message` | `message {id, conversation_id, sender_id, sender_username, content, created_at, read_at}` |
| `pong` | `id` |
| `bye` | none |
| `error` | `message` (human-readable; the connection stays open except for `Message too large`) |

## Example session (C = client, S = server)

```
S: {"type": "welcome", "message": "ConqChat TCP server. Send one JSON object per line."}
C: {"type": "login", "username": "julius", "password": "••••••••"}
S: {"type": "login_ok", "user": {"id": 1, "username": "julius"}}
C: {"type": "open", "username": "ada"}
S: {"type": "conversation", "id": 4, "other_user": {"id": 2, "username": "ada"}}
C: {"type": "send_message", "conversation_id": 4, "content": "Hello Ada"}
S: {"type": "new_message", "message": {"id": 31, "conversation_id": 4, "sender_id": 1, "sender_username": "julius", "content": "Hello Ada", "created_at": "2026-11-27T10:15:02+00:00", "read_at": null}}
C: {"type": "dance"}
S: {"type": "error", "message": "Unknown command"}
C: {"type": "quit"}
S: {"type": "bye"}
   (client closes: FIN →, server closes: ← FIN)
```

## Trying it without the Python client

Any tool that can open a TCP socket works. For example, with netcat:

```bash
nc <server-ip> 5000
{"type": "ping", "id": 1}
```

## Browser clients

The web interface uses the same messages over a **WebSocket** (`ws://<host>/ws`), which also runs over a single TCP connection. WebSocket has its own framing (a length-prefixed frame header), so the browser sends `send_message` and receives `new_message` and `error` without the newline. Both kinds of client are registered in the same `ConnectionManager`, so terminal and browser users can chat with each other.
