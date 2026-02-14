function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

const session = (qs("session") ?? "").toUpperCase();

const el = {
  connPill: document.getElementById("connPill"),
  sessionId: document.getElementById("sessionId"),
  statusText: document.getElementById("statusText"),
  modeText: document.getElementById("modeText"),
  startStopBtn: document.getElementById("startStopBtn"),
  resetBtn: document.getElementById("resetBtn"),
  prevWordBtn: document.getElementById("prevWordBtn"),
  nextWordBtn: document.getElementById("nextWordBtn"),
  prevSentBtn: document.getElementById("prevSentBtn"),
  nextSentBtn: document.getElementById("nextSentBtn"),
  slowerBtn: document.getElementById("slowerBtn"),
  fasterBtn: document.getElementById("fasterBtn")
};

el.sessionId.textContent = session || "-";

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function send(ws, msg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function setConn(text, ok) {
  el.connPill.textContent = text;
  el.connPill.style.borderColor = ok ? "rgba(255,176,0,0.35)" : "rgba(255,77,77,0.35)";
  el.connPill.style.color = "rgba(245,241,232,0.95)";
}

function cmd(ws, c) {
  send(ws, { t: "cmd", cmd: c });
}

function connect() {
  if (!session) {
    setConn("Missing session", false);
    el.statusText.textContent = "Open this page from the QR/link shown in the desktop app.";
    return;
  }

  const ws = new WebSocket(wsUrl());
  setConn("Connecting...", false);

  ws.addEventListener("open", () => {
    send(ws, { t: "hello", role: "remote", id: session, version: 1 });
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data ?? "{}"));
    if (msg.t === "ok") {
      setConn("Connected", true);
      return;
    }
    if (msg.t === "state") {
      const s = msg.state ?? {};
      el.statusText.textContent = s.running ? "Running" : "Stopped";
      el.modeText.textContent = s.settings?.mode === "auto" ? "Auto-scroll" : "Voice tracking";
      return;
    }
    if (msg.t === "err") {
      setConn("Error", false);
      el.statusText.textContent = msg.message ?? "Error";
    }
  });

  ws.addEventListener("close", () => {
    setConn("Disconnected", false);
    setTimeout(connect, 1200);
  });

  el.startStopBtn.addEventListener("click", () => cmd(ws, "startStop"));
  el.resetBtn.addEventListener("click", () => cmd(ws, "reset"));
  el.prevWordBtn.addEventListener("click", () => cmd(ws, "prevWord"));
  el.nextWordBtn.addEventListener("click", () => cmd(ws, "nextWord"));
  el.prevSentBtn.addEventListener("click", () => cmd(ws, "prevSentence"));
  el.nextSentBtn.addEventListener("click", () => cmd(ws, "nextSentence"));
  el.slowerBtn.addEventListener("click", () => cmd(ws, "slower"));
  el.fasterBtn.addEventListener("click", () => cmd(ws, "faster"));
}

connect();
