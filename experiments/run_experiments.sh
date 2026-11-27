#!/usr/bin/env bash
# Runs the four compulsory TCP experiments and the TCP/UDP comparison on a Linux machine
# (the Azure VM), entirely over the loopback interface "lo", so no other network or
# machine is affected. Packet captures (.pcap) and CSV results go to experiments/results/.
#
# Works on any Ubuntu (the cloud VM or WSL on your PC). It installs tcpdump/iproute2/python if
# missing and, if no ConqChat is already listening on port 5000, starts its own copy with a
# throwaway SQLite database.                 Usage:  bash experiments/run_experiments.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=experiments/results
CHAT_PORT=${CHAT_PORT:-5000}
CMP_PORT=${CMP_PORT:-6000}
PY=python3
mkdir -p "$OUT"

# Tools
need=""; for t in tcpdump tc python3; do command -v $t >/dev/null || need=1; done
[ -z "$need" ] || sudo apt-get install -y tcpdump iproute2 python3 python3-venv
python3 -c "import venv" 2>/dev/null || sudo apt-get install -y python3-venv

# A ConqChat server to test against (reuse a running one, e.g. the systemd service on the VM)
SERVER_LOG="$OUT/server.log"
if ! (echo > /dev/tcp/127.0.0.1/$CHAT_PORT) 2>/dev/null; then
  VENV="$HOME/.conqchat-venv"
  [ -x "$VENV/bin/uvicorn" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" install -q -r requirements.txt; }
  rm -f /tmp/conqchat-exp.db "$SERVER_LOG"
  DATABASE_URL=sqlite:////tmp/conqchat-exp.db SECRET_KEY=experiments TCP_HOST=127.0.0.1 TCP_PORT=$CHAT_PORT     LOG_LEVEL=DEBUG LOG_FILE="$SERVER_LOG" "$VENV/bin/uvicorn" app.main:app --port 8099 >/dev/null 2>&1 &
  STARTED_SERVER=$!
  for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/$CHAT_PORT) 2>/dev/null && break; sleep 0.5; done
  echo "Started a test ConqChat server (pid $STARTED_SERVER), log: $SERVER_LOG"
fi

# Make sure the netem module exists (Azure kernels ship it in linux-modules-extra)
if ! sudo tc qdisc add dev lo root netem delay 0ms 2>/dev/null; then
  sudo modprobe sch_netem 2>/dev/null || { sudo apt-get install -y "linux-modules-extra-$(uname -r)" && sudo modprobe sch_netem; }
fi
sudo tc qdisc del dev lo root 2>/dev/null || true

impair()  { sudo tc qdisc replace dev lo root netem "$@"; echo "   [lo: netem $*]"; }
clear_impairment() { sudo tc qdisc del dev lo root 2>/dev/null || true; }
CAP_PID=""
start_capture() { sudo tcpdump -i lo -U -s 256 -w "$OUT/$1.pcap" "$2" >/dev/null 2>&1 & CAP_PID=$!; sleep 1; }
stop_capture()  { sleep 1; sudo kill -INT "$CAP_PID" 2>/dev/null || true; wait "$CAP_PID" 2>/dev/null || true; }
cleanup() { clear_impairment; [ -n "$CAP_PID" ] && sudo kill -INT "$CAP_PID" 2>/dev/null; [ -n "${STARTED_SERVER:-}" ] && kill "$STARTED_SERVER" 2>/dev/null; pkill -f "tcp_udp_compare.py server" 2>/dev/null || true; }
trap cleanup EXIT

# A scripted chat-client session: each argument is one line typed into the client, 1 s apart
client_session() { (for line in "$@"; do echo "$line"; sleep 1; done) | $PY client/chat_client.py --port "$CHAT_PORT"; }
LOGIN="/login exp_user exp_password1"
client_session "/register exp_user exp_password1" "/quit" >/dev/null 2>&1 || true   # create the test account once
since=$(date '+%Y-%m-%d %H:%M:%S')

echo "== Experiment 1: connection establishment (SYN, SYN-ACK, ACK) =="
start_capture exp1_handshake "tcp port $CHAT_PORT"
client_session "$LOGIN" "/ping" "/quit"
stop_capture

echo "== Experiment 3: connection termination =="
start_capture exp3_normal_close "tcp port $CHAT_PORT"
client_session "$LOGIN" "/quit"                        # client sends FIN first
stop_capture
start_capture exp3_abort_rst "tcp port $CHAT_PORT"
client_session "$LOGIN" "/crash"                       # SO_LINGER=0 -> RST
stop_capture
start_capture exp3_process_killed "tcp port $CHAT_PORT"
(sleep 30 | $PY client/chat_client.py --port "$CHAT_PORT") & sleep 2
pkill -9 -f "client/chat_client.py" || true            # process dies; the kernel closes the socket
stop_capture
{ if [ -f "$SERVER_LOG" ]; then cat "$SERVER_LOG"; else sudo journalctl -u conqchat --since "$since" --no-pager; fi; }   | grep -E "TCP (connect|disconnect)|logged in" > "$OUT/exp3_server_log.txt" || true

echo "== TCP/UDP comparison + Experiment 2: loss and retransmission =="
$PY tools/tcp_udp_compare.py server --host 127.0.0.1 --port "$CMP_PORT" & sleep 1
for proto in udp tcp; do
  $PY tools/tcp_udp_compare.py client --proto $proto --port "$CMP_PORT" --count 100 --label baseline --conditions "Azure VM loopback, no impairment"
done
impair loss 10%
start_capture exp2_tcp_loss10 "tcp port $CMP_PORT"
$PY tools/tcp_udp_compare.py client --proto tcp --port "$CMP_PORT" --count 100 --label loss10 --conditions "netem loss 10%" --wait 10
stop_capture
start_capture exp2_udp_loss10 "udp port $CMP_PORT"
$PY tools/tcp_udp_compare.py client --proto udp --port "$CMP_PORT" --count 100 --label loss10 --conditions "netem loss 10%"
stop_capture
impair delay 20ms 15ms loss 5%                          # jitter can reorder packets
for proto in udp tcp; do
  $PY tools/tcp_udp_compare.py client --proto $proto --port "$CMP_PORT" --count 100 --label jitter_loss5 --conditions "netem delay 20ms 15ms loss 5%" --wait 10
done
clear_impairment

echo "== Experiment 4: flow control and performance =="
start_capture exp4_baseline "tcp port $CMP_PORT"
$PY tools/tcp_udp_compare.py client --proto tcp --port "$CMP_PORT" --count 100 --label rtt_baseline --conditions "no impairment"
$PY tools/tcp_udp_compare.py client --proto tcp --port "$CMP_PORT" --count 5000 --size 1000 --interval 0 --label tput_baseline --conditions "no impairment, 5000 x 1000 B"
stop_capture
impair delay 50ms rate 10mbit                           # 50 ms each way (100 ms RTT), 10 Mbit/s bottleneck
start_capture exp4_delay_rate "tcp port $CMP_PORT"
$PY tools/tcp_udp_compare.py client --proto tcp --port "$CMP_PORT" --count 100 --label rtt_delay50 --conditions "netem delay 50ms rate 10mbit"
$PY tools/tcp_udp_compare.py client --proto tcp --port "$CMP_PORT" --count 5000 --size 1000 --interval 0 --label tput_delay50 --conditions "netem delay 50ms rate 10mbit, 5000 x 1000 B" --wait 20
stop_capture
clear_impairment

echo "== Summaries for the report =="
for f in "$OUT"/*.pcap; do
  echo "--- $f: $(sudo tcpdump -nr "$f" 2>/dev/null | wc -l) packets"
done
sudo tcpdump -nr "$OUT/exp1_handshake.pcap" 2>/dev/null | head -4                 > "$OUT/exp1_first_packets.txt"
sudo tcpdump -nr "$OUT/exp3_abort_rst.pcap" 2>/dev/null | grep -E "Flags \[R" > "$OUT/exp3_rst_packets.txt" || true
column -s, -t < "$OUT/summary.csv" | cut -c1-200
sudo chown -R "$(whoami)" "$OUT"
echo "Done. Copy experiments/results/ to your PC and open the .pcap files in Wireshark."
