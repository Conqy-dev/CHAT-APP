// Builds the technical report (Word .docx) in the same style as the department's proposal template.
// Usage (from docs/report):  npm install  &&  node build_report.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, WidthType,
  BorderStyle, ShadingType, LevelFormat, HeadingLevel, PageNumber, Footer, TableOfContents, PageBreak,
} = require("docx");

const FONT = "Times New Roman";
const MONO = "Consolas";
const ROOT = path.join(__dirname, "..", "..");
const PAGE_W = 12240, MARGIN = 1440, CONTENT_W = PAGE_W - 2 * MARGIN; // US Letter, 1" margins (as the proposal)

// ---------- inline markup: **bold**, `code`, [[PENDING: ...]] ----------
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: 19, ...base }));
    else out.push(new TextRun({ text: t.slice(2, -2), font: FONT, bold: true, highlight: "yellow", ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out;
}

const P = (text, opts = {}) => new Paragraph({ children: runs(text), spacing: { after: 160, line: 264 }, ...opts });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: FONT })] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, font: FONT })] });
const UL = (items) => items.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(t), spacing: { after: 80, line: 264 } }));
let olCount = 0;
const OL = (items) => { const ref = `num${olCount++}`; numberingConfigs.push(numbered(ref)); return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 80, line: 264 } })); };
const CODE = (text) => text.split("\n").map((line, i, all) => new Paragraph({
  children: [new TextRun({ text: line || " ", font: MONO, size: 17 })],
  shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
  spacing: { before: i === 0 ? 60 : 0, after: i === all.length - 1 ? 200 : 0, line: 240 },
  indent: { left: 120, right: 120 },
}));
const CAPTION = (text) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, italics: true, font: FONT, size: 20 })], spacing: { after: 240 } });
function IMG(file, widthIn, heightIn) {
  return new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new ImageRun({
    type: "png", data: fs.readFileSync(path.join(ROOT, file)), transformation: { width: widthIn * 96, height: heightIn * 96 },
  })] });
}
const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const borders = { top: border, bottom: border, left: border, right: border };
function TABLE(widthsIn, rows, { header = true, size = 20 } = {}) {
  const widths = widthsIn.map((w) => Math.round((w / widthsIn.reduce((a, b) => a + b, 0)) * CONTENT_W));
  widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((row, r) => new TableRow({ tableHeader: header && r === 0, children: row.map((cell, c) => new TableCell({
      borders, width: { size: widths[c], type: WidthType.DXA },
      shading: header && r === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E6E6" } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ alignment: header && r === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: runs(String(cell), { size, bold: header && r === 0 ? true : undefined }) })],
    })) })),
  });
}
const GAP = () => new Paragraph({ children: [], spacing: { after: 120 } });
const numbered = (ref) => ({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] });
const numberingConfigs = [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }];

// ---------- cover page (copies the department proposal layout) ----------
const C = (children, after = 240, size = 22) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after, line: 276 },
  children: children.map(([text, bold]) => new TextRun({ text, bold, font: FONT, size })) });
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 240 }, children: [new ImageRun({
    type: "png", data: fs.readFileSync(path.join(__dirname, "veritas-logo.png")), transformation: { width: 300, height: 150 } })] }),
  C([["VERITAS UNIVERSITY, ABUJA", true]], 300, 26),
  C([["FACULTY OF COMPUTING", true]], 300, 26),
  C([["DEPARTMENT OF COMPUTER SCIENCE", true]], 300, 26),
  C([["CSC 423: DATA COMMUNICATION AND NETWORKING", true]], 160),
  C([["TECHNICAL REPORT", true]], 300),
  C([["DESIGN, IMPLEMENTATION AND CLOUD DEPLOYMENT OF A MULTI-USER TCP CHAT APPLICATION", false]], 300),
  C([["BY", true]], 300),
  C([["NAME: ", true], ["JULIUS OCHE OSAMUDIANME", false]], 300),
  C([["MATRICULATION NUMBER: ", true], ["VUG/CSC/23/9458", false]], 300),
  C([["A TECHNICAL REPORT SUBMITTED TO THE DEPARTMENT OF COMPUTER SCIENCE, VERITAS UNIVERSITY, ABUJA, IN PARTIAL FULFILMENT OF THE REQUIREMENTS OF THE COURSE CSC 423: DATA COMMUNICATION AND NETWORKING", true]], 600),
  C([["COURSE LECTURER:", true]], 300),
  C([["MR. THOMAS BAIDOO", false]], 200),
  C([["NOVEMBER 2026", true]], 0),
];

// ---------- results (read from the CSV written by tools/tcp_udp_compare.py) ----------
function resultRows() {
  const file = path.join(ROOT, "experiments", "results", "summary.csv");
  if (!fs.existsSync(file)) return [];
  const [head, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => {
    const v = l.match(/("[^"]*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, "").replace(/^"|"$/g, ""));
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}
const results = resultRows().filter((r) => r.label !== "local_burst"); // win_tput_baseline covers bulk throughput
const resultTable = TABLE([1.3, 0.6, 2.4, 0.9, 0.7, 0.8, 1.6, 1.0], [
  ["Run", "Proto", "Conditions", "Received", "Lost", "Out of order", "RTT avg / p95 / max (ms)", "Msg/s"],
  ...results.map((r) => [r.label, r.proto.toUpperCase(), r.conditions, `${r.received}/${r.count}`, r.lost, r.out_of_order,
    `${r.rtt_avg_ms} / ${r.rtt_p95_ms} / ${r.rtt_max_ms}`, r.throughput_msg_s]),
], { size: 17 });

// ---------- report body ----------
const body = [
  new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 280 }, children: [new TextRun({ text: "TABLE OF CONTENTS", font: FONT, size: 46, bold: true })] }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-1" }),

  H1("1. INTRODUCTION AND OBJECTIVES"),
  H2("1.1 Background"),
  P("Networked applications rely on the transport layer of the TCP/IP suite to move data between processes on different machines. IP only delivers packets between hosts, on a best-effort basis; the transport layer adds process-to-process delivery through port numbers and, with TCP, a reliable, ordered, connection-oriented byte stream."),
  P("A chat application is a good way to see these ideas in practice. Several users stay connected at the same time, messages must arrive complete and in order, and the server must notice when a user joins, leaves or disappears without warning. This report describes **ConqChat**, a multi-user chat application I designed, implemented, tested and prepared for cloud deployment, and explains how it uses TCP sockets, port numbers, connections and application-level message framing. The source code, tests and documentation are at **https://github.com/Conqy-dev/CHAT-APP**."),
  H2("1.2 Objectives"),
  P("The objectives were to: (1) implement client-server communication with TCP sockets and a server that handles many clients at once; (2) demonstrate the roles of IP addresses, port numbers, connections and application-layer message framing; (3) handle connection establishment, normal disconnection and unexpected termination; (4) evaluate TCP and UDP experimentally under normal and impaired conditions; and (5) deploy and validate the application on a public cloud platform with appropriate security and cost controls."),
  H1("2. SYSTEM REQUIREMENTS"),
  P("The application had to provide the following, each met as shown:"),
  ...UL([
    "**Multi-client server** accepting and managing many TCP connections at once (`app/tcp_server.py`); a **TCP client** (`client/chat_client.py`).",
    "**User identification** by username and password (`register` / `login`); **real-time one-to-one messaging** between simultaneously connected users (`send_message` → `new_message`).",
    "**Connection lifecycle handling**: establishment, disconnection and unexpected termination (Section 4.4).",
    "**Documented message format with explicit framing** (Sections 4.2–4.3, `docs/protocol.md`); **validation** of usernames and messages, with malformed input never crashing the server; **server-side connection and error logs** (`logs/server.log`).",
  ]),
  GAP(),
  H1("3. SYSTEM ARCHITECTURE"),
  H2("3.1 Overview"),
  P("ConqChat is a client-server system. One server process runs an asyncio event loop that listens on two TCP ports at the same time: **port 5000** for the raw TCP chat protocol used by the terminal client, and **port 8000** for the web interface (HTTP and WebSocket). Both entry points share the same chat logic, the same PostgreSQL database and the same registry of live connections, so a user in a terminal can chat with a user in a browser."),
  IMG("docs/diagrams/application-architecture.png", 5.6, 3.36),
  CAPTION("Figure 1: Application architecture. Every arrow is a TCP connection."),
  H2("3.2 Data Model"),
  P("There are three tables. **users** (id, unique username, Argon2 password hash, created_at), **conversations** (id, user_one_id, user_two_id, created_at, with a uniqueness constraint so a pair of users has exactly one conversation, and the smaller id always stored first) and **messages** (id, conversation_id, sender_id, content, created_at, read_at). An index on (conversation_id, id) makes loading recent history fast."),

  H1("4. IMPLEMENTATION AND MESSAGE PROTOCOL"),
  H2("4.1 Sockets, Ports and Concurrency"),
  P("The server creates a listening TCP socket with `asyncio.start_server(handle_connection, host, port)`. With `TCP_HOST=0.0.0.0` it accepts connections on every network interface, and `TCP_PORT=5000` sets the port. Both values come from environment variables, so the listening port can be changed without changing code (edit `.env` and restart)."),
  P("When a client connects, the operating system completes the three-way handshake (SYN, SYN-ACK, ACK); asyncio then accepts the connection and starts a coroutine, `handle_connection`, for that client. Each accepted connection is a **new socket** identified by the 4-tuple (server IP, server port 5000, client IP, client ephemeral port), which is how one server port serves many clients: the operating system demultiplexes each segment using all four values. The server logs each client's address and port, e.g. `TCP connect from 127.0.0.1:8775`."),
  P("Concurrency uses a single-threaded event loop rather than one thread per client. While one connection waits for data (`await reader.read(4096)`), the loop serves the others. This scales well to many idle chat connections and avoids locking, because only one coroutine runs at any moment."),
  H2("4.2 Message Framing"),
  P("TCP provides an ordered **byte stream**, not separate messages. The sizes of the chunks returned by `read()` are decided by the network and the operating system, not by the sender: one read can return half a message, or several messages joined together. The application must therefore mark where each message ends. ConqChat uses **newline-delimited JSON (NDJSON)**: every message is one JSON object encoded as UTF-8 and followed by a single newline byte (0x0A)."),
  P("The receiver (`LineFramer.feed`) appends each chunk to a buffer, extracts every complete line, and keeps any incomplete remainder for the next read. This is safe because `json.dumps` always escapes a newline inside a string as the two characters \\n, so a raw newline byte can only mean the end of a message. To protect the server's memory, any frame larger than 64 KiB is rejected and that connection is closed."),
  P("The browser client uses WebSockets, which also run over a single TCP connection but have their own framing: every WebSocket frame starts with a header containing the payload length. The same JSON messages are carried inside those frames."),
  H2("4.3 Message Protocol"),
  P("Every message has a `type` field. The client sends commands; the server sends replies and pushes events at any time."),
  TABLE([1.4, 2.8, 0.8, 2.0], [
    ["Client → server", "Fields", "Login?", "Reply"],
    ["register / login", "username, password", "No", "login_ok {user}"],
    ["ping", "id", "No", "pong {id}"],
    ["quit", "none", "No", "bye (then the client closes)"],
    ["users", "search", "Yes", "users [..]"],
    ["open", "username", "Yes", "conversation {id, other_user}"],
    ["conversations", "none", "Yes", "conversations [..]"],
    ["history", "conversation_id, limit", "Yes", "history {messages}"],
    ["send_message", "conversation_id, content (1–4000 chars)", "Yes", "new_message to both members"],
  ]),
  GAP(),
  P("On connection the server sends `welcome`. Any problem produces `{\"type\": \"error\", \"message\": \"...\"}` and the connection stays open. The full specification with an example session is in `docs/protocol.md`."),
    H2("4.4 Connection Lifecycle"),
  TABLE([1.7, 2.8, 2.5], [
    ["Event", "What happens on the wire", "Server behaviour"],
    ["Connect", "SYN, SYN-ACK, ACK", "Accept; enable TCP keepalive; send welcome; log address:port"],
    ["Normal quit", "Client sends quit, receives bye, then closes: FIN/ACK in each direction", "read() returns end-of-stream; logged as 'client closed the connection (FIN received)'"],
    ["Crash / abort", "RST (the client's terminal command /crash sets SO_LINGER = 0)", "ConnectionResetError; logged as 'connection reset by peer (RST received)'"],
    ["Process killed", "The OS closes the socket: RST on Windows (observed in Experiment 3), normally FIN on Linux", "Logged as RST or FIN accordingly; no quit/bye exchange"],
    ["Silent loss (power or network gone)", "Nothing arrives at all", "Keepalive probes after 60 s idle, every 10 s; connection dropped after 3 misses"],
    ["Client stops reading", "Client's receive window fills; server's send buffer fills", "drain() waits; client dropped after a 5 s send timeout so it can't stall others"],
  ]),
  GAP(),
  P("In every case the `finally` block of `handle_connection` removes the client from the ConnectionManager, closes the socket and logs the reason, so a failed client never stays registered and other users are never affected."),
  H2("4.5 Validation, Error Handling and Logging"),
  ...UL([
    "**Usernames:** 3–24 characters, letters, digits and underscore only, stored in lowercase. **Passwords:** 8–128 characters. **Messages:** 1–4000 characters after trimming. Rules are enforced on the server with Pydantic models, whatever the client sends.",
    "**Malformed input** (invalid UTF-8, text that isn't JSON, JSON that isn't an object, unknown command, missing fields, wrong types) gets a specific error reply. The test suite sends eight malformed inputs and checks the connection still works afterwards.",
    "**Access control:** a user can only read or post in conversations they belong to; commands other than register, login, ping and quit need a login.",
    "**Security:** Argon2 password hashes, a signed session cookie, an Origin check on the WebSocket handshake, secrets in an untracked `.env` file, and message text rendered as plain text, never HTML.",
    "**Logging:** connections, logins, disconnections with their reason, malformed input and unexpected errors are written to the console and to a rotating log file, `logs/server.log`. With `LOG_LEVEL=DEBUG` every read and its frame count is also logged.",
  ]),
  H1("5. TCP VERSUS UDP ANALYSIS"),
  H2("5.1 Why is TCP suitable for normal chat messages?"),
  P("A chat message is only useful if it arrives complete, exactly once and in the order it was written: a missing word, a repeated message or a reply that appears before the question all confuse a conversation. TCP provides these properties automatically. Chat messages are also small and not time-critical at the millisecond level, so the extra delay of a retransmission (typically tens to a few hundred milliseconds) is acceptable, whereas a lost message is not. TCP's connection also gives the server a natural notion of a user being online (an open socket), and a clear signal when they leave (FIN or RST)."),
  H2("5.2 What transport-layer guarantees does TCP provide?"),
  ...UL([
    "**Process-to-process delivery** using source and destination port numbers.",
    "**Connection-oriented communication:** a three-way handshake establishes the connection and agrees initial sequence numbers before data flows; an orderly close uses FIN in each direction.",
    "**Reliable delivery:** every byte has a sequence number and is acknowledged; missing data is retransmitted after a timeout or after three duplicate ACKs (fast retransmit).",
    "**In-order delivery without duplicates:** the receiver reorders segments by sequence number and discards duplicates before passing data to the application.",
    "**Error detection:** a checksum covers the header and data; corrupted segments are discarded and later retransmitted.",
    "**Flow and congestion control:** the receiver advertises a receive window so a fast sender cannot overrun it, and the sender limits its rate (slow start, congestion avoidance) to avoid overloading the network.",
  ]),
  P("TCP does **not** guarantee message boundaries, a maximum delay, or that data was processed by the receiving application. These are covered in Sections 5.8 and 5.9."),
  H2("5.3 What are the major differences between TCP and UDP?"),
  TABLE([1.6, 2.7, 2.7], [
    ["Feature", "TCP", "UDP"],
    ["Connection", "Connection-oriented (handshake, teardown)", "Connectionless: each datagram is independent"],
    ["Reliability", "Acknowledgements and retransmission", "None: lost datagrams are simply lost"],
    ["Ordering", "Delivered in order", "May arrive out of order"],
    ["Duplicates", "Removed", "Possible"],
    ["Message boundaries", "None (byte stream); the application must frame", "Preserved: one send = one datagram"],
    ["Flow / congestion control", "Yes", "No"],
    ["Header size", "20–60 bytes", "8 bytes"],
    ["Latency", "Handshake plus possible retransmission delays; head-of-line blocking", "Lowest: send immediately, no waiting"],
    ["Typical uses", "Web, email, file transfer, chat, SSH", "DNS, VoIP, video calls, online games, streaming"],
  ]),
  GAP(),
  H2("5.4 Which parts of a chat application could reasonably use UDP?"),
  P("Information that is frequent, short-lived and quickly replaced by newer information could use UDP, because a lost update is soon corrected by the next one and retransmitting an old one would be pointless:"),
  ...UL([
    "**Typing indicators** (\"Ada is typing...\").",
    "**Presence and heartbeats** (online / away status sent every few seconds).",
    "**Voice and video calls** inside the chat, where late audio is useless and a small gap is better than a pause.",
    "**Live location or cursor sharing.**",
  ]),
  H2("5.5 What happens if a UDP message is lost or arrives out of order?"),
  P("UDP does nothing: a lost datagram is never retransmitted and the receiver is not told; out-of-order and duplicate datagrams are passed up as they arrive. An application needing reliability or ordering must add its own sequence numbers, acknowledgements, timeouts and reorder buffer, as the comparison tool's sequence numbers show (Section 5.10)."),
  H2("5.6 How do sockets and port numbers enable communication between processes?"),
  P("An IP address identifies a host; a **port number** identifies a process (a socket) on it, and a **socket** is the operating-system endpoint a program reads and writes. ConqChat's server binds a listening socket to port 5000; each client's OS picks an **ephemeral port** (e.g. 8184 in Experiment 1). The connection is identified by the 4-tuple (client IP, client port, server IP, 5000), so the server's TCP delivers each segment to the right connection socket, and therefore to the coroutine serving that user. The server log and the terminal client both print these values."),
  H2("5.7 What happens when a client disconnects while using TCP?"),
  P("In a **normal disconnect** the client's application calls close(); its TCP sends **FIN**, the server acknowledges it, and the server's next read() returns an empty result (end of stream). ConqChat then removes the user's connection, closes its own side (a second FIN/ACK exchange) and logs the reason. The side that closed first stays in TIME_WAIT for a short period so that delayed segments from the old connection cannot be mistaken for a new one."),
  P("If the client **aborts**, the server receives **RST** and the connection is torn down at once; if it **disappears silently**, nothing arrives and only keepalive probes (enabled after 60 s idle) reveal it. Table 4.4 and Experiment 3 show each case. Other users are never affected."),
  H2("5.8 Why TCP needs application-level message framing"),
  P("TCP delivers a stream of bytes with no record of where one write ended and the next began. Segment sizes depend on the MSS, Nagle's algorithm, the receive window and timing, and the receiver's read() returns whatever happens to be in its buffer. Without framing, a server could try to parse half a JSON object, or two objects joined together, and fail. Newline delimiting (or length-prefixing) restores message boundaries at the application layer. UDP does not need this because each datagram is delivered whole or not at all."),
  H2("5.9 What TCP cannot guarantee after a connection failure"),
  ...UL([
    "**Delivery to the application:** an ACK only means the receiving TCP stack has the bytes, not that the application read or processed them. If the server crashes after the ACK, the message may be lost.",
    "**Knowing what was received:** when a connection breaks, the sender cannot tell which of its last bytes reached the other application. Data still in the send buffer is lost.",
    "**Continuity across connections:** a new connection starts fresh; TCP does not resume or replay anything from the old one.",
  ]),
  P("ConqChat handles this at the application level. Every message is **saved in the database before it is delivered**, the sender receives its own message back as confirmation, and a reconnecting client can request the conversation **history** to recover anything it missed (demonstrated in the reconnect test)."),
  H2("5.10 TCP versus UDP Practical Comparison"),
  P("A separate tool, `tools/tcp_udp_compare.py`, runs an echo server for both protocols and a client that sends numbered messages and records which come back, in what order, and the round-trip time of each. Each run is reproduced with `python tools/tcp_udp_compare.py server --port 6000` and `python tools/tcp_udp_compare.py client --proto tcp|udp --count 100 --label <name>` (loss applied with `tc netem`); all experiments are scripted in `experiments/run_experiments.sh` and `experiments/run_windows_captures.py`. Raw per-message results are saved as CSV files in `experiments/results/`."),
  resultTable,
  CAPTION("Table: TCP/UDP comparison results (100 numbered messages unless stated)"),
  P("**Discussion.** On the loopback interface with no impairment both protocols delivered every message in order, with round-trip times well below a millisecond; under these ideal conditions UDP's lack of reliability is invisible. Under impairment the difference is clear. With 10% loss UDP lost 17 of 100 messages, and with 20% reordering plus 5% loss it lost 12 and delivered **10 out of order**; the application received them as they arrived. TCP delivered **every message, in order, in every run**, but paid in latency: retransmissions raised the average RTT 25–40-fold, and one message waited 619 ms because the retransmission timeout doubles after repeated losses (exponential backoff). UDP kept its low, steady latency but provided no recovery."),
  P("**What the results do and do not prove.** They show how each protocol behaves on one host under controlled, artificial impairment, for 100 small messages. They do not measure real Internet paths, where loss is bursty and correlated, nor do they prove one protocol is \"faster\" in general: on loopback both are limited by the CPU and the Python code rather than the network."),

  H1("6. TCP EXPERIMENTS"),
  P("All four experiments were captured on Windows 11 over the loopback adapter with Wireshark/Npcap (`experiments/run_windows_captures.py` and `run_windows_impaired.py`, which start a throwaway server and scripted clients). Loss, reordering and delay were injected below TCP with **clumsy** (WinDivert), the Windows counterpart of Linux `tc netem` (`experiments/run_experiments.sh` does the same on Linux), restricted to the test port 6000 so no other traffic was affected. The captures are in `experiments/results/`. Only a throwaway test account was used, so no real chat content or passwords appear in them."),
  H2("6.1 Experiment 1: Connection Establishment"),
  P("**Method.** tcpdump captures port 5000 while the terminal client connects, sends a ping and quits. **Expected:** Three segments open the connection: SYN from the client's ephemeral port to port 5000 (with its initial sequence number and options such as MSS and window scale), SYN-ACK from the server (its own ISN, acknowledging client ISN + 1), and ACK from the client. The server's welcome message follows as the first data segment."),
  P("**Result** (Figure 2). Frames 1–3 are the handshake between the client's ephemeral port **8184** and server port **5000**. The raw initial sequence numbers were 1104412013 (client) and 3828679214 (server). The SYN-ACK acknowledged 1104412014, because a SYN consumes one sequence number. Both sides offered MSS 65495, window scale ×256 and SACK, and the handshake took 0.108 ms. The 86-byte welcome (frame 4) is acknowledged with Ack = 87."),
  IMG("docs/report/screenshots/fig1_handshake_crop.png", 5.6, 1.34),
  CAPTION("Figure 2: exp1_handshake.pcapng in Wireshark: handshake (frames 1–3), first data segment (4) and orderly close (18–21)."),
  H2("6.2 Experiment 2: Packet Loss and Retransmission"),
  P("**Method.** Drop 10% of packets below TCP (`tc netem` or clumsy), send 100 numbered messages over TCP and over UDP, and capture the TCP run. **Expected:** Wireshark shows [TCP Retransmission] and [TCP Dup ACK]; every TCP message still arrives in order but some RTTs jump by about one retransmission timeout, while UDP simply loses messages."),
  P("**Result** (`exp_loss10_tcp.pcapng`, Figure 3). With 10% of packets dropped, TCP still delivered **100 of 100** messages, in order, but the average RTT rose from 0.30 ms to **7.75 ms** (p95 42 ms, max 74 ms). Wireshark flagged **22 retransmissions and 24 duplicate ACKs**: each loss is followed by duplicate ACKs repeating the missing sequence number and a retransmission of exactly that segment (e.g. Seq=506), after which the ACK number jumps forward. UDP under the same conditions returned only **83 of 100**; the 17 losses were silent and never recovered (expected survival for two 10% hops: 0.9 × 0.9 ≈ 81%). Wireshark labels port 6000 as X11 by default, so one segment is shown with protocol X11; this is a display heuristic only."),
  IMG("docs/report/screenshots/fig_exp2_retrans.png", 6.2, 1.76),
  CAPTION("Figure 3: Retransmission under 10% loss: each duplicate ACK is followed by a retransmission of the missing segment."),
  H2("6.3 Experiment 3: Connection Termination"),
  P("**Method.** Three captures: a normal /quit, an abrupt /crash (SO_LINGER = 0), and killing the client process with SIGKILL. The server log for the same period is saved. **Expected:** Normal close: FIN/ACK from the client, FIN/ACK from the server (four-way close), server log 'FIN received'. Abort: a single RST, server log 'connection reset by peer (RST received)'. Killed process: the operating system, not the program, closes the socket (FIN or RST depending on the OS). In each case the server removes the user from the ConnectionManager."),
  P("**Results** (Figure 4). (a) The client sent FIN first and the server replied with its own FIN: an orderly four-way close, logged as `FIN received`. (b) `/crash` produced a single RST with no reply, logged as `connection reset by peer (RST received)`. (c) When the client process was killed, **Windows sent RST, not FIN**, because it aborts a terminated process's sockets (Linux normally sends FIN). In every case the server removed the connection (`open TCP connections: 0`)."),
  IMG("docs/report/screenshots/fig_termination.png", 4.3, 2.02),
  CAPTION("Figure 4: Connection termination: (a) FIN exchange, (b) RST from /crash, (c) RST when the client process is killed."),
  H2("6.4 Experiment 4: Flow Control and Performance"),
  P("**Method.** RTT (100 messages) and throughput (5000 × 1000-byte messages as fast as possible) are measured under two conditions: no impairment, and `netem delay 50ms rate 10mbit` (100 ms RTT, 10 Mbit/s bottleneck). **Expected:** RTT rises from well under 1 ms to about 100 ms. Throughput drops and becomes limited by the bottleneck rate and by the window: at most one window of data per RTT. Wireshark's window-size column shows the advertised receive window and, under load, its scaling."),
  P("**Baseline result** (Figure 5). 100 timed messages: RTT average **0.30 ms** (p95 0.39 ms, max 0.66 ms). Bulk: 5000 × 1000 bytes echoed in 0.21 s, about **23,700 messages/s (≈190 Mbit/s)**. The advertised window stayed between 33,280 and 65,535 bytes and never reached zero, so flow control never had to stop the sender. No retransmissions occurred on the lossless link."),
  IMG("docs/report/screenshots/fig6_window.png", 4.4, 1.98),
  CAPTION("Figure 5: Advertised receive window (33–64 KiB) vs. bytes in flight during the 5000-message burst; the window never closed."),
  P("**Second condition: 50 ms added per packet** (`exp_delay50_tcp.pcapng`). RTT rose to **110 ms** on average, and bulk throughput fell from 23,700 to **353 messages/s (≈2.8 Mbit/s)** with no loss at all. Bytes in flight peaked at about 66 KB, and 66 KB ÷ 0.185 s ≈ 357 KB/s, which matches the measured rate: the transfer was limited by **window ÷ RTT**, because the sender must wait for ACKs once a window of data is in flight. Windows auto-tuning grew the advertised window from 33 KB to 256 KB during the transfer. Delay alone, without loss, cut throughput 67-fold."),

  H2("6.5 How the Captures Support the Conclusions"),
  ...UL([
    "**TCP is connection-oriented:** every session in the captures begins with SYN, SYN-ACK, ACK before any chat data (Figure 2), and each connection is identified by its own client port (8184, 8185, 8187, 8188).",
    "**Delivery is reliable and ordered at byte level:** every ACK number equals the previous sequence number plus the bytes received (e.g. 1 + 86 = 87), and no retransmissions or gaps appear on the clean link.",
    "**TCP has no message boundaries:** the server's reads did not line up with messages (Section 7.2), so the newline framing (one JSON object per line, visible with Wireshark's Follow TCP Stream) is necessary.",
    "**Disconnection is observable and handled:** FIN and RST appear exactly as the server log reports them (Figure 4), and every connection was cleaned up; the advertised window never reached zero (Figure 5), so flow control did not limit the local tests.",
  ]),
  H1("7. TESTING AND RESULTS"),
  H2("7.1 Automated Tests"),
  P("The automated suite (`python -m pytest`) starts the real server on free ports with a temporary database and talks to it over real TCP sockets. The latest run passed **41 of 41 tests** in 6.8 seconds."),
  P("They cover: **framing** (6 tests: split and combined reads, every possible split point including inside multi-byte characters, CRLF, oversized frames); the **TCP server** (16: two-way chat, TCP ↔ browser chat, split/combined frames on a real socket, 8 malformed inputs, access control, three clients with abort and reconnect, clean-quit logging); **WebSockets** (12: live delivery, HTTP messages pushed live, invalid events, outsiders and cross-site handshakes rejected); and the **HTTP API** (7: accounts, validation, search, conversations, history)."),
  GAP(),
  H2("7.2 Key Results"),
  P("The key test, `test_three_clients_with_reconnect_and_abrupt_disconnect`, has client C abort with RST while A and B keep chatting; C then reconnects, logs in, receives new messages live and retrieves the history, and the server log shows the RST and the cleanup. Every malformed input receives a specific error without dropping the connection."),
  P("**Split and combined messages.** Running `tools/framing_demo.py` against the server with `LOG_LEVEL=DEBUG` sends two messages in one write, then one message in three writes. The server log shows how its reads mapped to frames:"),
  ...CODE(`read 52 bytes -> 2 complete frame(s), 0 byte(s) buffered    (two messages, one read)
read 7 bytes  -> 0 complete frame(s), 7 byte(s) buffered    (first part kept in buffer)
read 9 bytes  -> 0 complete frame(s), 16 byte(s) buffered
read 10 bytes -> 1 complete frame(s), 0 byte(s) buffered    (newline arrives: one message)`),
  P("The complete test log, including manual and cloud tests, is in `docs/test-log.md`."),

  H1("8. CLOUD DEPLOYMENT DESIGN"),
  P("The deployment has been designed and scripted but not yet run, because none of the available cloud accounts permitted creating a virtual machine at the time of writing (Section 9.1). This chapter describes the prepared design."),
  P("**Service choice.** A single small Linux virtual machine (1 vCPU, 1 GB RAM, Ubuntu 24.04) on AWS, Azure or Google Cloud. A VM was chosen over platform services because the chat server needs a **raw TCP port (5000)**, which HTTP-only platforms cannot expose, and full OS access is useful for `tcpdump` and `tc netem`. `deploy/setup.sh` installs Python, nginx and PostgreSQL, creates the database, writes the secrets and starts the app as a **systemd** service in one command."),
  TABLE([1.1, 1.6, 4.3], [
    ["Port", "Open to", "Purpose"],
    ["22/TCP", "Administrator's IP only", "SSH administration (key authentication, no passwords)"],
    ["80/TCP", "Internet", "nginx reverse proxy to the web app (HTTP + WebSocket upgrade)"],
    ["5000/TCP", "Internet", "Raw TCP chat server for terminal clients"],
    ["8000, 5432", "Closed", "uvicorn and PostgreSQL listen on 127.0.0.1 only and are never exposed"],
  ]),
  GAP(),
  P("**Secrets.** The database password and session key are generated on the server into a `.env` file readable only by the app user (mode 600); `.env` is excluded from Git and only `.env.example` is committed. **TLS.** Not used: a trusted certificate requires a domain name, so traffic on ports 80 and 5000 would be plaintext, which is why only throwaway test accounts are used. With a domain, Caddy or `certbot --nginx` would add HTTPS on port 443, and the TCP socket could be wrapped with Python's `ssl` module. **Operation.** `sudo systemctl start|restart|stop conqchat`; updates with `git pull && bash deploy/setup.sh`; cleanup by deleting the VM (or its resource group/project) and its static IP. **Cost.** Free-tier eligible on new accounts; otherwise about US$7–14 per month (≈ US$0.25–0.45 per day) on pay-as-you-go, controlled with a US$5 budget alert and by deleting the resources after assessment."),

  H1("9. CHALLENGES AND LIMITATIONS"),
  H2("9.1 Challenges"),
  ...UL([
    "**Understanding that TCP has no message boundaries.** Treating each read() as one message works on a quiet local network but fails when messages are sent quickly or are large; writing the framer and testing every split point made the byte-stream model concrete.",
    "**Cloud account restrictions.** The first cloud account I tried blocked virtual machines entirely through an organisation-level policy, so the deployment had to move to another provider.",
  ]),
  H2("9.2 Limitations"),
  ...UL([
    "**No TLS:** traffic is not encrypted (see Section 8).",
    "**Single server process:** the ConnectionManager lives in memory, so the server cannot be scaled to several processes without a shared message broker.",
    "**Blocking database calls:** database queries run inside the event loop. This is fine for a class-sized load but would limit throughput under heavy use.",
    "**One-to-one chat only:** group chat, read receipts and offline notifications are not implemented.",
    "**Experiments on loopback:** loss and delay were emulated on one machine, which is controlled and repeatable but does not reproduce real Internet behaviour such as bursty loss.",
  ]),

  H1("10. CONCLUSION"),
  P("ConqChat meets the core requirements of the assignment: a multi-user chat server that accepts many simultaneous TCP connections, a terminal client that talks to it over raw TCP sockets, a browser client over WebSockets, a documented newline-delimited JSON protocol with explicit framing, and careful handling of every way a connection can end."),
  P("Building it turned the transport-layer concepts into concrete code. The port number and 4-tuple are what let one server port serve many users. The byte-stream model is the reason framing exists. FIN and RST correspond to different branches in the server's code. Keepalive and send timeouts are the answer to failures TCP cannot report on its own. The comparison experiment shows the trade-off between TCP's reliability and UDP's simplicity and lower overhead, and why each suits different parts of a chat system."),

  H1("REFERENCES"),
  ...OL([
    "Eddy, W. (Ed.) (2022). RFC 9293: Transmission Control Protocol (TCP). IETF.",
    "Postel, J. (1980). RFC 768: User Datagram Protocol. IETF.",
    "Fette, I. and Melnikov, A. (2011). RFC 6455: The WebSocket Protocol. IETF.",
    "Braden, R. (Ed.) (1989). RFC 1122: Requirements for Internet Hosts – Communication Layers (TCP keep-alives). IETF.",
    "Kurose, J. F. and Ross, K. W. (2021). Computer Networking: A Top-Down Approach (8th ed.). Pearson.",
    "Python Software Foundation (2026). asyncio – Streams; socket – Low-level networking interface. docs.python.org.",
    "Linux man-pages. tc-netem(8): Network Emulator.",
    "Wireshark Foundation. Wireshark User's Guide: TCP Analysis. wireshark.org.",
  ]),

  H1("APPENDIX A: KEY COMMANDS"),
  ...CODE(`python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
uvicorn app.main:app --reload                      # web on :8000, TCP chat on :5000
python client/chat_client.py --host 127.0.0.1 --port 5000
python -m pytest -v                                # 41 automated tests
python tools/framing_demo.py --port 5000           # framing demo (server with LOG_LEVEL=DEBUG)
python experiments/run_windows_captures.py         # experiments 1, 3, 4 (Wireshark/Npcap)
clumsy.exe --filter "tcp.DstPort == 6000 or tcp.SrcPort == 6000 or udp.DstPort == 6000 or udp.SrcPort == 6000"
           --drop on --drop-chance 10              # or: --ood on --ood-chance 20 / --lag on --lag-time 50
python experiments/run_windows_impaired.py loss10 "clumsy drop 10%"
sudo tc qdisc add dev lo root netem loss 10%       # Linux equivalent (experiments/run_experiments.sh)`),
  H1("APPENDIX B: ADDITIONAL CAPTURE FIGURES"),
  IMG("docs/report/screenshots/fig7_follow_stream.png", 5.2, 2.05),
  CAPTION("Figure B1: Follow TCP Stream of exp1_handshake.pcapng: one JSON object per line (password redacted)."),
  IMG("docs/report/screenshots/fig2_flowgraph.png", 4.2, 3.78),
  CAPTION("Figure B2: Timeline of the Experiment 1 connection drawn from the capture (red = SYN/FIN, blue = data)."),
];

const doc = new Document({
  creator: "Julius Oche Osamudianme",
  title: "Design, Implementation and Cloud Deployment of a Multi-User TCP Chat Application",
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 46, bold: true, color: "000000" },
        paragraph: { spacing: { before: 280, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 34, bold: true, color: "000000" },
        paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 26, bold: true, color: "000000" },
        paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: numberingConfigs },
  sections: [
    { properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children: cover },
    { properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        pageNumbers: { start: 1 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })] })] }) },
      children: body },
  ],
});

const out = path.join(__dirname, "ConqChat_Technical_Report.docx");
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("Wrote", out); });
