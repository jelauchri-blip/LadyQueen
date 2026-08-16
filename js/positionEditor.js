import { Chess } from "./chess.js";
import { pieceHref, pieceViewBox } from "./pieceStyle.js";

const FEN_ERRORS_FR = {
  "Invalid FEN: must contain six space-delimited fields": "FEN invalide : six champs séparés par des espaces sont requis.",
  "Invalid FEN: move number must be a positive integer": "FEN invalide : le numéro de coup doit être un entier positif.",
  "Invalid FEN: half move counter number must be a non-negative integer": "FEN invalide : le compteur de demi-coups est invalide.",
  "Invalid FEN: en-passant square is invalid": "FEN invalide : la case de prise en passant est invalide.",
  "Invalid FEN: castling availability is invalid": "FEN invalide : les droits de roque sont invalides.",
  "Invalid FEN: side-to-move is invalid": "FEN invalide : le trait (qui doit jouer) est invalide.",
  "Invalid FEN: piece data does not contain 8 '/'-delimited rows": "FEN invalide : l'échiquier doit contenir 8 rangées.",
  "Invalid FEN: piece data is invalid (consecutive number)": "FEN invalide : deux nombres consécutifs dans une rangée.",
  "Invalid FEN: piece data is invalid (invalid piece)": "FEN invalide : symbole de pièce invalide.",
  "Invalid FEN: piece data is invalid (too many squares in rank)": "FEN invalide : une rangée ne totalise pas 8 cases.",
  "Invalid FEN: illegal en-passant square": "FEN invalide : case de prise en passant illégale pour ce trait.",
  "Invalid FEN: missing white king": "Position invalide : il manque le Roi blanc.",
  "Invalid FEN: too many white kings": "Position invalide : il y a plus d'un Roi blanc sur l'échiquier.",
  "Invalid FEN: missing black king": "Position invalide : il manque le Roi noir.",
  "Invalid FEN: too many black kings": "Position invalide : il y a plus d'un Roi noir sur l'échiquier.",
  "Invalid FEN: some pawns are on the edge rows": "Position invalide : un pion ne peut pas être sur la 1ère ou la 8e rangée.",
};

const FILES = ["a","b","c","d","e","f","g","h"];
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const TYPES_ORDER = ["K","Q","R","B","N","P"];

let els = {};
let onValidated = null;
let placedPieces = {}; // square -> letter (upper=white, lower=black)
let selectedType = "K"; // K/Q/R/B/N/P, or "erase"
let selectedColor = "w"; // "w" or "b" — which color the palette places

// The letter to actually place on the board: the selected piece type cased
// by the selected color (independent controls, since telling white/black
// apart in the palette was the whole point of adding the color toggle).
function selectedLetter() {
  if (selectedType === "erase") return "erase";
  return selectedColor === "w" ? selectedType : selectedType.toLowerCase();
}

export function initPositionEditor({ mount, onValidate }) {
  onValidated = onValidate;

  const panel = document.createElement("div");
  panel.className = "editor-panel";
  panel.innerHTML = `
    <div class="editor-toolbar">
      <div class="editor-color-toggle" id="editorColorToggle">
        <button type="button" class="sel" data-color="w">Blancs</button>
        <button type="button" data-color="b">Noirs</button>
      </div>
      <div class="editor-palette" id="editorPalette"></div>
      <div class="editor-quick">
        <button class="btn-ghost" id="editorStartPos">Position de départ</button>
        <button class="btn-ghost" id="editorEmpty">Plateau vide</button>
        <button class="btn-ghost sel" id="editorErase">🗑 Effacer une case</button>
      </div>
    </div>
    <div class="editor-options">
      <div class="editor-turn">
        <span>Trait à jouer :</span>
        <label><input type="radio" name="turnRadio" value="w" checked> Blancs</label>
        <label><input type="radio" name="turnRadio" value="b"> Noirs</label>
      </div>
      <div class="editor-castling">
        <span>Roques possibles :</span>
        <label><input type="checkbox" id="ccWK" checked> O-O blanc</label>
        <label><input type="checkbox" id="ccWQ" checked> O-O-O blanc</label>
        <label><input type="checkbox" id="ccBK" checked> O-O noir</label>
        <label><input type="checkbox" id="ccBQ" checked> O-O-O noir</label>
      </div>
    </div>
    <div class="editor-actions">
      <button class="btn-primary" id="editorValidateBtn">Valider et analyser cette position →</button>
    </div>
    <div class="editor-error" id="editorError" hidden></div>
  `;
  mount.appendChild(panel);

  els.palette = panel.querySelector("#editorPalette");
  els.error = panel.querySelector("#editorError");
  els.validateBtn = panel.querySelector("#editorValidateBtn");
  els.colorToggle = panel.querySelector("#editorColorToggle");

  // Real piece artwork (same SVGs as the board) instead of chess unicode
  // glyphs — those looked nearly identical between colors even with a
  // text-stroke hack. Piece type and color are now separate controls: one
  // button per type, plus a Blancs/Noirs toggle that recolors them.
  TYPES_ORDER.forEach((type) => {
    const btn = document.createElement("button");
    btn.className = "editor-piece-btn" + (type === selectedType ? " sel" : "");
    btn.dataset.type = type;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "editor-piece-icon");
    svg.setAttribute("viewBox", pieceViewBox());
    const use = document.createElementNS(SVG_NS, "use");
    const href = pieceHref(selectedColor, type.toLowerCase());
    use.setAttributeNS(XLINK_NS, "href", href);
    use.setAttribute("href", href);
    svg.appendChild(use);
    btn.appendChild(svg);
    btn.addEventListener("click", () => {
      selectedType = type;
      panel.querySelectorAll(".editor-piece-btn, #editorErase").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
    });
    els.palette.appendChild(btn);
  });

  els.colorToggle.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedColor = btn.dataset.color;
      els.colorToggle.querySelectorAll("button").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
      els.palette.querySelectorAll(".editor-piece-btn").forEach((pieceBtn) => {
        const href = pieceHref(selectedColor, pieceBtn.dataset.type.toLowerCase());
        const use = pieceBtn.querySelector("use");
        use.setAttributeNS(XLINK_NS, "href", href);
        use.setAttribute("href", href);
      });
    });
  });

  panel.querySelector("#editorErase").addEventListener("click", (e) => {
    selectedType = "erase";
    panel.querySelectorAll(".editor-piece-btn, #editorErase").forEach((b) => b.classList.remove("sel"));
    e.currentTarget.classList.add("sel");
  });

  panel.querySelector("#editorStartPos").addEventListener("click", () => {
    setFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  });
  panel.querySelector("#editorEmpty").addEventListener("click", () => {
    placedPieces = {};
    renderBoardFromPieces();
  });

  els.validateBtn.addEventListener("click", validate);

  return { setFromFen, mountBoard: renderEditableBoard };
}

let editorBoardEl = null;

export function renderEditableBoard(mountEl) {
  const boardOuter = document.createElement("div");
  boardOuter.className = "board editor-board";
  mountEl.innerHTML = "";
  mountEl.appendChild(boardOuter);
  // Squares go in a nested .board-grid (like the main board in board.js) so
  // the 8x8 CSS grid layout actually applies — appending them straight into
  // .board (which is just an inline-block frame, not a grid) left every
  // square as a full-width stacked block instead of an 8x8 grid.
  editorBoardEl = document.createElement("div");
  editorBoardEl.className = "board-grid";
  boardOuter.appendChild(editorBoardEl);
  setFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
}

function setFromFen(boardPart) {
  placedPieces = {};
  const ranks = boardPart.split("/");
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) { file += parseInt(ch, 10); continue; }
      const square = FILES[file] + (8 - r);
      placedPieces[square] = ch;
      file++;
    }
  }
  renderBoardFromPieces();
}

function renderBoardFromPieces() {
  if (!editorBoardEl) return;
  editorBoardEl.innerHTML = "";
  for (let rank = 8; rank >= 1; rank--) {
    for (let f = 0; f < 8; f++) {
      const file = FILES[f];
      const sq = file + rank;
      const el = document.createElement("div");
      el.className = "sq " + (((f + rank) % 2 === 0) ? "dark" : "light");
      el.dataset.square = sq;
      const letter = placedPieces[sq];
      if (letter) {
        el.classList.add(letter === letter.toUpperCase() ? "piece-white" : "piece-black");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "piece");
        svg.setAttribute("viewBox", pieceViewBox());
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        const color = letter === letter.toUpperCase() ? "w" : "b";
        const href = pieceHref(color, letter.toLowerCase());
        use.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
        use.setAttribute("href", href);
        svg.appendChild(use);
        el.appendChild(svg);
      }
      el.addEventListener("click", () => {
        if (selectedLetter() === "erase") {
          delete placedPieces[sq];
        } else {
          placedPieces[sq] = selectedLetter();
        }
        renderBoardFromPieces();
      });
      editorBoardEl.appendChild(el);
    }
  }
}

function buildFen() {
  let rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "", empty = 0;
    for (const file of FILES) {
      const sq = file + rank;
      const letter = placedPieces[sq];
      if (!letter) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += letter;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const turn = document.querySelector('input[name="turnRadio"]:checked')?.value || "w";
  let castling = "";
  if (document.getElementById("ccWK")?.checked) castling += "K";
  if (document.getElementById("ccWQ")?.checked) castling += "Q";
  if (document.getElementById("ccBK")?.checked) castling += "k";
  if (document.getElementById("ccBQ")?.checked) castling += "q";
  if (!castling) castling = "-";
  return `${rows.join("/")} ${turn} ${castling} - 0 1`;
}

function validate() {
  const fen = buildFen();
  try {
    new Chess(fen); // throws on invalid FEN, using default strict validation
    els.error.hidden = true;
    if (onValidated) onValidated(fen);
  } catch (e) {
    const msg = FEN_ERRORS_FR[e.message] || `Position invalide : ${e.message}`;
    els.error.hidden = false;
    els.error.textContent = msg;
  }
}
