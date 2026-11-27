# ConqChat Test Log

**Environment (local runs):** Windows 11 (build 26200), Python 3.14.10, server and clients on the same machine (loopback 127.0.0.1).
**Automated suite:** `python -m pytest -v` starts the real server on free ports with a temporary SQLite database. Every test connects over real TCP sockets.
**Result of last run (27 Nov 2026):** **41 passed, 0 failed** in 6.8 s.

Status key: ✅ passed · ⏳ pending (needs the cloud deployment or the Linux test machine)

## 1. Simultaneous users

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| U1 | Two TCP clients log in and message each other in both directions | Both receive each message instantly; history stored in order | ✅ | `test_tcp.py::test_two_tcp_users_chat_both_ways` |
| U2 | Three TCP clients connected at the same time, two conversations | Each message reaches only the two members of its conversation | ✅ | `test_tcp.py::test_three_clients_with_reconnect_and_abrupt_disconnect` |
| U3 | A TCP (terminal) user and a WebSocket (browser) user chat | Messages cross between the two client types in both directions | ✅ | `test_tcp.py::test_tcp_and_browser_users_share_conversations` |
| U4 | Two browser users chat over WebSockets | Sender gets confirmation; receiver gets it live; message saved | ✅ | `test_websocket.py::test_message_reaches_both_users_live` |
| U5 | Message sent through the HTTP API | Pushed live to the other user's open WebSocket | ✅ | `test_websocket.py::test_message_sent_over_http_is_pushed_live` |
| U6 | Two people on separate devices over a phone hotspot (manual) | Both register and chat through `http://<laptop-ip>:8000` | ⏳ manual | Laptop at 172.20.10.2 on the hotspot; record the outcome here |

## 2. Reconnects and disconnects

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| R1 | Client C crashes (RST) while A and B stay connected | A↔B keep chatting; server logs `reason=connection reset by peer (RST received)` and removes C | ✅ | `test_three_clients_with_reconnect_and_abrupt_disconnect` + server log |
| R2 | C reconnects on a new TCP connection and logs in again | C receives new messages live and sees the full history | ✅ | same test |
| R3 | Clean quit: `quit` → `bye` → client closes first | Server reads end-of-stream (FIN); logs `reason=client closed the connection (FIN received)` | ✅ | `test_tcp.py::test_clean_quit_is_logged` |
| R4 | Browser loses its connection | Page shows "Reconnecting...", retries every 2 s, resumes | ⏳ manual | Stop and restart the server while the page is open; record the outcome here |

Server log extract (test run, usernames shortened):

```
INFO    TCP connect from 127.0.0.1:8777 (open TCP connections: 2)
INFO    TCP disconnect 127.0.0.1:8777 user=tcpN reason=connection reset by peer (RST received) (open TCP connections: 0)
INFO    TCP disconnect 127.0.0.1:8776 user=tcpN reason=client closed the connection (FIN received) (open TCP connections: 0)
INFO    WebSocket connect 127.0.0.1:8780 user=user9_470300
INFO    WebSocket disconnect 127.0.0.1:8780 user=user9_470300 reason=client closed
```

## 3. Malformed and invalid input

Each case is sent on a live TCP connection. The server must reply with an `error` and keep the connection working (checked by a `ping` afterwards).

| ID | Input sent | Server reply | Result |
|---|---|---|---|
| M1 | `this is not json` | `Invalid JSON: send one JSON object per line` | ✅ |
| M2 | bytes `FF FE` (invalid UTF-8) | `Invalid JSON: send one JSON object per line` | ✅ |
| M3 | `[1, 2, 3]` | `Invalid message format` | ✅ |
| M4 | `{"type": "dance"}` | `Unknown command` | ✅ |
| M5 | `users` before logging in | `Log in first` | ✅ |
| M6 | login with a 1-character username | `username: String should have at least 3 characters` | ✅ |
| M7 | register `bad name` | `username: Username can only contain letters, numbers and underscores` | ✅ |
| M8 | wrong password | `Invalid username or password` | ✅ |
| M9 | blank message / non-member sends / unknown user | `Messages must contain 1–4000 characters` · `You cannot access this conversation` · `User not found` | ✅ |
| M10 | 70 KiB with no newline | `Message too large`; only that connection closes, others unaffected | ✅ |
| M11 | 8 invalid WebSocket events (wrong types, 4001 chars, unknown conversation, …) | specific error each time; socket stays open | ✅ |
| M12 | WebSocket without login / from another website's Origin | handshake rejected (HTTP 403) | ✅ |

Tests: `test_tcp.py::test_malformed_input_gets_error_and_connection_survives` (8 cases), `test_send_message_validation_and_access`, `test_oversized_frame_closes_only_that_connection`, `test_websocket.py` (10 cases).

## 4. Split and combined messages (framing)

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| F1 | One message delivered in 3 reads | Buffered until `\n`, then exactly one frame | ✅ | `test_framing.py::test_one_message_split_across_several_reads` |
| F2 | Three messages in one read | Three frames, in order | ✅ | `test_several_messages_combined_in_one_read` |
| F3 | Split at **every** byte position, including inside multi-byte UTF-8 (`é`, `👋`) and an escaped newline inside a string | Always the same two messages | ✅ | `test_every_possible_split_point_gives_the_same_messages` |
| F4 | Real socket: 2 messages in one `sendall`, then 1 message in 3 `sendall`s with `TCP_NODELAY` | 2 replies, then 1 reply | ✅ | `test_tcp.py::test_split_and_combined_frames_over_a_real_socket` |
| F5 | Live demo (`tools/framing_demo.py`) with `LOG_LEVEL=DEBUG` | Server log shows how reads map to frames | ✅ | see below |

```
DEBUG   TCP 127.0.0.1:7721 read 52 bytes -> 2 complete frame(s), 0 byte(s) buffered
DEBUG   TCP 127.0.0.1:7721 read 7 bytes -> 0 complete frame(s), 7 byte(s) buffered
DEBUG   TCP 127.0.0.1:7721 read 9 bytes -> 0 complete frame(s), 16 byte(s) buffered
DEBUG   TCP 127.0.0.1:7721 read 10 bytes -> 1 complete frame(s), 0 byte(s) buffered
```

## 5. HTTP API and access control

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| A1 | Register, log in (case-insensitive), log out, session expiry | ✅ | `test_api.py::test_register_login_logout` |
| A2 | Duplicate username 409, invalid name and short password 422 | ✅ | `test_registration_rules` |
| A3 | Protected endpoints return 401 without login | ✅ | `test_requires_login` |
| A4 | Search excludes yourself; `_` is not a wildcard | ✅ | `test_search_excludes_self_and_treats_underscore_literally` |
| A5 | One conversation per pair; can't message yourself; unknown user 404 | ✅ | `test_conversation_rules` |
| A6 | History oldest-first, paging with `before_id`, non-member gets 403 | ✅ | `test_message_history_paging_and_privacy` |

## 6. Cloud access

| ID | Scenario | Expected | Result |
|---|---|---|---|
| C1 | Open `http://<public-ip>` from a phone on mobile data | Login page loads | ⏳ |
| C2 | Two users on different networks chat through the deployed site | Messages both ways | ⏳ |
| C3 | `chat_client.py --host <public-ip> --port 5000` from the laptop | `welcome`, login, chat with a browser user | ⏳ |
| C4 | Port 8000 and 5432 from the Internet | Connection times out (blocked by the firewall) | ⏳ |
| C5 | SSH from an IP other than the admin's | Refused | ⏳ |
| C6 | Disconnect and reconnect a client during the demo | Others unaffected; reconnect resumes | ⏳ |
