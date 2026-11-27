"""Live demonstration of TCP message framing against the running chat server.

    python tools/framing_demo.py --host 127.0.0.1 --port 5000

1. Sends TWO complete messages in ONE write  -> the server must still answer twice.
2. Sends ONE message split over THREE writes -> the server must wait and answer once.
Run the server with LOG_LEVEL=DEBUG to see each read and how many frames it contained,
and capture with Wireshark/tcpdump to see the separate TCP segments."""
import argparse
import json
import socket
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    sock = socket.create_connection((args.host, args.port), timeout=5)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)  # send each write as its own segment
    buffer = b""

    def read_replies(expected):
        nonlocal buffer
        replies = []
        while len(replies) < expected:
            buffer += sock.recv(4096)
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                replies.append(json.loads(line))
        return replies

    print("server:", read_replies(1)[0]["message"])

    combined = b'{"type": "ping", "id": 1}\n{"type": "ping", "id": 2}\n'
    print(f"\n1) ONE write of {len(combined)} bytes containing TWO messages:\n   {combined!r}")
    sock.sendall(combined)
    for reply in read_replies(2):
        print("   reply:", reply)

    message = b'{"type": "ping", "id": 3}\n'
    parts = [message[:7], message[7:16], message[16:]]
    print(f"\n2) ONE message sent as THREE writes, 0.5 s apart:")
    for part in parts:
        print(f"   write {part!r}")
        sock.sendall(part)
        time.sleep(0.5)
    for reply in read_replies(1):
        print("   reply:", reply)

    sock.close()
    print("\nBoth cases handled: the server reassembled frames by newline, not by read() boundaries.")


if __name__ == "__main__":
    main()
