// Bibliothèque de parties sauvegardées (localStorage). Chaque entrée stocke le PGN
// complet ainsi que quelques métadonnées d'affichage.

import { Chess } from "./chess.js";

const KEY = "echiquier_library";

export function listGames() {
  let games = [];
  try { games = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { games = []; }
  return games.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame({ pgn, label, moveCount }) {
  const games = listGames();
  const entry = {
    id: "g" + Date.now() + Math.floor(Math.random() * 1000),
    savedAt: Date.now(),
    label: label || defaultLabel(),
    pgn,
    moveCount: moveCount || 0,
  };
  games.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(games));
  return entry;
}

export function deleteGame(id) {
  const games = listGames().filter((g) => g.id !== id);
  localStorage.setItem(KEY, JSON.stringify(games));
}

export function getGame(id) {
  return listGames().find((g) => g.id === id) || null;
}

function defaultLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Partie du ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

// --- Saved analyses ----------------------------------------------------------
// A game in the library is a finished game, so what "Analyse complète" works out
// about it (the engine's evaluation of every position: a few hundred bytes) is
// kept WITH the game — reopening it shows the analysis and the coach voice at
// once instead of running the engine again. Everything else in the analysis
// (judgements, explanations, level estimate) is rebuilt from those numbers.

// Identifies a game by its start position and its moves (the analysis covers
// at most 80 plies).
export function gameSignature(startFen, sans) {
  return `${startFen}|${sans.slice(0, 80).join(" ")}`;
}

function signatureOfEntry(entry) {
  try {
    const c = new Chess();
    c.loadPgn(entry.pgn);
    const h = c.history({ verbose: true });
    return gameSignature(h.length ? h[0].before : c.fen(), h.map((m) => m.san));
  } catch (e) { return null; }
}

// { depth, evals, bestMoves } for this game if it is in the library and was
// analysed at least as deeply as asked, else null.
export function getSavedAnalysis(sig, minDepth) {
  const entry = listGames().find((g) => g.analysis && signatureOfEntry(g) === sig);
  return entry && entry.analysis.depth >= minDepth ? entry.analysis : null;
}

// Stores the analysis with the library game of that signature (does nothing —
// returns false — when the game isn't in the library).
export function saveAnalysis(sig, analysis) {
  let games = [];
  try { games = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return false; }
  const entry = games.find((g) => signatureOfEntry(g) === sig);
  if (!entry) return false;
  entry.analysis = analysis;
  try { localStorage.setItem(KEY, JSON.stringify(games)); } catch (e) { return false; }
  return true;
}
