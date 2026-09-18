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
