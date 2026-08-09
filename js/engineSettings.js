const KEY = "echiquier_engine_depth";

export const DEPTH_PRESETS = {
  rapide: { depth: 12, label: "Rapide", hint: "≈ 1 s / position" },
  equilibre: { depth: 16, label: "Équilibré", hint: "≈ 3 s / position" },
  approfondi: { depth: 20, label: "Approfondi", hint: "≈ 10 s / position" },
};

export function getDepthKey() {
  const saved = localStorage.getItem(KEY);
  return DEPTH_PRESETS[saved] ? saved : "rapide";
}

export function setDepthKey(key) {
  if (!DEPTH_PRESETS[key]) return;
  localStorage.setItem(KEY, key);
}

export function getDepth() {
  return DEPTH_PRESETS[getDepthKey()].depth;
}

// --- Opponent strength (steps of 100 Elo) -----------------------------------
// Stockfish's official UCI_Elo option is calibrated from 1320 to 3190. Below
// 1320 there is no official calibration, so we approximate using low Skill
// Level values instead — clearly flagged as approximate in the UI.
export const ELO_MIN = 400;
export const ELO_MAX = 3100;
export const ELO_CALIBRATED_MIN = 1320;

export function eloSteps() {
  const steps = [];
  for (let e = ELO_MIN; e <= ELO_MAX; e += 100) steps.push(e);
  return steps;
}

// Returns the UCI "setoption" commands needed to configure the engine to
// aim for the given approximate Elo. Only meaningful for elo >= ELO_CALIBRATED_MIN;
// below that, analysis.js uses a hand-built "blunder mixing" approach instead
// (see uciOptionsForElo callers) since Stockfish itself has no calibrated way
// to play weaker than ~1320 Elo.
export function uciOptionsForElo(elo) {
  return [
    "setoption name UCI_LimitStrength value true",
    `setoption name UCI_Elo value ${Math.min(Math.max(elo, ELO_CALIBRATED_MIN), 3190)}`,
  ];
}

export function resetEngineStrength() {
  return [
    "setoption name UCI_LimitStrength value false",
    "setoption name Skill Level value 20",
  ];
}

// Artisanal weakening for targets below the engine's calibrated range (~1320).
// Returns { blunderProb, depth } — blunderProb is the chance of playing a
// uniformly random legal move instead of consulting the engine at all;
// otherwise the engine is asked at a shallow, reduced depth.
export function weakPlayParams(elo) {
  const t = Math.max(0, Math.min(1, (elo - ELO_MIN) / (ELO_CALIBRATED_MIN - ELO_MIN)));
  return {
    blunderProb: 0.75 - t * 0.65, // 0.75 at 400 Elo → 0.10 near 1320
    depth: Math.round(4 + t * 6), // depth 4 at 400 Elo → depth 10 near 1320
  };
}
