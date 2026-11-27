"""Experiment 2 and the TCP/UDP loss comparison on Windows, using clumsy to drop/delay packets.

    python experiments/run_windows_impaired.py <label> "<conditions text>" [--throughput]

Run it while clumsy is active with a filter on port 6000, for example:
    clumsy.exe --filter "tcp.DstPort == 6000 or tcp.SrcPort == 6000 or udp.DstPort == 6000 or udp.SrcPort == 6000"
               --drop on --drop-chance 10
Captures the TCP run to experiments/results/exp_<label>_tcp.pcapng and appends both runs to summary.csv."""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "experiments" / "results"
WS = Path(r"C:\Program Files\Wireshark")
PY = sys.executable
PORT = 6000


def main():
    label, conditions = sys.argv[1], sys.argv[2]
    throughput = "--throughput" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    echo = subprocess.Popen([PY, ROOT / "tools" / "tcp_udp_compare.py", "server", "--host", "127.0.0.1", "--port", str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    pcap = OUT / f"exp_{label}_tcp.pcapng"
    pcap.unlink(missing_ok=True)
    cap = subprocess.Popen([WS / "dumpcap.exe", "-q", "-i", r"\Device\NPF_Loopback", "-f", f"tcp port {PORT}", "-w", pcap],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    try:
        runs = [("tcp", ["--count", "100"]), ("udp", ["--count", "100"])]
        if throughput:
            runs = [("tcp", ["--count", "100"]), ("tcp", ["--count", "2000", "--size", "1000", "--interval", "0", "--label-suffix"])]
        for proto, extra in runs:
            lab = label
            if "--label-suffix" in extra:
                extra = [e for e in extra if e != "--label-suffix"]
                lab = label + "_tput"
            subprocess.run([PY, ROOT / "tools" / "tcp_udp_compare.py", "client", "--proto", proto, "--port", str(PORT),
                            *extra, "--label", lab, "--conditions", conditions, "--wait", "15"], cwd=ROOT)
            if proto == "tcp" and not throughput:
                time.sleep(1.5)
                cap.terminate(); cap.wait(10)   # TCP capture done before the UDP run
    finally:
        if cap.poll() is None:
            time.sleep(1.5); cap.terminate(); cap.wait(10)
        echo.terminate()
    tshark = WS / "tshark.exe"
    flags = subprocess.run([tshark, "-r", pcap, "-q", "-z", "expert,note"], capture_output=True, text=True).stdout
    retrans = subprocess.run([tshark, "-r", pcap, "-Y", "tcp.analysis.retransmission"], capture_output=True, text=True).stdout.count("\n")
    dup = subprocess.run([tshark, "-r", pcap, "-Y", "tcp.analysis.duplicate_ack"], capture_output=True, text=True).stdout.count("\n")
    print(f"capture {pcap.name}: {retrans} retransmissions, {dup} duplicate ACKs")


if __name__ == "__main__":
    main()
