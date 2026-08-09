// Coach vocal : utilise l'API native SpeechSynthesis du navigateur (gratuite, aucune
// clé requise). Fonctionne hors-ligne selon les voix installées sur l'appareil.

let frenchVoice = null;
let voicesReady = false;

function loadVoices() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (voices.length === 0) return;
  frenchVoice =
    voices.find((v) => v.lang === "fr-FR") ||
    voices.find((v) => v.lang && v.lang.startsWith("fr")) ||
    null;
  voicesReady = true;
}

export function isSupported() {
  return "speechSynthesis" in window;
}

if (isSupported()) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

let currentUtterance = null;
let queue = [];
let queueIndex = 0;
let queueCallbacks = {};
let paused = false;

export function isSpeaking() {
  return isSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
}

export function isPaused() {
  return paused;
}

export function stop() {
  queue = [];
  queueIndex = 0;
  paused = false;
  if (isSupported()) window.speechSynthesis.cancel();
}

// Speak a single piece of text. Calls onEnd() when finished (or immediately on error).
export function speakOne(text, onEnd) {
  if (!isSupported()) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "fr-FR";
  if (frenchVoice) utter.voice = frenchVoice;
  utter.rate = 1.0;
  utter.pitch = 1.0;
  currentUtterance = utter;
  utter.onend = () => { if (onEnd) onEnd(); };
  utter.onerror = () => { if (onEnd) onEnd(); };
  window.speechSynthesis.speak(utter);
}

// Play a sequence of { text, onStart } items back to back.
// callbacks: { onItemStart(index), onComplete() }
export function playSequence(items, callbacks = {}) {
  stop();
  queue = items;
  queueIndex = 0;
  queueCallbacks = callbacks;
  paused = false;
  playNext();
}

function playNext() {
  if (paused) return;
  if (queueIndex >= queue.length) {
    if (queueCallbacks.onComplete) queueCallbacks.onComplete();
    return;
  }
  const item = queue[queueIndex];
  if (queueCallbacks.onItemStart) queueCallbacks.onItemStart(queueIndex);
  speakOne(item.text, () => {
    queueIndex++;
    playNext();
  });
}

export function pauseSequence() {
  if (!isSupported()) return;
  paused = true;
  window.speechSynthesis.cancel();
}

export function resumeSequence() {
  if (queueIndex >= queue.length) return;
  paused = false;
  playNext();
}
