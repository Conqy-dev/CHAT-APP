import re
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

S = Path(__file__).parent
O = Path(r"C:/Users/conqu/chat-app/docs/report/screenshots")
font = ImageFont.truetype("arialbd.ttf", 19)

# ---------- annotate the real Wireshark screenshots ----------
ROW0, ROWH, TOP_CROP = 178, 20, 66       # centre of packet row 1, row height, crop off title bar/overlay


def annotate(name, marks):
    img = Image.open(O / name).convert("RGB")
    img = img.crop((0, TOP_CROP, img.width, img.height - 260))   # drop title bar + empty bottom of details pane
    d = ImageDraw.Draw(img)
    for first, last, label in marks:
        y0 = ROW0 + (first - 1) * ROWH - 11 - TOP_CROP
        y1 = ROW0 + (last - 1) * ROWH + 11 - TOP_CROP
        d.rectangle((6, y0, 1440, y1), outline=(230, 0, 0), width=4)
        tw = d.textlength(label, font=font)
        d.rectangle((1450, y0, 1450 + tw + 14, y0 + 28), fill=(230, 0, 0))
        d.text((1457, y0 + 3), label, fill="white", font=font)
    img.save(O / name)


annotate("fig1_handshake.png", [(1, 3, "3-way handshake: SYN / SYN-ACK / ACK"),
                                (4, 4, "welcome message, 86 bytes (PSH)"),
                                (18, 21, "orderly close: FIN / ACK / FIN / ACK")])
annotate("fig3_fin_close.png", [(14, 17, "client FIN first, then server FIN (4-way close)")])
annotate("fig4_rst_crash.png", [(10, 10, "/crash: single RST, no FIN exchange")])
annotate("fig5_rst_killed.png", [(6, 6, "process killed: Windows sends RST")])

# ---------- Figure: flow (ladder) diagram of experiment 1 ----------
rows = [l.split("|") for l in (S / "flow.txt").read_text().splitlines() if l.strip()]
fig, ax = plt.subplots(figsize=(10, 9))
ax.set_xlim(0, 10); ax.set_ylim(len(rows) + 1, -1); ax.axis("off")
for x, label in ((2, "Client\n127.0.0.1:8184"), (8, "Server\n127.0.0.1:5000")):
    ax.plot([x, x], [0, len(rows) + 0.5], color="#555", lw=2)
    ax.text(x, -0.6, label, ha="center", va="bottom", fontsize=12, fontweight="bold")
for i, (t, src, flags, seq, ack, ln) in enumerate(rows, start=1):
    flags = flags.replace("\u00b7", "").strip()
    names = [n for n, c in (("SYN", "S"), ("FIN", "F"), ("RST", "R"), ("PSH", "P"), ("ACK", "A")) if c in flags]
    a, b = (2, 8) if src == "8184" else (8, 2)
    col = "#c62828" if ("SYN" in names or "FIN" in names) else ("#1565c0" if int(ln) > 0 else "#777")
    ax.annotate("", xy=(b, i + 0.35), xytext=(a, i), arrowprops=dict(arrowstyle="->", color=col, lw=1.6))
    ax.text(5, i + 0.05, f"[{', '.join(names)}] Seq={seq} Ack={ack} Len={ln}", ha="center", va="bottom", fontsize=9, color=col,
            bbox=dict(fc="white", ec="none", pad=0.5))
    ax.text(0.1, i + 0.2, f"{float(t)*1000:.3f} ms", fontsize=8, color="#444")
ax.set_title("Experiment 1: TCP connection timeline (from exp1_handshake.pcapng)\nred = SYN/FIN, blue = data, grey = pure ACK", fontsize=12)
fig.tight_layout(); fig.savefig(O / "fig2_flowgraph.png", dpi=150); plt.close(fig)

# ---------- Figure: advertised receive window during the bulk transfer ----------
pts = [l.split("|") for l in (S / "win.txt").read_text().splitlines() if l.strip()]
fig, ax = plt.subplots(figsize=(10, 4.5))
for server, label, col, ms in ((False, "advertised by client", "#1565c0", 2), (True, "advertised by echo server (port 6000)", "#2e7d32", 1.2)):
    sel = [p for p in pts if (p[1] == "6000") == server and p[2]]
    ax.plot([float(p[0]) for p in sel], [int(p[2]) / 1024 for p in sel], ".", ms=ms, color=col, label=label, alpha=0.8)
fl = [(float(p[0]), int(p[3]) / 1024) for p in pts if len(p) > 3 and p[3]]
ax.plot([f[0] for f in fl], [f[1] for f in fl], ".", ms=1.5, color="#e65100", alpha=0.5, label="bytes in flight")
ax.set_xlabel("time (s)"); ax.set_ylabel("KiB"); ax.set_ylim(bottom=0); ax.grid(alpha=0.3); ax.legend(loc="lower right", markerscale=6)
ax.set_title("Experiment 4: receive window vs. bytes in flight, 5000 x 1000-byte burst (exp4_loopback.pcapng, stream 1)")
fig.tight_layout(); fig.savefig(O / "fig6_window.png", dpi=150); plt.close(fig)

# ---------- Figure: Follow TCP Stream (framing), password redacted ----------
text = (S / "follow.txt").read_text()
body = text.split("Node 1:")[1].split("\n", 1)[1].rsplit("=====", 1)[0]
lines = []
for line in body.splitlines():
    if not line.strip() or re.fullmatch(r"\t?\d+", line) or line.startswith("==="):
        continue
    line = re.sub(r'("password": ")[^"]*', r"\1••••••••", line)
    who = "server → client" if line.startswith('{"type": "welcome"') or '"type": "login_ok"' in line or '"pong"' in line or '"bye"' in line else "client → server"
    lines.append((who, line.strip() + "\\n"))
fig, ax = plt.subplots(figsize=(11, 0.45 * len(lines) + 1.2)); ax.axis("off")
for i, (who, line) in enumerate(lines):
    col = "#1565c0" if who.startswith("server") else "#c62828"
    ax.text(0.0, 1 - (i + 0.8) / len(lines), f"{who:<16}", family="monospace", fontsize=10, color=col, fontweight="bold", transform=ax.transAxes)
    ax.text(0.17, 1 - (i + 0.8) / len(lines), line, family="monospace", fontsize=10, color=col, transform=ax.transAxes)
ax.set_title("Follow TCP Stream (exp1_handshake.pcapng): one JSON object per line, each ending in \\n (0x0A)", fontsize=11)
fig.tight_layout(); fig.savefig(O / "fig7_follow_stream.png", dpi=150); plt.close(fig)
print("done")
