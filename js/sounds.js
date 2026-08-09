// Sons synthétisés via l'API Web Audio — aucun fichier externe requis.

const KEY = "echiquier_sound_enabled";
let ctx = null;

export function isSoundEnabled() {
  const saved = localStorage.getItem(KEY);
  return saved === null ? true : saved === "true";
}

export function setSoundEnabled(v) {
  localStorage.setItem(KEY, v ? "true" : "false");
}

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, startOffset, duration, type = "sine", gainPeak = 0.18) {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playIfEnabled(fn) {
  if (!isSoundEnabled()) return;
  try { fn(); } catch (e) { /* ignore audio errors (e.g. autoplay restrictions) */ }
}

export function playMove() {
  playIfEnabled(() => tone(520, 0, 0.09, "triangle", 0.14));
}

export function playCapture() {
  playIfEnabled(() => { tone(300, 0, 0.1, "square", 0.12); tone(180, 0.02, 0.12, "square", 0.10); });
}

export function playCheck() {
  playIfEnabled(() => { tone(700, 0, 0.09, "sine", 0.16); tone(880, 0.09, 0.13, "sine", 0.16); });
}

// Distinct, more urgent sound used when the player tries to move a piece
// that can't move because their king is in check — a nudge to notice it.
export function playCheckWarning() {
  playIfEnabled(() => {
    tone(220, 0, 0.09, "square", 0.14);
    tone(220, 0.12, 0.09, "square", 0.14);
    tone(220, 0.24, 0.13, "square", 0.14);
  });
}

export function playGameEnd() {
  playIfEnabled(() => {
    tone(440, 0, 0.14, "sine", 0.15);
    tone(554, 0.13, 0.14, "sine", 0.15);
    tone(659, 0.26, 0.22, "sine", 0.16);
  });
}
