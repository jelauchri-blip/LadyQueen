// Chronomètre d'échecs simple (cadence de base + incrément Fischer).
// baseMinutes === null signifie "illimité" : le chrono ne démarre jamais.

export function createClock({ baseMinutes, incrementSeconds, onTick, onFlag }) {
  const baseMs = baseMinutes === null ? null : baseMinutes * 60000;
  const incMs = (incrementSeconds || 0) * 1000;

  let whiteMs = baseMs;
  let blackMs = baseMs;
  let turn = "w";
  let running = false;
  let lastTs = null;
  let timerId = null;

  function tick() {
    if (!running || baseMs === null) return;
    const now = Date.now();
    const elapsed = now - lastTs;
    lastTs = now;
    if (turn === "w") whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
    if (onTick) onTick({ whiteMs, blackMs, turn });
    if (whiteMs === 0 || blackMs === 0) {
      stop();
      if (onFlag) onFlag(whiteMs === 0 ? "w" : "b");
    }
  }

  function start() {
    if (baseMs === null) return; // untimed game, nothing to run
    running = true;
    lastTs = Date.now();
    clearInterval(timerId);
    timerId = setInterval(tick, 200);
  }

  function stop() {
    running = false;
    clearInterval(timerId);
    timerId = null;
  }

  // Call right after `moverColor` has completed their move: applies the
  // increment to the mover's clock and switches the running clock to the
  // other side.
  function afterMove(moverColor) {
    if (baseMs === null) return;
    if (moverColor === "w") whiteMs += incMs; else blackMs += incMs;
    turn = moverColor === "w" ? "b" : "w";
    lastTs = Date.now();
    if (onTick) onTick({ whiteMs, blackMs, turn });
  }

  function isTimed() {
    return baseMs !== null;
  }

  function getState() {
    return { whiteMs, blackMs, turn, running };
  }

  return { start, stop, afterMove, isTimed, getState };
}

export function formatClock(ms) {
  if (ms === null || ms === undefined) return "—";
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
