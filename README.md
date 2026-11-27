# ConqChat

A multi-user, real-time chat application that demonstrates the TCP/IP transport layer (CSC 423 practical assignment). Users chat one-to-one from a **terminal client over raw TCP sockets** (port 5000, newline-delimited JSON) or from a **browser over WebSockets** (port 8000). Both kinds of client share the same accounts and conversations. Messages are stored in **PostgreSQL**.

**Live demo:** http://YOUR-EC2-PUBLIC-IP *(see [Deployment](#deployment))*

## Features

- Register, log in and log out (passwords hashed with Argon2; signed session cookie)
- Search users and start a private conversation
- Real-time delivery to every open device of both users over WebSockets
- Message history with paging, stored in PostgreSQL
- Automatic reconnection when the connection drops
- The last open conversation is reopened after a page refresh
- Responsive layout for desktop and mobile

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript (`fetch` + `WebSocket`) |
| Backend | Python, FastAPI, uvicorn (ASGI server) |
| Database | PostgreSQL via SQLAlchemy |
| Deployment | AWS EC2 (Ubuntu), nginx reverse proxy, systemd |

## Architecture

```
 Browser A ─┐                         AWS EC2 instance (Ubuntu)
            │  TCP :80  ┌──────────────────────────────────────────────┐
 Browser B ─┼──────────▶│ nginx ──TCP 127.0.0.1:8000──▶ uvicorn/FastAPI │
            │  HTTP +   │                                    │          │
            │  WebSocket│                      TCP :5432     ▼          │
            │           │                                PostgreSQL     │
            │           └──────────────────────────────────────────────┘
                         Security Group (firewall): only ports 22, 80 open
```

- **HTTP** (request/response) is used for login, search, conversations and loading history.
- **WebSocket** (one long-lived TCP connection per browser tab) is used to send and receive chat messages instantly. The server pushes new messages without the client asking.

## Project structure

```
app/
  main.py                 routes: HTTP API + WebSocket endpoint
  connection_manager.py   tracks open WebSockets per user, broadcasts messages
  models.py               database tables: users, conversations, messages
  schemas.py              request validation (username/password/message rules)
  security.py             password hashing
  database.py             database connection and sessions
  config.py               settings loaded from .env
static/                   frontend: index.html, style.css, app.js
tests/                    end-to-end tests (real server over TCP)
deploy/                   nginx config, systemd service, server setup script
docs/deploy-aws.md        step-by-step AWS deployment guide
```

## Running locally

**Requirements:** Python 3.12+ and PostgreSQL.

1. **Create a database** (in `psql` or pgAdmin):
   ```sql
   CREATE DATABASE private_chat;
   ```
2. **Configure:** copy `.env.example` to `.env` and fill it in:
   ```ini
   SECRET_KEY=<random string>   # generate: python -c "import secrets; print(secrets.token_hex(32))"
   DATABASE_URL=postgresql+psycopg://postgres:<your-password>@localhost:5432/private_chat
   COOKIE_SECURE=false          # true only when served over HTTPS
   ```
3. **Install** (Windows PowerShell; on macOS/Linux use `source .venv/bin/activate`):
   ```powershell
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
4. **Run:**
   ```powershell
   uvicorn app.main:app --reload
   ```
5. Open **http://127.0.0.1:8000**. Tables are created automatically on first start. To chat with yourself, use a second browser or an Incognito window and log in as another user.

## Terminal (raw TCP) client

With the server running (it opens TCP port 5000 next to the web app):

```powershell
python client/chat_client.py --host 127.0.0.1 --port 5000
/register alice password1      # or /login
/chat bob                      # then type messages
/ping   /history   /list   /quit (clean FIN)   /crash (abort with RST)
```

The message format and framing are documented in **[docs/protocol.md](docs/protocol.md)**. To watch framing live, run the server with `LOG_LEVEL=DEBUG`, then run `python tools/framing_demo.py`. Connection and error logs are written to `logs/server.log`.

| Setting (.env) | Default | Meaning |
|---|---|---|
| `TCP_HOST` | `0.0.0.0` | interface the TCP chat server listens on |
| `TCP_PORT` | `5000` | TCP chat port |
| `LOG_LEVEL` | `INFO` | `DEBUG` also logs every read and its frames |
| `LOG_FILE` | `logs/server.log` | connection/error log |

## TCP experiments and TCP/UDP comparison

- `tools/tcp_udp_compare.py`: echo server and client that send numbered messages over TCP or UDP and record received count, order, RTT and throughput (CSV in `experiments/results/`).
- `experiments/run_experiments.sh`: runs the four Wireshark experiments (handshake, loss/retransmission with `tc netem`, FIN vs RST termination, flow control/performance) on Linux and saves `.pcap` files.

## Report, diagrams and test log

- Technical report: [docs/report/ConqChat_Technical_Report.pdf](docs/report/ConqChat_Technical_Report.pdf) (Word version alongside; rebuild with `node build_report.js`)
- Application architecture diagram: [docs/diagrams/application-architecture.png](docs/diagrams/application-architecture.png)
- Test log: [docs/test-log.md](docs/test-log.md)

## Testing

```powershell
pip install -r requirements-dev.txt
python -m pytest
```

The tests start the real server on a free port with a temporary SQLite database (your PostgreSQL data is untouched) and connect over real TCP sockets. They cover:

- accounts and validation rules
- search
- conversation access control
- message history and paging
- two users chatting live over WebSockets
- invalid WebSocket events
- rejected handshakes (not logged in, or from another website)

## Deployment

The app is deployed on a single **AWS EC2** Ubuntu server:

- **nginx** listens publicly on port 80 and forwards requests (including WebSocket upgrades) to **uvicorn**, which listens privately on `127.0.0.1:8000`.
- **systemd** keeps the app running.
- **PostgreSQL** runs on the same server.

Short version, on a fresh Ubuntu 24.04 EC2 instance with ports 22 and 80 open:

```bash
git clone https://github.com/Conqy-dev/CHAT-APP.git chat-app
cd chat-app
bash deploy/setup.sh
```

The script installs everything, creates the database and secrets, starts the service and prints the public URL. Full instructions, with AWS Console steps, screenshots to take and troubleshooting, are in **[docs/deploy-aws.md](docs/deploy-aws.md)**.

**To update:** `cd ~/chat-app && git pull && bash deploy/setup.sh`

## API reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/register` | Create an account and log in |
| POST | `/api/login` | Log in |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user |
| GET | `/api/users?search=` | Search users |
| POST | `/api/conversations/{user_id}` | Start (or reopen) a conversation with a user |
| GET | `/api/conversations` | List my conversations, most recent first |
| GET | `/api/conversations/{id}/messages?limit=&before_id=` | Message history (paged) |
| POST | `/api/conversations/{id}/messages` | Send a message over HTTP (also pushed live) |
| GET | `/health` | Health check |
| WS | `/ws` | Real-time connection (requires login cookie) |

Interactive API docs: **http://127.0.0.1:8000/docs**

**WebSocket events (JSON):**

```jsonc
// client → server
{"type": "send_message", "conversation_id": 1, "content": "Hello"}

// server → both users in the conversation
{"type": "new_message", "message": {"id": 7, "conversation_id": 1, "sender_id": 2,
  "content": "Hello", "created_at": "...", "read_at": null}}

// server → sender, if the event was invalid
{"type": "error", "message": "Conversation not found"}
```
