export const STORAGE_KEY = "voicePrompter.state.v1";

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizeWord(w) {
  // Normalize to improve matching across punctuation and typographic marks.
  return String(w ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

export function splitSpokenWords(transcript) {
  return String(transcript ?? "")
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

export function safeJsonParse(s) {
  try {
    return JSON.parse(String(s));
  } catch {
    return null;
  }
}

export function loadState(defaultState) {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? safeJsonParse(raw) : null;
  if (!parsed || typeof parsed !== "object") return structuredClone(defaultState);

  // Shallow merge is enough for this app state shape.
  const next = structuredClone(defaultState);
  if (typeof parsed.script === "string") next.script = parsed.script;
  if (typeof parsed.position === "number") next.position = parsed.position;
  if (typeof parsed.running === "boolean") next.running = parsed.running;
  if (parsed.settings && typeof parsed.settings === "object") {
    next.settings = { ...next.settings, ...parsed.settings };
  }
  return next;
}

export function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      script: state.script,
      position: state.position,
      running: false, // never auto-start after refresh
      settings: state.settings
    })
  );
}

export function levenshteinWithin(a, b, maxDist) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Math.abs(a.length - b.length) > maxDist) return false;

  // Classic DP with early exit; maxDist is small (<=2).
  const m = a.length;
  const n = b.length;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let minRow = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < minRow) minRow = curr[j];
    }
    if (minRow > maxDist) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[n] <= maxDist;
}

export function readingLineRatio(pos) {
  if (pos === "lower") return 0.72;
  if (pos === "middle") return 0.5;
  return 0.28;
}

export function setCssVar(name, value) {
  document.documentElement.style.setProperty(name, String(value));
}

export function setTheme(light) {
  document.body.dataset.theme = light ? "light" : "dark";
}

export function isSpeechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function pickFontFamily(fontKey) {
  switch (fontKey) {
    case "Georgia":
      return "Georgia, serif";
    case "Palatino":
      return "\"Palatino Linotype\", Palatino, serif";
    case "Verdana":
      return "Verdana, sans-serif";
    case "Arial":
      return "Arial, sans-serif";
    case "Monospace":
      return "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    case "system":
    default:
      return "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  }
}

