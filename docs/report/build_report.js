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
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({
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
  ["baseline", "UDP/TCP", "Azure VM loopback, no impairment", "[[PENDING]]", "", "", "", ""],
  ["loss10", "UDP/TCP", "netem loss 10%", "[[PENDING]]", "", "", "", ""],
  ["jitter_loss5", "UDP/TCP", "netem delay 20ms 15ms loss 5%", "[[PENDING]]", "", "", "", ""],
], { size: 17 });

// ---------- report body ----------
const body = [
  new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 280 }, children: [new TextRun({ text: "TABLE OF CONTENTS", font: FONT, size: 46, bold: true })] }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-1" }),

  new Paragraph({ children: [new PageBreak()] }),
  H1("1. INTRODUCTION AND OBJECTIVES"),
  H2("1.1 Background"),
  P("Almost every networked application relies on the transport layer of the TCP/IP suite to move data between processes running on different machines. The network layer (IP) only delivers packets between hosts, on a best-effort basis: packets may be lost, duplicated or delivered out of order. The transport layer adds process-to-process delivery through port numbers and, in the case of TCP, a reliable, ordered, connection-oriented byte stream."),
  P("A chat application is a good way to see these ideas in practice. Several users stay connected at the same time, messages must arrive complete and in order, and the server must notice when a user joins, leaves or disappears without warning. This report describes **ConqChat**, a multi-user chat application I designed, implemented, tested and prepared for cloud deployment, and explains how it uses TCP sockets, port numbers, connections and application-level message framing. The source code, tests and documentation are at **https://github.com/Conqy-dev/CHAT-APP**."),
  H2("1.2 Objectives"),
  P("The objectives of the work were to:"),
  ...OL([
    "Implement client-server communication using TCP sockets, with a server that accepts and manages many clients at once.",
    "Demonstrate the roles of IP addresses, port numbers, connections and application-layer message framing.",
    "Handle the full connection lifecycle: establishment, normal disconnection and unexpected client termination.",
    "Evaluate TCP and UDP experimentally under normal and impaired network conditions.",
    "Deploy and validate the application on a public cloud platform, with appropriate security and cost controls.",
  ]),
  H1("2. SYSTEM REQUIREMENTS"),
  TABLE([0.6, 4.2, 2.2], [
    ["ID", "Requirement", "Where it is met"],
    ["F1", "A chat server that accepts and manages multiple client connections at the same time", "app/tcp_server.py, app/main.py"],
    ["F2", "A client that connects to the server using TCP", "client/chat_client.py"],
    ["F3", "User identification by username (with password)", "register / login commands"],
    ["F4", "Real-time text messaging between at least two connected users", "send_message → new_message"],
    ["F5", "One-to-one (private) messaging", "conversations between two users"],
    ["F6", "Handling of connection establishment, disconnection and unexpected termination", "Section 4.4"],
    ["F7", "A documented message format with explicit framing", "Section 4.3, docs/protocol.md"],
    ["F8", "Validation of usernames and messages; malformed input must not crash the server", "Section 4.5"],
    ["F9", "Server-side connection and error logs", "logs/server.log"],
  ]),
  GAP(),
  H1("3. SYSTEM ARCHITECTURE"),
  H2("3.1 Overview"),
  P("ConqChat is a client-server system. One server process runs an asyncio event loop that listens on two TCP ports at the same time: **port 5000** for the raw TCP chat protocol used by the terminal client, and **port 8000** for the web interface (HTTP and WebSocket). Both entry points share the same chat logic, the same PostgreSQL database and the same registry of live connections, so a user in a terminal can chat with a user in a browser."),
  IMG("docs/diagrams/application-architecture.png", 6.5, 3.9),
  CAPTION("Figure 1: Application architecture. Every arrow is a TCP connection."),
  H2("3.2 Data Model"),
  P("There are three tables. **users** (id, unique username, Argon2 password hash, created_at), **conversations** (id, user_one_id, user_two_id, created_at, with a uniqueness constraint so a pair of users has exactly one conversation, and the smaller id always stored first) and **messages** (id, conversation_id, sender_id, content, created_at, read_at). An index on (conversation_id, id) makes loading recent history fast."),
  H2("3.3 Cloud Deployment Architecture"),
  P("[[PENDING: cloud deployment diagram (Figure 2) and description, to be added after deployment.]]"),

  H1("4. IMPLEMENTATION AND MESSAGE PROTOCOL"),
  H2("4.1 Sockets, Ports and Concurrency"),
  P("The server creates a listening TCP socket with `asyncio.start_server(handle_connection, host, port)`. With `TCP_HOST=0.0.0.0` it accepts connections on every network interface, and `TCP_PORT=5000` sets the port. Both values come from environment variables, so the listening port can be changed without changing code (edit `.env` and restart)."),
  P("When a client connects, the operating system completes the three-way handshake (SYN, SYN-ACK, ACK) and places the new connection in the listen queue. asyncio then accepts it and starts a separate coroutine, `handle_connection`, for that client. Each accepted connection is a **new socket** identified by the 4-tuple (server IP, server port 5000, client IP, client ephemeral port). This is how one server port serves many clients at once: the operating system demultiplexes incoming segments to the right socket using all four values. The server logs the client's address and port on every connection, for example `TCP connect from 127.0.0.1:8775`."),
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
  P("The messages themselves, login, and history must stay on TCP. In ConqChat everything currently uses TCP; UDP is used only in the separate comparison experiment."),
  H2("5.5 What happens if a UDP message is lost or arrives out of order?"),
  P("UDP does nothing. A lost datagram is never retransmitted and the receiver is not told; datagrams that arrive out of order are passed to the application in the order they arrived; duplicates are passed up too. If the application needs reliability or ordering it must add sequence numbers, acknowledgements, timeouts and a reorder buffer itself, as the comparison tool's sequence numbers show (Section 5.10)."),
  H2("5.6 How do sockets and port numbers enable communication between processes?"),
  P("An IP address identifies a host; a **port number** identifies a process (more precisely, a socket) on that host. A **socket** is the operating-system endpoint that a program reads from and writes to. In ConqChat the server binds a listening socket to port 5000. A client's operating system picks a temporary **ephemeral port** (for example 54122) for its side. The connection is identified by the 4-tuple (client IP, client port, server IP, 5000). When a segment arrives, the server's TCP uses all four values to deliver it to the correct connection socket, and therefore to the coroutine serving that user. This is why hundreds of clients can share the single server port 5000 without confusion. The server prints these values in its log, and the terminal client prints its own local and remote address and port when it connects."),
  H2("5.7 What happens when a client disconnects while using TCP?"),
  P("In a **normal disconnect** the client's application calls close(); its TCP sends **FIN**, the server acknowledges it, and the server's next read() returns an empty result (end of stream). ConqChat then removes the user's connection, closes its own side (a second FIN/ACK exchange) and logs the reason. The side that closed first stays in TIME_WAIT for a short period so that delayed segments from the old connection cannot be mistaken for a new one."),
  P("If the client **aborts** (or its machine refuses data for a closed socket), the server receives **RST** and the next read raises ConnectionResetError; the connection is torn down immediately with no orderly exchange. If the client **disappears silently** (power failure, Wi-Fi lost), nothing is sent at all; the server only finds out when it tries to send and gets no acknowledgement, or when TCP keepalive probes go unanswered. ConqChat enables keepalive (probes after 60 s of silence) for this reason. In all three cases the other users stay connected and unaffected; this is shown by the test in which one of three clients aborts while the other two keep chatting."),
  H2("5.8 Why TCP needs application-level message framing"),
  P("TCP delivers a stream of bytes with no record of where one write ended and the next began. Segment sizes depend on the MSS, Nagle's algorithm, the receive window and timing, and the receiver's read() returns whatever happens to be in its buffer. Without framing, a server could try to parse half a JSON object, or two objects joined together, and fail. Newline delimiting (or length-prefixing) restores message boundaries at the application layer. UDP does not need this because each datagram is delivered whole or not at all."),
  H2("5.9 What TCP cannot guarantee after a connection failure"),
  ...UL([
    "**Delivery to the application:** an ACK only means the receiving TCP stack has the bytes, not that the application read or processed them. If the server crashes after the ACK, the message may be lost.",
    "**Knowing what was received:** when a connection breaks, the sender cannot tell which of its last bytes reached the other application. Data still in the send buffer is lost.",
    "**Continuity across connections:** a new connection starts fresh; TCP does not resume or replay anything from the old one.",
    "**Timely detection:** a silent failure may not be noticed for minutes without keepalive or application heartbeats.",
  ]),
  P("ConqChat handles this at the application level. Every message is **saved in the database before it is delivered**, the sender receives its own message back as confirmation, and a reconnecting client can request the conversation **history** to recover anything it missed (demonstrated in the reconnect test)."),
  H2("5.10 TCP versus UDP Practical Comparison"),
  P("A separate tool, `tools/tcp_udp_compare.py`, runs an echo server for both protocols and a client that sends numbered messages and records which come back, in what order, and the round-trip time of each. Each run is reproduced with `python tools/tcp_udp_compare.py server --port 6000` and `python tools/tcp_udp_compare.py client --proto tcp|udp --count 100 --label <name>` (loss applied with `tc netem`); all experiments are scripted in `experiments/run_experiments.sh` and `experiments/run_windows_captures.py`. Raw per-message results are saved as CSV files in `experiments/results/`."),
  resultTable,
  CAPTION("Table: TCP/UDP comparison results (100 numbered messages unless stated)"),
  P("**Discussion.** On the loopback interface with no impairment both protocols delivered every message in order, with round-trip times well below a millisecond; under these ideal conditions UDP's lack of reliability is invisible. [[PENDING: discussion of the loss and jitter runs: UDP counts lost and reordered messages, TCP delivers all messages in order but with RTT spikes at each retransmission.]]"),
  P("**What the results do and do not prove.** They show how each protocol behaves on one host under controlled, artificial impairment, for 100 small messages. They do not measure real Internet paths, where loss is bursty and correlated, nor do they prove one protocol is \"faster\" in general: on loopback both are limited by the CPU and the Python code rather than the network."),

  H1("6. TCP EXPERIMENTS"),
  P("Experiments 1, 3 and 4 were captured on Windows 11 over the loopback adapter with Wireshark/Npcap, using `experiments/run_windows_captures.py`, which starts a throwaway server and scripted clients. Experiment 2 needs packet loss injected below TCP (`tc netem` on Linux, via `experiments/run_experiments.sh`). The captures are in `experiments/results/`. Only a throwaway test account was used, so no real chat content or passwords appear in them."),
  H2("6.1 Experiment 1: Connection Establishment"),
  P("**Method.** tcpdump captures port 5000 while the terminal client connects, sends a ping and quits. **Expected:** Three segments open the connection: SYN from the client's ephemeral port to port 5000 (with its initial sequence number and options such as MSS and window scale), SYN-ACK from the server (its own ISN, acknowledging client ISN + 1), and ACK from the client. The server's welcome message follows as the first data segment."),
  P("**Result** (`exp1_handshake.pcapng`). Frames 1–3 are the handshake between the client 127.0.0.1:**8184** (ephemeral port) and the server 127.0.0.1:**5000**: [SYN] Seq=0, [SYN, ACK] Seq=0 Ack=1, [ACK] Seq=1 Ack=1. The raw initial sequence numbers were 1104412013 (client) and 3828679214 (server); the SYN-ACK acknowledged 1104412014, because a SYN consumes one sequence number. Both sides offered MSS 65495 (the loopback MTU), window scaling ×256 and SACK. The handshake completed in 0.108 ms. Frame 4 is the server's 86-byte welcome message ([PSH, ACK] Seq=1), and the client's next ACK is 87 = 1 + 86, showing byte-level acknowledgement. The session ended with the four-segment FIN exchange in frames 18–21."),
  P("[[Insert annotated Wireshark screenshot of frames 1–4 (Statistics → Flow Graph).]]"),
  H2("6.2 Experiment 2: Packet Loss and Retransmission"),
  P("**Method.** `tc qdisc add dev lo root netem loss 10%` drops 10% of packets, then 100 numbered messages are sent over TCP and over UDP, with the TCP run captured. **Expected:** Wireshark marks [TCP Retransmission], [TCP Dup ACK] and possibly [TCP Fast Retransmission]; every message still arrives, in order, but affected messages show RTT spikes about one retransmission timeout (around 200 ms or more) long. The UDP run shows missing sequence numbers instead."),
  P("[[PENDING: retransmission screenshot from exp2_tcp_loss10.pcap and the measured counts.]]"),
  H2("6.3 Experiment 3: Connection Termination"),
  P("**Method.** Three captures: a normal /quit, an abrupt /crash (SO_LINGER = 0), and killing the client process with SIGKILL. The server log for the same period is saved. **Expected:** Normal close: FIN/ACK from the client, FIN/ACK from the server (four-way close), server log 'FIN received'. Abort: a single RST, server log 'connection reset by peer (RST received)'. Killed process: the operating system closes the socket and sends FIN, so the server sees a normal end of stream. In each case the server removes the user from the ConnectionManager."),
  P("**Results.** *Normal close* (`exp3_normal_close.pcapng`): the client sent [FIN, ACK] (frame 14, Seq=89), the server acknowledged it and sent its own [FIN, ACK] (frame 16), which the client acknowledged: an orderly four-way close started by the client. The server logged `reason=client closed the connection (FIN received)`. *Abort* (`exp3_abort_rst.pcapng`): a single [RST, ACK] from the client (frame 10, Win=0) with no reply; the server logged `reason=connection reset by peer (RST received)`. *Killed process* (`exp3_process_killed.pcapng`): after the handshake and welcome, the client's operating system sent **[RST, ACK]** (frame 6), not FIN. On Windows a terminated process's sockets are aborted, whereas on Linux the kernel normally closes them with FIN. In all three cases the server removed the connection and the log shows `open TCP connections: 0`."),
  P("[[Insert screenshots of the FIN exchange and the RST, next to the matching server log lines in experiments/results/exp3_server_log.txt.]]"),
  H2("6.4 Experiment 4: Flow Control and Performance"),
  P("**Method.** RTT (100 messages) and throughput (5000 × 1000-byte messages as fast as possible) are measured under two conditions: no impairment, and `netem delay 50ms rate 10mbit` (100 ms RTT, 10 Mbit/s bottleneck). **Expected:** RTT rises from well under 1 ms to about 100 ms. Throughput drops and becomes limited by the bottleneck rate and by the window: at most one window of data per RTT. Wireshark's window-size column shows the advertised receive window and, under load, its scaling."),
  P("**Baseline result** (`exp4_loopback.pcapng`, Windows loopback). 100 timed messages: RTT average **0.30 ms** (95th percentile 0.39 ms, maximum 0.66 ms). Bulk transfer: 5000 × 1000-byte messages echoed in 0.21 s, about **23,700 messages/s (≈190 Mbit/s)** of application data. Wireshark measured an average ACK round trip of 0.03 ms over 7,662 ACKs. The advertised window (scaled ×256) stayed between **33,280 and 65,535 bytes** and never reached zero, so the receiver kept up and flow control never had to stop the sender. 21 duplicate ACKs but no retransmissions were flagged, as expected on a lossless link."),
  P("[[PENDING: second condition with 50 ms added delay; screenshot of Statistics → TCP Stream Graphs → Window Scaling.]]"),

  H1("7. TESTING AND RESULTS"),
  H2("7.1 Automated Tests"),
  P("The automated suite (`python -m pytest`) starts the real server on free ports with a temporary database and talks to it over real TCP sockets. The latest run passed **41 of 41 tests** in 6.8 seconds."),
  TABLE([2.2, 0.7, 4.1], [
    ["Test file", "Tests", "What it covers"],
    ["tests/test_framing.py", "6", "Split reads, combined reads, every possible split point (including inside multi-byte UTF-8 characters), CRLF, oversized frames"],
    ["tests/test_tcp.py", "16", "Two-way TCP chat, TCP ↔ browser chat, split/combined frames on a real socket, 8 malformed inputs, access control, oversized frame, three clients with abort and reconnect, clean quit logging"],
    ["tests/test_websocket.py", "12", "Live delivery to both users, HTTP messages pushed live, 8 invalid events, outsider blocked, handshake rejected without login or from another site"],
    ["tests/test_api.py", "7", "Registration, login and logout, validation, search, conversation rules, history paging and privacy"],
  ]),
  GAP(),
  H2("7.2 Key Results"),
  ...UL([
    "**Three simultaneous clients with reconnect:** client C aborts with RST while A and B keep chatting; C reconnects, logs in, receives new messages live and retrieves the history. The server log shows C's RST and the cleanup.",
    "**Malformed input:** every bad input receives a specific error and the connection keeps working.",
    "**Framing:** both automated tests and the live demonstration show messages split across reads and combined in one read are handled correctly.",
  ]),
  P("The complete test log, including manual and cloud tests, is in `docs/test-log.md`."),
  P("[[PENDING: screenshots of two users chatting on the deployed system.]]"),

  H1("8. CLOUD DEPLOYMENT"),
  P("[[PENDING: cloud service selection and reasons, provisioning steps, firewall rules, TLS statement, secrets, start/restart/shutdown/cleanup, cost estimate and spending alert, public address and evidence of two users chatting.]]"),

  H1("9. CHALLENGES AND LIMITATIONS"),
  H2("9.1 Challenges"),
  ...UL([
    "**Understanding that TCP has no message boundaries.** My first idea was to treat each read() as one message, which works on a quiet local network but breaks as soon as messages are sent quickly or are large. Writing the framer and testing it at every possible split point made the byte-stream nature of TCP concrete.",
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
        paragraph: { spacing: { before: 480, after: 200 }, keepNext: true, outlineLevel: 0 } },
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
