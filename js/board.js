// Rendu d'un plateau d'échecs interactif à partir d'une instance chess.js
// Usage : const board = createBoard(mountEl, chessInstance, { onUserMove, orientation, interactive });
import { pieceHref, pieceViewBox } from "./pieceStyle.js";
import { playMove, playCapture, playCheck, playGameEnd, playCheckWarning } from "./sounds.js";

const FILES = ["a","b","c","d","e","f","g","h"];

export function createBoard(mountEl, chess, opts = {}) {
  const state = {
    chess,
    orientation: opts.orientation || "white",
    interactive: opts.interactive !== false,
    onUserMove: opts.onUserMove || (() => {}),
    selected: null,
    legalTargets: [],
    lastMove: opts.lastMove || null,
    showCoords: opts.showCoords !== false,
  };

  const boardEl = document.createElement("div");
  boardEl.className = "board";
  mountEl.innerHTML = "";
  mountEl.appendChild(boardEl);

  const gridEl = document.createElement("div");
  gridEl.className = "board-grid";
  boardEl.appendChild(gridEl);

  const rankGutter = document.createElement("div");
  rankGutter.className = "rank-gutter";
  boardEl.appendChild(rankGutter);

  const fileGutter = document.createElement("div");
  fileGutter.className = "file-gutter";
  boardEl.appendChild(fileGutter);

  function squareColor(file, rank) {
    const fi = FILES.indexOf(file);
    return (fi + rank) % 2 === 0 ? "dark" : "light";
  }

  function orderedSquares() {
    const ranks = state.orientation === "white" ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
    const files = state.orientation === "white" ? FILES : [...FILES].reverse();
    const squares = [];
    for (const r of ranks) for (const f of files) squares.push(f + r);
    return squares;
  }

  function clearSelection() {
    state.selected = null;
    state.legalTargets = [];
  }

  function render() {
    gridEl.innerHTML = "";
    const board = state.chess.board(); // 8x8 array, board[0] = rank8
    const kingInCheckSquare = getCheckKingSquare(state.chess);

    for (const sq of orderedSquares()) {
      const file = sq[0];
      const rank = parseInt(sq[1], 10);
      const rowIdx = 8 - rank;
      const colIdx = FILES.indexOf(file);
      const piece = board[rowIdx][colIdx];

      const el = document.createElement("div");
      el.className = "sq " + squareColor(file, rank);
      el.dataset.square = sq;

      if (piece) {
        el.classList.add(piece.color === "w" ? "piece-white" : "piece-black");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "piece");
        svg.setAttribute("viewBox", pieceViewBox());
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        const href = pieceHref(piece.color, piece.type);
        use.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
        use.setAttribute("href", href);
        svg.appendChild(use);
        el.appendChild(svg);
      }

      if (state.lastMove && (sq === state.lastMove.from)) el.classList.add("last-from");
      if (state.lastMove && (sq === state.lastMove.to)) el.classList.add("last-to");
      if (state.selected === sq) el.classList.add("selected");
      if (state.legalTargets.includes(sq)) el.classList.add("legal");
      if (kingInCheckSquare === sq) el.classList.add("check-king");

      if (state.interactive) {
        el.addEventListener("click", () => handleSquareClick(sq));
      }

      gridEl.appendChild(el);
    }

    renderGutters();
  }

  // Coordinate labels drawn OUTSIDE the squares, in dedicated strips along
  // the left (ranks) and bottom (files) edges — matching the convention
  // used by chess.com/lichess, rather than tucked into square corners.
  function renderGutters() {
    rankGutter.innerHTML = "";
    fileGutter.innerHTML = "";
    if (!state.showCoords) return;
    const ranks = state.orientation === "white" ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
    const files = state.orientation === "white" ? FILES : [...FILES].reverse();
    for (const r of ranks) {
      const span = document.createElement("span");
      span.textContent = r;
      rankGutter.appendChild(span);
    }
    for (const f of files) {
      const span = document.createElement("span");
      span.textContent = f;
      fileGutter.appendChild(span);
    }
  }

  function getCheckKingSquare(chess) {
    if (!chess.inCheck || !chess.inCheck()) return null;
    const turn = chess.turn();
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === "k" && p.color === turn) {
          return FILES[c] + (8 - r);
        }
      }
    }
    return null;
  }

  function flashCheckWarning() {
    playCheckWarning();
    const kingSq = getCheckKingSquare(state.chess);
    if (!kingSq) return;
    const el = boardEl.querySelector(`.sq[data-square="${kingSq}"]`);
    if (!el) return;
    el.classList.remove("check-flash"); // restart animation if already running
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // force reflow so the class re-triggers the animation
    el.classList.add("check-flash");
    setTimeout(() => el.classList.remove("check-flash"), 900);
  }

  function handleSquareClick(sq) {
    if (!state.interactive || state.animating) return;

    if (state.selected) {
      if (state.legalTargets.includes(sq)) {
        attemptMove(state.selected, sq);
        return;
      }
      // reselecting another own piece
      const piece = state.chess.get(sq);
      if (piece && piece.color === state.chess.turn()) {
        selectSquare(sq);
      } else {
        clearSelection();
        render();
      }
      return;
    }
    const piece = state.chess.get(sq);
    if (piece && piece.color === state.chess.turn()) {
      selectSquare(sq);
    }
  }

  function selectSquare(sq) {
    state.selected = sq;
    const moves = state.chess.moves({ square: sq, verbose: true });
    state.legalTargets = moves.map(m => m.to);
    render();
    if (moves.length === 0 && state.chess.inCheck && state.chess.inCheck()) {
      flashCheckWarning();
    }
  }

  function animatePieceSlide(fromSq, toSq, onDone) {
    const fromEl = boardEl.querySelector(`.sq[data-square="${fromSq}"]`);
    const toEl = boardEl.querySelector(`.sq[data-square="${toSq}"]`);
    const pieceSvg = fromEl && fromEl.querySelector("svg.piece");
    if (!fromEl || !toEl || !pieceSvg) { onDone(); return; }

    const boardRect = boardEl.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    // Duration scales with distance travelled (Chebyshev, in squares) — a
    // short hop feels quick, a queen sliding across the whole board takes
    // noticeably longer, like a hand actually moving the piece.
    const fileDiff = Math.abs(FILES.indexOf(fromSq[0]) - FILES.indexOf(toSq[0]));
    const rankDiff = Math.abs(parseInt(fromSq[1], 10) - parseInt(toSq[1], 10));
    const squares = Math.max(fileDiff, rankDiff, 1);
    const duration = Math.min(120 + squares * 30, 380);

    const clone = pieceSvg.cloneNode(true);
    clone.classList.add("piece-flying");
    clone.style.position = "absolute";
    clone.style.left = (fromRect.left - boardRect.left) + "px";
    clone.style.top = (fromRect.top - boardRect.top) + "px";
    clone.style.width = fromRect.width + "px";
    clone.style.height = fromRect.height + "px";
    clone.style.margin = "0";
    clone.style.zIndex = "20";
    clone.style.pointerEvents = "none";
    clone.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.6, 0.3, 1)`;
    boardEl.appendChild(clone);
    pieceSvg.style.visibility = "hidden"; // avoid a duplicate while the clone flies

    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    setTimeout(() => { clone.remove(); onDone(); }, duration + 20);
  }

  function attemptMove(from, to) {
    const moves = state.chess.moves({ square: from, verbose: true });
    const match = moves.find(m => m.to === to);
    let san = to;
    let promotion;
    if (match && match.promotion) promotion = "q"; // auto-promote queen; UI keeps it simple
    try {
      const result = state.chess.move({ from, to, promotion });
      clearSelection();
      state.animating = true;
      animatePieceSlide(from, to, () => {
        state.animating = false;
        state.lastMove = { from, to };
        render();
        if (state.chess.isGameOver()) playGameEnd();
        else if (state.chess.inCheck()) playCheck();
        else if (result.captured) playCapture();
        else playMove();
        state.onUserMove(result, state.chess);
      });
    } catch (e) {
      clearSelection();
      render();
    }
  }

  render();

  return {
    render,
    setPosition(fen, lastMove) {
      if (fen) state.chess.load(fen);
      clearSelection();
      state.lastMove = lastMove || null;
      render();
    },
    setChess(newChess, lastMove) {
      if (lastMove && lastMove.from && lastMove.to && !state.animating) {
        state.animating = true;
        animatePieceSlide(lastMove.from, lastMove.to, () => {
          state.animating = false;
          state.chess = newChess;
          clearSelection();
          state.lastMove = lastMove;
          render();
        });
      } else {
        state.chess = newChess;
        clearSelection();
        state.lastMove = lastMove || null;
        render();
      }
    },
    flip() {
      state.orientation = state.orientation === "white" ? "black" : "white";
      render();
    },
    setOrientation(o) {
      state.orientation = o;
      render();
    },
    setInteractive(v) {
      state.interactive = v;
      render();
    },
    setLastMove(lm) {
      state.lastMove = lm;
      render();
    },
    clearSelection() {
      clearSelection();
      render();
    },
    get chess() { return state.chess; },
  };
}
