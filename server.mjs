import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUESTED_PORT = Number.parseInt(process.env.PORT ?? "", 10);
const DEFAULT_PORTS = [32177, 32178, 32179, 32280, 33333];

function getLanIpv4Addrs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const ifName of Object.keys(nets)) {
    for (const net of nets[ifName] ?? []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return Array.from(new Set(ips)).sort();
}

function makeSessionId() {
  // Short, human-friendly session ids for QR/typing.
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

const app = express();
const server = http.createServer(app);

app.disable("x-powered-by");

app.get("/api/lan", (req, res) => {
  res.json({ ips: getLanIpv4Addrs() });
});

app.get("/vendor/qrcode.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules", "qrcode-generator", "qrcode.js"));
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));

app.use(express.static(path.join(__dirname, "public"), { fallthrough: true }));

// ---- WebSocket relay for phone remotes ----
const wss = new WebSocketServer({ server, path: "/ws" });

/**
 * sessions: id -> { host: WebSocket, remotes: Set<WebSocket>, lastState: any }
 */
const sessions = new Map();

function send(ws, msg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function broadcast(remotes, msg) {
  for (const ws of remotes) send(ws, msg);
}

wss.on("connection", (ws) => {
  ws._vp = { role: null, sessionId: null };

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send(ws, { t: "err", message: "Invalid JSON" });
      return;
    }

    if (msg?.t === "hello" && msg?.role === "host") {
      const id = makeSessionId();
      ws._vp.role = "host";
      ws._vp.sessionId = id;

      sessions.set(id, { host: ws, remotes: new Set(), lastState: null });
      send(ws, { t: "session", id });
      return;
    }

    if (msg?.t === "hello" && msg?.role === "remote") {
      const id = String(msg?.id ?? "").toUpperCase();
      const sess = sessions.get(id);
      if (!sess || sess.host.readyState !== WebSocket.OPEN) {
        send(ws, { t: "err", message: "Unknown or inactive session" });
        return;
      }
      ws._vp.role = "remote";
      ws._vp.sessionId = id;
      sess.remotes.add(ws);
      send(ws, { t: "ok" });
      if (sess.lastState) send(ws, { t: "state", state: sess.lastState });
      broadcast(sess.remotes, { t: "remoteCount", n: sess.remotes.size });
      return;
    }

    const id = ws._vp.sessionId;
    if (!id) return;
    const sess = sessions.get(id);
    if (!sess) return;

    if (msg?.t === "cmd" && ws._vp.role === "remote") {
      send(sess.host, msg);
      return;
    }

    if (msg?.t === "state" && ws._vp.role === "host") {
      sess.lastState = msg.state ?? null;
      broadcast(sess.remotes, msg);
      return;
    }
  });

  ws.on("close", () => {
    const { role, sessionId } = ws._vp ?? {};
    if (!sessionId) return;
    const sess = sessions.get(sessionId);
    if (!sess) return;

    if (role === "host") {
      broadcast(sess.remotes, { t: "err", message: "Host disconnected" });
      sessions.delete(sessionId);
      return;
    }

    if (role === "remote") {
      sess.remotes.delete(ws);
      broadcast(sess.remotes, { t: "remoteCount", n: sess.remotes.size });
    }
  });
});

async function listenOnFirstAvailable(ports) {
  let lastErr = null;
  for (const port of ports) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const onListening = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          server.off("error", onError);
          server.off("listening", onListening);
        };
        server.on("error", onError);
        server.on("listening", onListening);
        server.listen(port);
      });
      return port;
    } catch (err) {
      lastErr = err;
      if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error(`No available ports: ${ports.join(", ")}`);
}

const portsToTry = Number.isFinite(REQUESTED_PORT) ? [REQUESTED_PORT] : DEFAULT_PORTS;

listenOnFirstAvailable(portsToTry)
  .then((port) => {
    const lan = getLanIpv4Addrs();
    // eslint-disable-next-line no-console
    console.log(`voice-prompter listening on http://localhost:${port}`);
    if (lan.length) {
      // eslint-disable-next-line no-console
      console.log(`LAN: ${lan.map((ip) => `http://${ip}:${port}`).join("  ")}`);
    }
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", err);
    process.exit(1);
  });
