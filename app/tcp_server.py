"""Raw TCP chat server built on asyncio.

Same accounts, conversations and live delivery as the web app, but clients talk to it
over a plain TCP socket using newline-delimited JSON (see framing.py and docs/protocol.md).
Browser users and TCP users can chat with each other: both are registered in the same
ConnectionManager."""
import asyncio
import json
import logging
import socket
from contextlib import suppress

from pydantic import ValidationError

from . import services as chat
from .connection_manager import manager
from .database import SessionLocal
from .framing import FrameTooLarge, LineFramer, encode
from .schemas import LoginRequest, RegisterRequest
from .services import ChatError

log = logging.getLogger("conqchat")

READ_SIZE = 4096    # bytes requested per read(); a frame may span several reads, or one read may hold several frames
SEND_TIMEOUT = 5    # seconds a client may stall delivery (receive window full) before it is dropped
clients: set["TCPClient"] = set()


class TCPClient:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader, self.writer = reader, writer
        host, port = writer.get_extra_info("peername")[:2]
        self.peer = f"{host}:{port}"  # the client's IP address and (ephemeral) port
        self.user_id = None
        self.username = None

    async def send_json(self, message: dict):
        self.writer.write(encode(message))
        # drain() waits while the OS send buffer is full, i.e. the client isn't reading
        # and its advertised TCP receive window is exhausted (flow control).
        await asyncio.wait_for(self.writer.drain(), SEND_TIMEOUT)

    async def error(self, message: str):
        await self.send_json({"type": "error", "message": message})


def enable_keepalive(sock: socket.socket):
    """Detect clients that vanish without FIN or RST (power loss, network gone):
    after 60 s of silence the OS sends keepalive probes and gives up after 3 misses."""
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    for option, value in (("TCP_KEEPIDLE", 60), ("TCP_KEEPINTVL", 10), ("TCP_KEEPCNT", 3)):
        if hasattr(socket, option):  # available on Linux (and recent Windows)
            with suppress(OSError):
                sock.setsockopt(socket.IPPROTO_TCP, getattr(socket, option), value)


def validation_message(error: ValidationError):
    first = error.errors()[0]
    field = first["loc"][0] if first["loc"] else "input"
    return f"{field}: {first['msg'].removeprefix('Value error, ')}"


# ---------- Commands (one per message "type") ----------

async def log_in(client: TCPClient, user):
    if client.user_id:  # switching account on the same connection
        manager.disconnect(client.user_id, client)
    client.user_id, client.username = user.id, user.username
    manager.add(user.id, client)
    log.info("TCP %s logged in as %s", client.peer, user.username)
    await client.send_json({"type": "login_ok", "user": chat.user_json(user)})


async def cmd_register(client, data, db):
    form = RegisterRequest(username=data.get("username"), password=data.get("password"))
    await log_in(client, chat.register_user(db, form.username, form.password))


async def cmd_login(client, data, db):
    form = LoginRequest(username=data.get("username"), password=data.get("password"))
    await log_in(client, chat.authenticate(db, form.username, form.password))


async def cmd_users(client, data, db):
    users = chat.search_users(db, client.user_id, str(data.get("search", ""))[:24])
    await client.send_json({"type": "users", "users": users})


async def cmd_open(client, data, db):
    username = data.get("username")
    if not isinstance(username, str) or not username.strip():
        raise ChatError(400, "username is required")
    other = chat.find_user(db, username)
    await client.send_json({"type": "conversation", **chat.open_conversation(db, client.user_id, other.id)})


async def cmd_conversations(client, data, db):
    await client.send_json({"type": "conversations", "conversations": chat.list_conversations(db, client.user_id)})


async def cmd_history(client, data, db):
    conversation_id, limit = data.get("conversation_id"), data.get("limit", 20)
    if not isinstance(conversation_id, int) or isinstance(conversation_id, bool):
        raise ChatError(400, "Invalid conversation ID")
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise ChatError(400, "limit must be a number")
    messages = chat.get_messages(db, conversation_id, client.user_id, limit=max(1, min(limit, 100)))
    await client.send_json({"type": "history", "conversation_id": conversation_id, "messages": messages})


async def cmd_send(client, data, db):
    if error := chat.event_error(data):
        raise ChatError(400, error)
    await chat.send_message(db, client.user_id, data["conversation_id"], data["content"].strip())


async def cmd_ping(client, data, db):
    await client.send_json({"type": "pong", "id": data.get("id")})  # echo the id so the client can time the round trip


async def cmd_quit(client, data, db):
    log.info("TCP %s asked to quit", client.peer)
    await client.send_json({"type": "bye"})  # the client then closes its side first (FIN)


COMMANDS = {  # type: (handler, login required?)
    "register": (cmd_register, False),
    "login": (cmd_login, False),
    "ping": (cmd_ping, False),
    "quit": (cmd_quit, False),
    "users": (cmd_users, True),
    "open": (cmd_open, True),
    "conversations": (cmd_conversations, True),
    "history": (cmd_history, True),
    "send_message": (cmd_send, True),
}


async def handle_frame(client: TCPClient, frame: bytes):
    """Decode one complete frame and run its command. Bad input gets an error reply, never a crash."""
    try:
        data = json.loads(frame.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        log.warning("TCP %s sent malformed JSON: %r", client.peer, frame[:80])
        return await client.error("Invalid JSON: send one JSON object per line")
    if not isinstance(data, dict):
        return await client.error("Invalid message format")
    command = COMMANDS.get(data.get("type"))
    if not command:
        log.warning("TCP %s sent unknown command %r", client.peer, data.get("type"))
        return await client.error("Unknown command")
    handler, login_required = command
    if login_required and not client.user_id:
        return await client.error("Log in first")

    with SessionLocal() as db:
        try:
            await handler(client, data, db)
        except ChatError as e:
            await client.error(e.message)
        except ValidationError as e:
            await client.error(validation_message(e))


# ---------- Connection lifecycle ----------

async def handle_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Runs once per accepted TCP connection (after the kernel has completed the 3-way handshake)."""
    client = TCPClient(reader, writer)
    clients.add(client)
    if sock := writer.get_extra_info("socket"):
        enable_keepalive(sock)
    log.info("TCP connect from %s (open TCP connections: %d)", client.peer, len(clients))

    framer = LineFramer()
    reason = "client closed the connection (FIN received)"
    try:
        await client.send_json({"type": "welcome", "message": "ConqChat TCP server. Send one JSON object per line."})
        while True:
            data = await reader.read(READ_SIZE)
            if not data:  # read() returns b"" at end of stream: the client sent FIN
                break
            frames = framer.feed(data)
            log.debug("TCP %s read %d bytes -> %d complete frame(s), %d byte(s) buffered",
                      client.peer, len(data), len(frames), len(framer.buffer))
            for frame in frames:
                if frame.strip():
                    await handle_frame(client, frame)
    except FrameTooLarge:
        reason = "frame too large"
        with suppress(Exception):
            await client.error("Message too large")
    except ConnectionResetError:
        reason = "connection reset by peer (RST received)"
    except TimeoutError:
        reason = "timed out (keepalive probes unanswered or client not reading)"
    except OSError as error:
        reason = f"socket error: {error}"
    except Exception:
        reason = "server error"
        log.exception("Unexpected error on TCP connection %s", client.peer)
    finally:
        clients.discard(client)
        if client.user_id:
            manager.disconnect(client.user_id, client)
        writer.close()
        with suppress(Exception):
            await writer.wait_closed()
        log.info("TCP disconnect %s user=%s reason=%s (open TCP connections: %d)",
                 client.peer, client.username or "-", reason, len(clients))


async def start_tcp_server(host: str, port: int):
    server = await asyncio.start_server(handle_connection, host, port)
    addresses = ", ".join("%s:%s" % s.getsockname()[:2] for s in server.sockets)
    log.info("TCP chat server listening on %s", addresses)
    return server


async def stop_tcp_server(server):
    server.close()  # stop accepting new connections
    for client in list(clients):
        client.writer.close()
    with suppress(TimeoutError):
        await asyncio.wait_for(server.wait_closed(), 3)
    log.info("TCP chat server stopped")
