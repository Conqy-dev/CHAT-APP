"""Packet-capture experiments on Windows (Wireshark + Npcap with loopback support).

Captures the loopback adapter with dumpcap while scripted clients talk to a throwaway
ConqChat server, producing .pcapng files for Wireshark:
  exp1_handshake        connect, ping, clean quit
  exp3_normal_close     /quit -> FIN/ACK exchange
  exp3_abort_rst        /crash -> RST (SO_LINGER 0)
  exp3_process_killed   client process killed -> the OS closes the socket
  exp4_loopback         RTT (100 pings) and throughput (5000 x 1000 B) over TCP
Usage (from the repo root, venv active):  python experiments/run_windows_captures.py"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "experiments" / "results"
WS = Path(r"C:\Program Files\Wireshark")
PY = sys.executable
CHAT_PORT, WEB_PORT, CMP_PORT = 5000, 8099, 6000


def loopback_interface():
    listing = subprocess.run([WS / "dumpcap.exe", "-D"], capture_output=True, text=True).stdout
    for line in listing.splitlines():
        if "loopback" in line.lower():
            return line.split(".", 1)[0]  # interface number
    sys.exit("No loopback capture interface: reinstall Npcap with 'Support loopback traffic' ticked.\n" + listing)


IFACE = None


def capture(name, bpf):
    f = OUT / f"{name}.pcapng"
    f.unlink(missing_ok=True)
    p = subprocess.Popen([WS / "dumpcap.exe", "-q", "-i", IFACE, "-f", bpf, "-w", f],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)  # let dumpcap start
    return p, f


def stop(p, f):
    time.sleep(1.5)
    p.terminate()
    p.wait(10)
    count = subprocess.run([WS / "tshark.exe", "-r", f], capture_output=True, text=True).stdout.count("\n")
    print(f"   saved {f.name} ({count} packets)")


def client_session(*lines, kill_after=None):
    """Run the terminal client, typing each line 1 s apart."""
    p = subprocess.Popen([PY, ROOT / "client" / "chat_client.py", "--port", str(CHAT_PORT)],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if kill_after:
        time.sleep(kill_after)
        p.kill()  # like closing the window / Task Manager -> End task
        return p.communicate()[0]
    for line in lines:
        time.sleep(1)
        p.stdin.write(line + "\n")
        p.stdin.flush()
    time.sleep(1.5)
    try:
        return p.communicate(timeout=10)[0]
    except subprocess.TimeoutExpired:
        p.kill()
        return p.communicate()[0]


def main():
    global IFACE
    OUT.mkdir(parents=True, exist_ok=True)
    IFACE = loopback_interface()
    print("Capturing on interface", IFACE)

    db, log = OUT / "exp-server.db", OUT / "server.log"
    db.unlink(missing_ok=True)
    log.unlink(missing_ok=True)
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}", "SECRET_KEY": "experiments",
           "TCP_HOST": "127.0.0.1", "TCP_PORT": str(CHAT_PORT), "LOG_LEVEL": "DEBUG", "LOG_FILE": str(log)}
    server = subprocess.Popen([PY, "-m", "uvicorn", "app.main:app", "--port", str(WEB_PORT)], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    echo = None
    try:
        time.sleep(4)
        login = "/login exp_user exp_password1"
        client_session("/register exp_user exp_password1", "/quit")

        print("== Experiment 1: connection establishment")
        p, f = capture("exp1_handshake", f"tcp port {CHAT_PORT}")
        print(client_session(login, "/ping", "/quit").strip().replace("\n", "\n   | "))
        stop(p, f)

        print("== Experiment 3: termination")
        p, f = capture("exp3_normal_close", f"tcp port {CHAT_PORT}")
        client_session(login, "/quit")
        stop(p, f)
        p, f = capture("exp3_abort_rst", f"tcp port {CHAT_PORT}")
        client_session(login, "/crash")
        stop(p, f)
        p, f = capture("exp3_process_killed", f"tcp port {CHAT_PORT}")
        client_session(kill_after=3)
        stop(p, f)
        time.sleep(1)
        lines = [l for l in log.read_text(encoding="utf-8").splitlines() if re.search(r"TCP (connect|disconnect)|logged in", l)]
        (OUT / "exp3_server_log.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

        print("== Experiment 4: RTT and throughput (loopback)")
        echo = subprocess.Popen([PY, ROOT / "tools" / "tcp_udp_compare.py", "server", "--host", "127.0.0.1",
                                 "--port", str(CMP_PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        p, f = capture("exp4_loopback", f"tcp port {CMP_PORT}")
        for args in (["--count", "100", "--label", "win_rtt_baseline", "--conditions", "Windows loopback, no impairment"],
                     ["--count", "5000", "--size", "1000", "--interval", "0", "--label", "win_tput_baseline",
                      "--conditions", "Windows loopback, 5000 x 1000 B as fast as possible"]):
            subprocess.run([PY, ROOT / "tools" / "tcp_udp_compare.py", "client", "--proto", "tcp",
                            "--port", str(CMP_PORT), *args], cwd=ROOT)
        stop(p, f)
    finally:
        for proc in (echo, server):
            if proc:
                proc.terminate()
                proc.wait(10)
        time.sleep(1)
        try:
            db.unlink(missing_ok=True)
        except PermissionError:
            pass
    print("Done. Open the .pcapng files in experiments/results with Wireshark.")


if __name__ == "__main__":
    main()
