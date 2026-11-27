"""TCP vs UDP comparison tool (separate from the chat app, standard library only).

Start an echo server, then send N numbered messages and measure what comes back:
    python tools/tcp_udp_compare.py server --port 6000                 # echoes both TCP and UDP
    python tools/tcp_udp_compare.py client --proto udp --port 6000 --count 100 --label baseline
    python tools/tcp_udp_compare.py client --proto tcp --port 6000 --count 100 --label baseline

Each run writes one CSV row per message (results/<proto>_<label>.csv) and appends a
summary row to results/summary.csv: sent, received, lost, out-of-order, duplicates,
round-trip time (min/avg/p95/max) and throughput."""
import argparse
import csv
import json
import socket
import statistics
import threading
import time
from pathlib import Path


# ---------------- echo server ----------------

def serve(host, port):
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind((host, port))
    tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    tcp.bind((host, port))
    tcp.listen()
    print(f"Echo server on {host}:{port} (TCP and UDP). Ctrl+C to stop.")

    def udp_loop():
        while True:
            data, addr = udp.recvfrom(65535)   # one datagram = one message: UDP keeps boundaries
            udp.sendto(data, addr)

    def tcp_conn(conn):
        with conn:
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            while data := conn.recv(65536):    # byte stream: echo bytes as they come, framing is preserved
                conn.sendall(data)

    threading.Thread(target=udp_loop, daemon=True).start()
    try:
        while True:
            conn, _ = tcp.accept()
            threading.Thread(target=tcp_conn, args=(conn,), daemon=True).start()
    except KeyboardInterrupt:
        pass


# ---------------- client ----------------

def make_payload(seq, size):
    message = {"seq": seq, "pad": ""}
    base = len(json.dumps(message))
    message["pad"] = "x" * max(0, size - base)
    return json.dumps(message)


def run_client(args):
    sent_at, received = {}, []          # received: list of (seq, arrival_time)
    done = threading.Event()

    if args.proto == "udp":
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect((args.host, args.port))   # "connect" on UDP just fixes the destination; no handshake
        sock.settimeout(0.2)

        def receive():
            while not done.is_set():
                try:
                    data = sock.recv(65535)
                except (socket.timeout, ConnectionResetError):
                    continue
                except OSError:                 # socket closed at the end of the run
                    break
                received.append((json.loads(data)["seq"], time.perf_counter()))

        def send(payload):
            sock.send(payload.encode())
    else:
        sock = socket.create_connection((args.host, args.port), timeout=10)  # 3-way handshake happens here
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.settimeout(0.2)

        def receive():
            buffer = b""
            while not done.is_set():
                try:
                    data = sock.recv(65536)
                except socket.timeout:
                    continue
                except OSError:
                    break
                if not data:
                    break
                buffer += data
                while b"\n" in buffer:          # newline framing, same idea as the chat protocol
                    line, buffer = buffer.split(b"\n", 1)
                    received.append((json.loads(line)["seq"], time.perf_counter()))

        def send(payload):
            sock.sendall((payload + "\n").encode())

    receiver = threading.Thread(target=receive, daemon=True)
    receiver.start()

    start = time.perf_counter()
    for seq in range(1, args.count + 1):
        sent_at[seq] = time.perf_counter()
        send(make_payload(seq, args.size))
        if args.interval:
            time.sleep(args.interval)
    send_done = time.perf_counter()

    # wait for the replies: until all arrived, or nothing new for --wait seconds
    last_count, last_change = -1, time.perf_counter()
    while len(received) < args.count and time.perf_counter() - last_change < args.wait:
        if len(received) != last_count:
            last_count, last_change = len(received), time.perf_counter()
        time.sleep(0.01)
    done.set()
    receiver.join(timeout=1)                    # let the receiver notice and stop before closing
    end = max((t for _, t in received), default=send_done)
    sock.close()

    # ----- analyse -----
    rtts = {}
    arrival_order, out_of_order, duplicates, highest = [], 0, 0, 0
    for seq, t in received:
        if seq in rtts:
            duplicates += 1
            continue
        rtts[seq] = (t - sent_at[seq]) * 1000
        arrival_order.append(seq)
        if seq < highest:
            out_of_order += 1
        highest = max(highest, seq)

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    detail = out / f"{args.proto}_{args.label}.csv"
    with detail.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["seq", "received", "rtt_ms", "arrival_position"])
        position = {seq: i + 1 for i, seq in enumerate(arrival_order)}
        for seq in range(1, args.count + 1):
            w.writerow([seq, int(seq in rtts), f"{rtts[seq]:.3f}" if seq in rtts else "", position.get(seq, "")])

    values = sorted(rtts.values())
    p95 = values[int(0.95 * (len(values) - 1))] if values else 0
    summary = {
        "label": args.label, "proto": args.proto, "conditions": args.conditions, "count": args.count,
        "size_bytes": args.size, "interval_ms": args.interval * 1000,
        "received": len(rtts), "lost": args.count - len(rtts), "loss_pct": round(100 * (args.count - len(rtts)) / args.count, 1),
        "out_of_order": out_of_order, "duplicates": duplicates,
        "rtt_min_ms": round(values[0], 2) if values else "", "rtt_avg_ms": round(statistics.mean(values), 2) if values else "",
        "rtt_p95_ms": round(p95, 2) if values else "", "rtt_max_ms": round(values[-1], 2) if values else "",
        "duration_s": round(end - start, 3),
        "throughput_msg_s": round(len(rtts) / (end - start), 1) if end > start else "",
        "throughput_kbit_s": round(len(rtts) * args.size * 8 / 1000 / (end - start), 1) if end > start else "",
    }
    summary_file = out / "summary.csv"
    new = not summary_file.exists()
    with summary_file.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(summary))
        if new:
            w.writeheader()
        w.writerow(summary)

    print(f"{args.proto.upper():<4} {args.label:<18} received {summary['received']}/{args.count} "
          f"lost {summary['lost']} out-of-order {out_of_order} dup {duplicates} | "
          f"RTT avg {summary['rtt_avg_ms']} ms p95 {summary['rtt_p95_ms']} ms max {summary['rtt_max_ms']} ms | "
          f"{summary['throughput_msg_s']} msg/s")
    print(f"  details: {detail}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="mode", required=True)
    s = sub.add_parser("server")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=6000)
    c = sub.add_parser("client")
    c.add_argument("--proto", choices=["tcp", "udp"], required=True)
    c.add_argument("--host", default="127.0.0.1")
    c.add_argument("--port", type=int, default=6000)
    c.add_argument("--count", type=int, default=100)
    c.add_argument("--size", type=int, default=100, help="approximate message size in bytes")
    c.add_argument("--interval", type=float, default=0.01, help="seconds between messages (0 = as fast as possible)")
    c.add_argument("--wait", type=float, default=3.0, help="stop waiting after this many seconds without a new reply")
    c.add_argument("--label", default="run")
    c.add_argument("--conditions", default="", help="free text recorded in the summary, e.g. 'netem loss 10%%'")
    c.add_argument("--out-dir", default="experiments/results")
    args = parser.parse_args()
    serve(args.host, args.port) if args.mode == "server" else run_client(args)


if __name__ == "__main__":
    main()
