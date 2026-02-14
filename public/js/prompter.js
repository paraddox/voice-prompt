import { clamp, pickFontFamily, readingLineRatio, setCssVar, setTheme } from "./shared.js";

const el = {
  prompter: document.getElementById("prompter"),
  startStopBtn: document.getElementById("startStopBtn"),
  resetBtn: document.getElementById("resetBtn")
};

let wordEls = [];
let currentIndex = 0;
let lastState = null;

function renderScript(text) {
  wordEls = [];
  const inner = document.createElement("div");
  inner.className = "prompterInner";
  const parts = String(text ?? "").split(/(\s+)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.trim() === "") {
      inner.appendChild(document.createTextNode(part));
      continue;
    }
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = part;
    inner.appendChild(span);
    wordEls.push(span);
  }
  el.prompter.innerHTML = "";
  el.prompter.appendChild(inner);
}

function applySettings(settings) {
  setCssVar("--prompter-font-size", `${settings.fontSize}px`);
  setCssVar("--prompter-font-family", pickFontFamily(settings.fontFamily));
  setCssVar("--prompter-text-width", `${settings.textWidth}%`);
  setCssVar("--reading-line-y", `${Math.round(readingLineRatio(settings.readingLine) * 100)}%`);
  setCssVar("--prompter-bg", settings.bgColor);
  setCssVar("--prompter-fg", settings.textColor);
  setTheme(settings.lightDisplay);
  el.prompter.classList.toggle("mirror", Boolean(settings.mirror));
}

function updateHighlight(next) {
  const prev = currentIndex;
  if (!wordEls.length) return;

  // Clear a small window around prev to avoid O(n) DOM work on long scripts.
  for (let i = Math.max(0, prev - 6); i < Math.min(wordEls.length, prev + 6); i++) {
    wordEls[i].classList.remove("current");
  }

  // Mark done by comparing to index (simple and stable).
  // This is O(n) but happens only on state updates, not on every animation frame.
  for (let i = 0; i < wordEls.length; i++) {
    wordEls[i].classList.toggle("done", i < next);
  }

  if (next < wordEls.length) wordEls[next].classList.add("current");
  currentIndex = next;
}

function scrollToWord(index, settings) {
  if (!wordEls.length) return;
  const i = clamp(index, 0, wordEls.length - 1);
  const w = wordEls[i];
  const ratio = readingLineRatio(settings.readingLine);
  const target = w.offsetTop - el.prompter.clientHeight * ratio + w.offsetHeight * 0.5;
  el.prompter.scrollTop = clamp(target, 0, el.prompter.scrollHeight);
}

function applyState(state) {
  if (!state) return;
  const first = !lastState || lastState.script !== state.script;
  lastState = state;

  applySettings(state.settings);

  if (first) renderScript(state.script);

  updateHighlight(clamp(state.position, 0, wordEls.length));
  scrollToWord(state.position, state.settings);
}

const bc = new BroadcastChannel("voice-prompter");
bc.onmessage = (ev) => {
  const msg = ev?.data ?? {};
  if (msg.t === "state") applyState(msg.state);
};
bc.postMessage({ t: "ready" });

function sendCmd(cmd) {
  bc.postMessage({ t: "cmd", cmd });
}

el.startStopBtn.addEventListener("click", () => sendCmd("startStop"));
el.resetBtn.addEventListener("click", () => sendCmd("reset"));

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    sendCmd("startStop");
  }
});

