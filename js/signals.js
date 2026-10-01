// Détection, à partir de l'évaluation du moteur, d'un mat forcé : c'est ce que
// signale l'ampoule (rouge) en relecture. Un score "mat en N" de Stockfish est
// une position prouvée gagnante par mat, donc fiable dès qu'il est annoncé
// (à l'inverse, l'absence de signal ne prouve pas l'absence de mat : le moteur
// ne voit que jusqu'à sa profondeur de recherche).

import { Chess } from "./chess.js";

// Joue la suite UCI depuis `fen` (jusqu'au mat) et renvoie les coups
// réellement légaux : { uci, san, from, to, color, captured, promotion }.
export function buildLine(fen, ucis) {
  const c = new Chess(fen);
  const line = [];
  for (const uci of ucis) {
    let r = null;
    try {
      r = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    } catch (e) { r = null; }
    if (!r) break;
    line.push({ uci, san: r.san, from: r.from, to: r.to, color: r.color, captured: r.captured, promotion: r.promotion });
    if (c.isCheckmate()) break;
  }
  return line;
}

// score : { mate } ou { cp }, du point de vue du camp au trait.
export function analyseSignal({ fen, score, pv }) {
  if (!score || score.mate === undefined || score.mate === 0 || !pv || pv.length === 0) return null;
  const turn = new Chess(fen).turn();
  const n = Math.abs(score.mate);
  const winner = (score.mate > 0) === (turn === "w") ? "w" : "b";
  const line = buildLine(fen, pv);
  if (line.length === 0) return null;
  return {
    kind: "mate", n, winner, line,
    label: `Mat en ${n} coup${n > 1 ? "s" : ""} pour les ${winner === "w" ? "Blancs" : "Noirs"}`,
  };
}

// --- Échange gagnant ---------------------------------------------------------
// Signal (vert) distinct du mat : une suite de prises sur l'échiquier, à partir
// de la position donnée, qui laisse le camp au trait gagnant au moins un pion
// en valeur de matériel — même sans aller jusqu'au mat. Calculé localement
// (une recherche "captures seulement", comme la "quiescence search" des
// moteurs d'échecs) : rapide, indépendant de Stockfish, donc utilisable en
// continu sans ralentir l'appli.
const PIECE_VALUE_LOCAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const EXCHANGE_MIN_GAIN = 1; // au moins un pion de valeur
const EXCHANGE_MAX_PLIES = 6; // jusqu'à 3 échanges de chaque côté

function materialBalance(chess, side) {
  let w = 0, b = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color === "w") w += PIECE_VALUE_LOCAL[sq.type] || 0;
      else b += PIECE_VALUE_LOCAL[sq.type] || 0;
    }
  }
  return side === "w" ? w - b : b - w;
}

// Negamax sur les prises uniquement : à chaque niveau, le camp au trait peut
// s'arrêter là (ne pas reprendre) ou continuer la série de prises — on garde
// la meilleure des deux, comme une vraie quiescence search.
function captureSearchLine(chess, depthLeft) {
  const standPat = materialBalance(chess, chess.turn());
  let best = { gain: standPat, line: [] };
  if (depthLeft <= 0) return best;
  const caps = chess.moves({ verbose: true }).filter((m) => m.captured);
  caps.sort((a, b) => (PIECE_VALUE_LOCAL[b.captured] || 0) - (PIECE_VALUE_LOCAL[a.captured] || 0));
  for (const m of caps) {
    chess.move(m.san);
    const sub = captureSearchLine(chess, depthLeft - 1);
    chess.undo();
    const gain = -sub.gain;
    if (gain > best.gain) {
      best = {
        gain,
        line: [{ uci: m.from + m.to + (m.promotion || ""), san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured, promotion: m.promotion }, ...sub.line],
      };
    }
  }
  return best;
}

export function exchangeSignal({ fen }) {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const before = materialBalance(chess, mover); // current material balance, before any capture
  const best = captureSearchLine(chess, EXCHANGE_MAX_PLIES);
  const gain = best.gain - before; // what the exchange itself nets, not the pre-existing balance
  if (gain < EXCHANGE_MIN_GAIN || best.line.length === 0) return null;
  return {
    kind: "exchange", gain, line: best.line,
    label: `Échange gagnant pour les ${mover === "w" ? "Blancs" : "Noirs"} (+${gain})`,
  };
}
