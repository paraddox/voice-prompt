import {
  clamp,
  isSpeechRecognitionSupported,
  levenshteinWithin,
  loadState,
  normalizeWord,
  pickFontFamily,
  readingLineRatio,
  saveState,
  setCssVar,
  setTheme,
  sleep,
  splitSpokenWords
} from "./shared.js";

const DEFAULT_SCRIPT = `A quick teleprompter check.

If you can see this text, you're ready to roll.

Paste your script on the left, hit Start, and read naturally.
In voice mode, the prompter advances as you speak.

Tip: Use the phone remote for hands-free control on set.`;

const LANGS = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["es-ES", "Spanish (ES)"],
  ["es-MX", "Spanish (MX)"],
  ["fr-FR", "French (FR)"],
  ["de-DE", "Deutsch (DE)"],
  ["it-IT", "Italiano (IT)"],
  ["pt-BR", "Portuguese (BR)"],
  ["pt-PT", "Portuguese (PT)"],
  ["nl-NL", "Nederlands (NL)"],
  ["sv-SE", "Svenska (SE)"],
  ["da-DK", "Dansk (DK)"],
  ["no-NO", "Norsk (NO)"],
  ["pl-PL", "Polski (PL)"],
  ["ru-RU", "Russian (RU)"],
  ["tr-TR", "Turkish (TR)"],
  ["hi-IN", "Hindi (IN)"],
  ["ja-JP", "Japanese (JP)"],
  ["ko-KR", "Korean (KR)"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"]
];

const defaultState = {
  script: DEFAULT_SCRIPT,
  position: 0,
  running: false,
  settings: {
    fontSize: 46,
    fontFamily: "Georgia",
    language: "en-US",
    mode: "voice",
    scrollSpeed: 30,
    textWidth: 80,
    readingLine: "upper",
    mirror: false,
    lightDisplay: false,
    bgColor: "#111110",
    textColor: "#ede8df",
    countdown: true
  }
};

const state = loadState(defaultState);

// ---- DOM ----
const el = {
  supportBadge: document.getElementById("supportBadge"),
  statusLine: document.getElementById("statusLine"),
  scriptInput: document.getElementById("scriptInput"),
  fileInput: document.getElementById("fileInput"),
  pasteBtn: document.getElementById("pasteBtn"),
  clearBtn: document.getElementById("clearBtn"),
  prompter: document.getElementById("prompter"),
  startStopBtn: document.getElementById("startStopBtn"),
  resetBtn: document.getElementById("resetBtn"),
  popoutBtn: document.getElementById("popoutBtn"),

  fontSize: document.getElementById("fontSize"),
  fontFamily: document.getElementById("fontFamily"),
  language: document.getElementById("language"),
  mode: document.getElementById("mode"),
  scrollSpeed: document.getElementById("scrollSpeed"),
  textWidth: document.getElementById("textWidth"),
  readingLine: document.getElementById("readingLine"),
  mirror: document.getElementById("mirror"),
  lightDisplay: document.getElementById("lightDisplay"),
  bgColor: document.getElementById("bgColor"),
  textColor: document.getElementById("textColor"),
  countdown: document.getElementById("countdown"),

  remoteBtn: document.getElementById("remoteBtn"),
  remoteStatus: document.getElementById("remoteStatus"),
  remoteModal: document.getElementById("remoteModal"),
  qr: document.getElementById("qr"),
  sessionId: document.getElementById("sessionId"),
  remoteUrl: document.getElementById("remoteUrl"),
  copyRemoteUrlBtn: document.getElementById("copyRemoteUrlBtn"),
  refreshRemoteUrlBtn: document.getElementById("refreshRemoteUrlBtn"),

  countdownOverlay: document.getElementById("countdownOverlay"),
  countdownNum: document.getElementById("countdownNum")
};

// ---- Speech Recognition ----
let recognition = null;
let voiceShouldRun = false;
let voiceRestartTimer = null;
let lastInterimText = "";

// ---- Prompter parsing ----
let wordEls = [];
let wordNorms = [];
let sentenceStarts = [0];
let currentIndex = 0;
let committedIndex = 0;

// ---- Scheduling (reduce per-word work) ----
let scrollRaf = 0;
let broadcastTimer = null;
let remoteSyncTimer = null;

function scheduleScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    scrollToWord(currentIndex);
  });
}

function scheduleBroadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastState();
  }, 80);
}

function scheduleRemoteSync() {
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = setTimeout(() => {
    remoteSyncTimer = null;
    syncToRemotes();
  }, 120);
}

const COMMON_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "as",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her"
]);

function isWeakWord(w) {
  if (!w) return true;
  if (w.length <= 3) return true;
  return COMMON_WORDS.has(w);
}

function setStatus(text) {
  el.statusLine.textContent = text;
}

function setSupportBadge() {
  if (isSpeechRecognitionSupported()) {
    el.supportBadge.textContent = "Voice OK";
    el.supportBadge.style.borderColor = "rgba(255,176,0,0.35)";
    el.supportBadge.style.color = "rgba(245,241,232,0.9)";
  } else {
    el.supportBadge.textContent = "Voice Unsupported";
    el.supportBadge.style.borderColor = "rgba(255,77,77,0.35)";
    el.supportBadge.style.color = "rgba(245,241,232,0.9)";
  }
}

function applySettings() {
  setCssVar("--prompter-font-size", `${state.settings.fontSize}px`);
  setCssVar("--prompter-font-family", pickFontFamily(state.settings.fontFamily));
  setCssVar("--prompter-text-width", `${state.settings.textWidth}%`);
  setCssVar("--reading-line-y", `${Math.round(readingLineRatio(state.settings.readingLine) * 100)}%`);
  setCssVar("--prompter-bg", state.settings.bgColor);
  setCssVar("--prompter-fg", state.settings.textColor);
  setTheme(state.settings.lightDisplay);

  el.prompter.classList.toggle("mirror", Boolean(state.settings.mirror));
}

function renderScript(text) {
  wordEls = [];
  wordNorms = [];
  sentenceStarts = [0];

  const inner = document.createElement("div");
  inner.className = "prompterInner";

  const parts = String(text ?? "").split(/(\s+)/);
  let lastWordIndex = -1;
  for (const part of parts) {
    if (!part) continue;
    if (part.trim() === "") {
      inner.appendChild(document.createTextNode(part));
      continue;
    }

    const span = document.createElement("span");
    span.className = "word";
    span.textContent = part;
    span.dataset.i = String(wordEls.length);
    inner.appendChild(span);

    const norm = normalizeWord(part);
    wordEls.push(span);
    wordNorms.push(norm);

    // Sentence boundary heuristic: "word.", "word!", "word?" (allow trailing quotes/brackets)
    if (/[.!?](?:["')\\]]+)?$/.test(part) && lastWordIndex !== wordEls.length) {
      sentenceStarts.push(wordEls.length); // next word starts a new sentence
      lastWordIndex = wordEls.length;
    }
  }

  el.prompter.innerHTML = "";
  el.prompter.appendChild(inner);
}

function updateHighlight(prev, next) {
  prev = clamp(prev, 0, wordEls.length);
  next = clamp(next, 0, wordEls.length);

  // Remove previous current marker.
  if (prev < wordEls.length) wordEls[prev]?.classList.remove("current");
  // If we moved backwards, undo "done" on the range.
  if (next < prev) {
    for (let i = next; i < prev && i < wordEls.length; i++) wordEls[i]?.classList.remove("done");
  } else {
    for (let i = prev; i < next && i < wordEls.length; i++) wordEls[i]?.classList.add("done");
  }

  if (next < wordEls.length) wordEls[next]?.classList.add("current");
}

function scrollToWord(index) {
  if (!wordEls.length) return;
  const i = clamp(index, 0, wordEls.length - 1);
  const w = wordEls[i];
  if (!w) return;

  const ratio = readingLineRatio(state.settings.readingLine);
  const target = w.offsetTop - el.prompter.clientHeight * ratio + w.offsetHeight * 0.5;
  el.prompter.scrollTop = clamp(target, 0, el.prompter.scrollHeight);
}

function setPosition(next, { scroll = true, persist = true, commit = true } = {}) {
  const clamped = clamp(next, 0, wordEls.length);
  updateHighlight(currentIndex, clamped);
  currentIndex = clamped;
  state.position = clamped;
  if (commit) committedIndex = clamped;
  if (scroll) scheduleScroll();
  if (persist) saveDebounced();
  scheduleRemoteSync();
  scheduleBroadcast();
}

function resetPrompter() {
  for (const w of wordEls) w.classList.remove("done", "current");
  currentIndex = 0;
  committedIndex = 0;
  state.position = 0;
  if (wordEls[0]) wordEls[0].classList.add("current");
  el.prompter.scrollTop = 0;
  saveDebounced();
  syncToRemotes();
  broadcastState();
  setStatus("Reset.");
}

function nextSentenceIndex(from) {
  for (const s of sentenceStarts) {
    if (s > from) return s;
  }
  return wordEls.length;
}

function prevSentenceIndex(from) {
  let prev = 0;
  for (const s of sentenceStarts) {
    if (s >= from) break;
    prev = s;
  }
  return prev;
}

function advancePositionFromTranscript(
  transcript,
  startPos,
  { lookahead = 12, allowLookahead = true, allowFuzzy = true, allowFuzzyAhead = true } = {}
) {
  const spoken = splitSpokenWords(transcript);
  if (!spoken.length || !wordNorms.length) return clamp(startPos, 0, wordNorms.length);

  let pos = clamp(startPos, 0, wordNorms.length);

  for (let idx = 0; idx < spoken.length; idx++) {
    const w = spoken[idx];
    if (!w) continue;
    if (pos >= wordNorms.length) break;

    const sw0 = wordNorms[pos];
    const weak = isWeakWord(w);

    // Direct (or fuzzy) match at current position.
    if (w === sw0) {
      pos += 1;
      continue;
    }

    if (allowFuzzy && !weak && sw0 && sw0[0] === w[0]) {
      const maxDist = w.length <= 5 ? 1 : 2;
      if (levenshteinWithin(w, sw0, maxDist)) {
        pos += 1;
        continue;
      }
    }

    if (!allowLookahead) continue;

    // Look ahead for exact (and optionally fuzzy) match.
    const maxAhead = weak ? Math.min(2, lookahead) : lookahead;
    const end = Math.min(wordNorms.length - 1, pos + maxAhead);
    let found = -1;
    for (let j = pos + 1; j <= end; j++) {
      if (w === wordNorms[j]) {
        found = j;
        break;
      }
    }
    if (found === -1 && allowFuzzyAhead && !weak && w.length >= 4) {
      const maxDist = w.length <= 5 ? 1 : 2;
      for (let j = pos + 1; j <= end; j++) {
        const sw = wordNorms[j];
        if (!sw) continue;
        if (sw[0] !== w[0]) continue;
        if (levenshteinWithin(w, sw, maxDist)) {
          found = j;
          break;
        }
      }
    }

    if (found === -1) continue;

    // If it's a big jump, require a second word to agree to avoid false matches on common tokens.
    const jump = found - pos;
    if (jump >= 4) {
      const w2 = spoken[idx + 1];
      if (w2) {
        const s1 = wordNorms[found + 1];
        const s2 = wordNorms[found + 2];
        const ok =
          w2 === s1 ||
          w2 === s2 ||
          (!isWeakWord(w2) &&
            s1 &&
            s1[0] === w2[0] &&
            levenshteinWithin(w2, s1, w2.length <= 5 ? 1 : 2));
        if (!ok) continue;
      }
    }

    pos = found + 1;
  }

  return pos;
}

function ensureRecognition() {
  if (!isSpeechRecognitionSupported()) return null;
  if (recognition) return recognition;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const t = res[0]?.transcript;
      if (!t) continue;
      if (res.isFinal) finalText += `${t} `;
      else interimText += `${t} `;
    }

    // Low-latency preview: use interim results to advance display, but don't commit.
    const it = interimText.trim();
    if (it && it !== lastInterimText) {
      lastInterimText = it;
      const previewPos = advancePositionFromTranscript(it, committedIndex, {
        lookahead: 6,
        allowLookahead: true,
        allowFuzzy: true,
        allowFuzzyAhead: false
      });
      if (previewPos > currentIndex) setPosition(previewPos, { persist: false, commit: false });
    }

    // Commit on final results.
    const ft = finalText.trim();
    if (ft) {
      const nextCommitted = advancePositionFromTranscript(ft, committedIndex, {
        lookahead: 14,
        allowLookahead: true,
        allowFuzzy: true,
        allowFuzzyAhead: true
      });
      if (nextCommitted !== committedIndex) {
        setPosition(nextCommitted, { persist: true, commit: true });
      }
    }
  };

  recognition.onerror = (e) => {
    if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
      setStatus("Microphone permission denied.");
      stop();
      return;
    }
    setStatus(`Voice error: ${e?.error ?? "unknown"}`);
  };

  recognition.onend = () => {
    if (!voiceShouldRun) return;
    // Chrome can stop after short inactivity; restart with a tiny backoff.
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer = setTimeout(() => {
      try {
        recognition.lang = state.settings.language;
        recognition.start();
      } catch {
        // noop
      }
    }, 250);
  };

  return recognition;
}

async function runCountdownIfEnabled() {
  if (!state.settings.countdown) return;
  el.countdownOverlay.setAttribute("aria-hidden", "false");
  for (const n of [3, 2, 1]) {
    el.countdownNum.textContent = String(n);
    // Force reflow to restart animation.
    void el.countdownNum.offsetWidth; // eslint-disable-line no-void
    await sleep(900);
  }
  el.countdownOverlay.setAttribute("aria-hidden", "true");
}

let autoRaf = 0;
let autoLastTs = 0;
function autoTick(ts) {
  if (!state.running || state.settings.mode !== "auto") return;
  if (!autoLastTs) autoLastTs = ts;
  const dt = (ts - autoLastTs) / 1000;
  autoLastTs = ts;
  el.prompter.scrollTop += state.settings.scrollSpeed * dt;
  autoRaf = requestAnimationFrame(autoTick);
}

async function start() {
  if (state.running) return;
  if (!state.script.trim()) {
    setStatus("Paste a script first.");
    return;
  }
  state.running = true;
  el.startStopBtn.textContent = "Stop";

  await runCountdownIfEnabled();

  if (state.settings.mode === "voice") {
    const r = ensureRecognition();
    if (!r) {
      setStatus("Voice tracking is not supported in this browser.");
      state.running = false;
      el.startStopBtn.textContent = "Start";
      return;
    }
    voiceShouldRun = true;
    committedIndex = currentIndex;
    try {
      r.lang = state.settings.language;
      r.start();
      setStatus("Listening...");
    } catch {
      setStatus("Could not start voice recognition. Try again.");
      state.running = false;
      el.startStopBtn.textContent = "Start";
      voiceShouldRun = false;
    }
  } else {
    autoLastTs = 0;
    autoRaf = requestAnimationFrame(autoTick);
    setStatus("Auto-scroll running...");
  }

  syncToRemotes();
  broadcastState();
}

function stop() {
  if (!state.running) return;
  state.running = false;
  el.startStopBtn.textContent = "Start";

  if (state.settings.mode === "voice") {
    voiceShouldRun = false;
    clearTimeout(voiceRestartTimer);
    try {
      recognition?.stop();
    } catch {
      // noop
    }
    committedIndex = currentIndex;
    saveDebounced();
    setStatus("Stopped.");
  } else {
    cancelAnimationFrame(autoRaf);
    setStatus("Stopped.");
  }

  syncToRemotes();
  broadcastState();
}

function toggleStartStop() {
  if (state.running) stop();
  else start();
}

// ---- Persistence ----
let saveTimer = null;
function saveDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 220);
}

// ---- BroadcastChannel (pop-out view) ----
const bc = new BroadcastChannel("voice-prompter");
bc.onmessage = (ev) => {
  const msg = ev?.data ?? {};
  if (msg.t === "ready") {
    bc.postMessage({ t: "state", state: exportState() });
    return;
  }
  if (msg.t === "cmd") handleCommand(msg.cmd);
};

function broadcastState() {
  bc.postMessage({ t: "state", state: exportState() });
}

function exportState() {
  return {
    script: state.script,
    position: state.position,
    running: state.running,
    settings: state.settings
  };
}

// ---- WebSocket remote ----
let ws = null;
let sessionId = null;
let remoteCount = 0;
let lanUrls = [];
let lanUrlIdx = 0;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function connectWs() {
  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    el.remoteStatus.textContent = "Connected";
    ws.send(JSON.stringify({ t: "hello", role: "host", version: 1 }));
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data ?? "{}"));
    if (msg.t === "session") {
      sessionId = msg.id;
      el.sessionId.textContent = sessionId;
      updateRemoteLink();
      syncToRemotes();
    } else if (msg.t === "cmd") {
      handleCommand(msg.cmd);
    } else if (msg.t === "remoteCount") {
      remoteCount = msg.n ?? 0;
      el.remoteStatus.textContent = remoteCount ? `Remote x${remoteCount}` : "Connected";
    } else if (msg.t === "err") {
      el.remoteStatus.textContent = "Remote error";
      setStatus(msg.message ?? "Remote error");
    }
  });

  ws.addEventListener("close", () => {
    el.remoteStatus.textContent = "Disconnected";
    sessionId = null;
    setTimeout(connectWs, 1000);
  });

  ws.addEventListener("error", () => {
    // close event will handle retry
  });
}

function syncToRemotes() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  ws.send(JSON.stringify({ t: "state", state: exportState() }));
}

async function loadLanUrls() {
  try {
    const res = await fetch("/api/lan", { cache: "no-store" });
    const json = await res.json();
    const port = location.port ? `:${location.port}` : "";
    const proto = location.protocol;
    const ips = Array.isArray(json.ips) ? json.ips : [];
    lanUrls = ips.map((ip) => `${proto}//${ip}${port}/remote.html?session=${encodeURIComponent(sessionId ?? "")}`);
  } catch {
    lanUrls = [];
  }
  lanUrlIdx = 0;
}

function updateRemoteLink() {
  if (!sessionId) return;
  const fallback = `${location.origin}/remote.html?session=${encodeURIComponent(sessionId)}`;
  const url = lanUrls[lanUrlIdx] ?? fallback;
  el.remoteUrl.value = url;

  // Render QR using qrcode-generator (global `qrcode`).
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    el.qr.innerHTML = qr.createSvgTag({ scalable: true });
  } catch {
    el.qr.textContent = url;
  }
}

function openModal() {
  el.remoteModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  el.remoteModal.setAttribute("aria-hidden", "true");
}

// ---- Commands (remote + popout) ----
function handleCommand(cmd) {
  switch (cmd) {
    case "startStop":
      toggleStartStop();
      return;
    case "reset":
      resetPrompter();
      return;
    case "prevWord":
      setPosition(currentIndex - 1);
      return;
    case "nextWord":
      setPosition(currentIndex + 1);
      return;
    case "prevSentence":
      setPosition(prevSentenceIndex(currentIndex));
      return;
    case "nextSentence":
      setPosition(nextSentenceIndex(currentIndex));
      return;
    case "slower":
      state.settings.scrollSpeed = clamp(state.settings.scrollSpeed - 5, 0, 160);
      el.scrollSpeed.value = String(state.settings.scrollSpeed);
      saveDebounced();
      syncToRemotes();
      broadcastState();
      setStatus(`Speed: ${state.settings.scrollSpeed}`);
      return;
    case "faster":
      state.settings.scrollSpeed = clamp(state.settings.scrollSpeed + 5, 0, 160);
      el.scrollSpeed.value = String(state.settings.scrollSpeed);
      saveDebounced();
      syncToRemotes();
      broadcastState();
      setStatus(`Speed: ${state.settings.scrollSpeed}`);
      return;
    default:
      return;
  }
}

// ---- Wire up UI ----
function initLanguageSelect() {
  for (const [value, label] of LANGS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    el.language.appendChild(opt);
  }
}

function hydrateControls() {
  el.scriptInput.value = state.script;

  el.fontSize.value = String(state.settings.fontSize);
  el.fontFamily.value = state.settings.fontFamily;
  el.language.value = state.settings.language;
  el.mode.value = state.settings.mode;
  el.scrollSpeed.value = String(state.settings.scrollSpeed);
  el.textWidth.value = String(state.settings.textWidth);
  el.readingLine.value = state.settings.readingLine;
  el.mirror.checked = Boolean(state.settings.mirror);
  el.lightDisplay.checked = Boolean(state.settings.lightDisplay);
  el.bgColor.value = state.settings.bgColor;
  el.textColor.value = state.settings.textColor;
  el.countdown.checked = Boolean(state.settings.countdown);
}

function bindControlEvents() {
  el.scriptInput.addEventListener("input", () => {
    state.script = el.scriptInput.value;
    renderScript(state.script);
    resetPrompter();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });

  el.fileInput.addEventListener("change", async () => {
    const file = el.fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    state.script = text;
    el.scriptInput.value = text;
    renderScript(state.script);
    resetPrompter();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });

  el.pasteBtn.addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return;
      state.script = t;
      el.scriptInput.value = t;
      renderScript(state.script);
      resetPrompter();
      saveDebounced();
      syncToRemotes();
      broadcastState();
    } catch {
      setStatus("Clipboard read failed (permission).");
    }
  });

  el.clearBtn.addEventListener("click", () => {
    state.script = "";
    el.scriptInput.value = "";
    renderScript("");
    resetPrompter();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });

  el.startStopBtn.addEventListener("click", toggleStartStop);
  el.resetBtn.addEventListener("click", () => {
    stop();
    resetPrompter();
  });
  el.popoutBtn.addEventListener("click", () => {
    const w = window.open("/prompter.html", "voice-prompter-prompter", "width=980,height=720");
    if (!w) setStatus("Pop-out blocked by your browser.");
  });

  el.fontSize.addEventListener("input", () => {
    state.settings.fontSize = Number(el.fontSize.value);
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.fontFamily.addEventListener("change", () => {
    state.settings.fontFamily = el.fontFamily.value;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.language.addEventListener("change", () => {
    state.settings.language = el.language.value;
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.mode.addEventListener("change", () => {
    const wasRunning = state.running;
    stop();
    state.settings.mode = el.mode.value;
    saveDebounced();
    syncToRemotes();
    broadcastState();
    if (wasRunning) start();
  });
  el.scrollSpeed.addEventListener("input", () => {
    state.settings.scrollSpeed = Number(el.scrollSpeed.value);
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.textWidth.addEventListener("input", () => {
    state.settings.textWidth = Number(el.textWidth.value);
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.readingLine.addEventListener("change", () => {
    state.settings.readingLine = el.readingLine.value;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
    scrollToWord(currentIndex);
  });
  el.mirror.addEventListener("change", () => {
    state.settings.mirror = el.mirror.checked;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.lightDisplay.addEventListener("change", () => {
    state.settings.lightDisplay = el.lightDisplay.checked;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.bgColor.addEventListener("input", () => {
    state.settings.bgColor = el.bgColor.value;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.textColor.addEventListener("input", () => {
    state.settings.textColor = el.textColor.value;
    applySettings();
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });
  el.countdown.addEventListener("change", () => {
    state.settings.countdown = el.countdown.checked;
    saveDebounced();
    syncToRemotes();
    broadcastState();
  });

  el.remoteBtn.addEventListener("click", async () => {
    if (!sessionId) {
      setStatus("Remote not ready yet. Try again in a second.");
      return;
    }
    await loadLanUrls();
    updateRemoteLink();
    openModal();
  });

  el.remoteModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t?.dataset?.close) closeModal();
  });

  el.copyRemoteUrlBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.remoteUrl.value);
      setStatus("Remote link copied.");
    } catch {
      setStatus("Copy failed (permission).");
    }
  });

  el.refreshRemoteUrlBtn.addEventListener("click", () => {
    if (!lanUrls.length) {
      setStatus("No LAN IPs found. Try running on a Wi-Fi network.");
      return;
    }
    lanUrlIdx = (lanUrlIdx + 1) % lanUrls.length;
    updateRemoteLink();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.isContentEditable))
      return;

    if (e.code === "Space") {
      e.preventDefault();
      toggleStartStop();
      return;
    }
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      setPosition(currentIndex - 1);
      return;
    }
    if (e.code === "ArrowRight") {
      e.preventDefault();
      setPosition(currentIndex + 1);
      return;
    }
    if (e.code === "PageDown") {
      e.preventDefault();
      setPosition(nextSentenceIndex(currentIndex));
      return;
    }
    if (e.code === "PageUp") {
      e.preventDefault();
      setPosition(prevSentenceIndex(currentIndex));
      return;
    }
  });
}

// ---- Boot ----
setSupportBadge();
initLanguageSelect();
hydrateControls();
applySettings();
renderScript(state.script);
resetPrompter();
setPosition(clamp(state.position, 0, wordEls.length), { scroll: true });

bindControlEvents();
connectWs();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

setStatus("Ready. Press Space to start.");
