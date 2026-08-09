// Gère le style de pièces choisi par l'utilisateur (persisté en localStorage)
// et fournit à board.js / positionEditor.js le fichier sprite + préfixe d'id à utiliser.

const KEY = "echiquier_piece_style";

export const PIECE_STYLES = {
  maison: { file: "icons/pieces.svg", prefix: "pc", viewBox: "0 0 80 160" },
  "cburnett-classic": { file: "icons/cburnett-classic.svg", prefix: "cb", viewBox: "0 0 45 45" },
  "cburnett-wood": { file: "icons/cburnett-wood.svg", prefix: "cb", viewBox: "0 0 45 45" },
};

export function getPieceStyle() {
  const saved = localStorage.getItem(KEY);
  return PIECE_STYLES[saved] ? saved : "cburnett-wood";
}

export function setPieceStyle(style) {
  if (!PIECE_STYLES[style]) return;
  localStorage.setItem(KEY, style);
}

export function pieceHref(color, type) {
  const style = getPieceStyle();
  const { file, prefix } = PIECE_STYLES[style];
  return `${file}#${prefix}-${color}${type.toUpperCase()}`;
}

export function pieceViewBox() {
  const style = getPieceStyle();
  return PIECE_STYLES[style].viewBox;
}
