"""ConqChat command-line client: talks to the server over a raw TCP socket.

Standard library only, so it runs anywhere Python 3.10+ is installed:
    python client/chat_client.py --host <server-ip> --port 5000

Protocol: one JSON object per line (newline-delimited JSON), see docs/protocol.md."""
import argparse
import json
import os
import socket
import struct
import sys
import threading
import time

HELP = """Commands:
  /register <name> <password>   create an account (and log in)
  /login <name> <password>      log in
  /users <text>                 search for users
  /chat <name>                  open a private chat with someone; then just type to send
  /list                         your conversations
  /history                      last 20 messages of the current chat
  /ping                         measure the round-trip time to the server
  /quit                         disconnect cleanly (FIN)
  /crash                        simulate a crash: abort the connection (RST)
  /help                         show this help"""


class ChatClient:
    def __init__(self, host: str, port: int):
        # create_connection() performs the TCP 3-way handshake (SYN, SYN-ACK, ACK)
        self.sock = socket.create_connection((host, port), timeout=10)
        self.sock.settimeout(None)
        me, server = self.sock.getsockname(), self.sock.getpeername()
        print(f"Connected over TCP  {me[0]}:{me[1]}  ->  {server[0]}:{server[1]}")
        self.me = None        # logged-in user
        self.chat = None      # current conversation {"id", "other_user"}
        self.pings = {}       # ping id -> send time
        self.done = threading.Event()

    # ----- sending -----
    def send(self, **message):
        """Frame the message (JSON + newline) and write all of it to the TCP stream."""
        self.sock.sendall((json.dumps(message) + "\n").encode("utf-8"))

    # ----- receiving -----
    def receive_loop(self):
        buffer = b""
        try:
            while True:
                data = self.sock.recv(4096)       # may hold part of a message, or several
                if not data:                      # b"" = server closed its side (FIN)
                    print("\n[server closed the connection]")
                    break
                buffer += data
                while b"\n" in buffer:            # extract every complete frame
                    line, buffer = buffer.split(b"\n", 1)
                    if line.strip():
                        self.show(json.loads(line))
        except OSError as error:
            if not self.done.is_set():
                print(f"\n[connection lost: {error}]")
        finally:
            self.done.set()

    def show(self, event):
        kind = event.get("type")
        if kind == "welcome":
            print(event["message"], "Type /help for commands.")
        elif kind == "login_ok":
            self.me = event["user"]
            print(f"Logged in as {self.me['username']}")
        elif kind == "users":
            print("Users:", ", ".join(u["username"] for u in event["users"]) or "(none found)")
        elif kind == "conversation":
            self.chat = event
            print(f"Chatting with {event['other_user']['username']}. Type a message and press Enter.")
        elif kind == "conversations":
            for c in event["conversations"] or []:
                last = (c["last_message"] or {}).get("content", "")
                print(f"  {c['other_user']['username']:<24} {last[:50]}")
            if not event["conversations"]:
                print("No conversations yet. Use /chat <name>.")
        elif kind == "history":
            for m in event["messages"]:
                self.print_message(m)
        elif kind == "new_message":
            self.print_message(event["message"])
        elif kind == "pong":
            sent = self.pings.pop(event.get("id"), None)
            if sent is not None:
                print(f"pong: round-trip time {(time.perf_counter() - sent) * 1000:.1f} ms")
        elif kind == "bye":
            self.done.set()
            self.sock.close()  # we close first: our FIN starts the normal 4-way termination
        elif kind == "error":
            print(f"! {event['message']}")
        else:
            print(event)

    def print_message(self, m):
        stamp = m["created_at"][11:16]
        name = "you" if self.me and m["sender_id"] == self.me["id"] else m.get("sender_username", m["sender_id"])
        where = "" if self.chat and m["conversation_id"] == self.chat["id"] else f" (chat #{m['conversation_id']})"
        print(f"[{stamp}] {name}{where}: {m['content']}")

    # ----- user input -----
    def handle_input(self, line: str):
        if not line.startswith("/"):
            if not self.chat:
                return print("Open a chat first: /chat <name>")
            return self.send(type="send_message", conversation_id=self.chat["id"], content=line)
        command, *args = line.split()
        if command in ("/register", "/login") and len(args) == 2:
            self.send(type=command[1:], username=args[0], password=args[1])
        elif command == "/users" and args:
            self.send(type="users", search=args[0])
        elif command == "/chat" and args:
            self.send(type="open", username=args[0])
        elif command == "/list":
            self.send(type="conversations")
        elif command == "/history" and self.chat:
            self.send(type="history", conversation_id=self.chat["id"], limit=20)
        elif command == "/ping":
            ping_id = len(self.pings) + int(time.time() * 1000)
            self.pings[ping_id] = time.perf_counter()
            self.send(type="ping", id=ping_id)
        elif command == "/quit":
            self.send(type="quit")
            return False
        elif command == "/crash":
            # SO_LINGER with timeout 0 makes close() discard unsent data and send RST instead of FIN
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            self.done.set()
            self.sock.close()
            print("[connection aborted with RST]")
            return False
        else:
            print(HELP)
        return True


def main():
    parser = argparse.ArgumentParser(description="ConqChat TCP client")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    try:
        client = ChatClient(args.host, args.port)
    except OSError as error:
        sys.exit(f"Could not connect to {args.host}:{args.port}: {error}")
    threading.Thread(target=client.receive_loop, daemon=True).start()

    try:
        for line in sys.stdin:
            line = line.strip()
            if client.done.is_set():
                break
            if line and client.handle_input(line) is False:
                break
    except KeyboardInterrupt:
        pass
    except OSError as error:
        print(f"[send failed: {error}]")
    client.done.wait(timeout=3)  # give the server time to answer /quit
    try:
        client.sock.close()
    except OSError:
        pass
    os._exit(0)


if __name__ == "__main__":
    main()
