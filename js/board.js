// Rendu d'un plateau d'échecs interactif à partir d'une instance chess.js
// Usage : const board = createBoard(mountEl, chessInstance, { onUserMove, orientation, interactive });
import { pieceHref, pieceViewBox, getPieceStyle } from "./pieceStyle.js";
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
    hintMove: null,
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

  // The 64 squares are created once and then updated in place. Rebuilding
  // them all on every render — and with them the 32 <use> SVGs, each one
  // resolving an external sprite file — was cheap on a desktop but not on a
  // large 120 Hz tablet, where the frame budget is 8 ms. That rebuild lands
  // exactly at the end of each slide, so the stutter was caught by the eye
  // mid-move. Only the squares that actually changed are touched now.
  let gridBuilt = false;
  let gridOrientation = null;
  let gridCoords = null;
  let gridStyle = null;
  let delegated = false;
  const squareEls = new Map();

  function buildGrid() {
    gridEl.innerHTML = "";
    squareEls.clear();
    for (const sq of orderedSquares()) {
      const el = document.createElement("div");
      el.dataset.square = sq;
      el.dataset.piece = "";
      gridEl.appendChild(el);
      squareEls.set(sq, el);
    }
    if (!delegated) {
      // One delegated listener on the grid, instead of 64 re-attached on every
      // single render.
      gridEl.addEventListener("click", (e) => {
        if (!state.interactive) return;
        const target = e.target.closest && e.target.closest(".sq");
        if (target && target.dataset.square) handleSquareClick(target.dataset.square);
      });
      delegated = true;
    }
    gridBuilt = true;
    gridOrientation = state.orientation;
  }

  function makePieceSvg(piece, viewBox) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "piece");
    svg.setAttribute("viewBox", viewBox);
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    const href = pieceHref(piece.color, piece.type);
    use.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
    use.setAttribute("href", href);
    svg.appendChild(use);
    return svg;
  }

  function render() {
    if (!gridBuilt || gridOrientation !== state.orientation) buildGrid();

    // Changing the piece set has to force every SVG to be rebuilt: the squares'
    // cache key is the piece, not the style it is drawn in.
    const style = getPieceStyle();
    if (style !== gridStyle) {
      gridStyle = style;
      for (const el of squareEls.values()) el.dataset.piece = "\u0000";
    }

    const board = state.chess.board(); // 8x8 array, board[0] = rank8
    const kingInCheckSquare = getCheckKingSquare(state.chess);
    const viewBox = pieceViewBox(); // read once, not once per piece

    for (const [sq, el] of squareEls) {
      const file = sq[0];
      const rank = parseInt(sq[1], 10);
      const piece = board[8 - rank][FILES.indexOf(file)];
      const key = piece ? piece.color + piece.type : "";

      let cls = "sq " + squareColor(file, rank);
      if (piece) cls += piece.color === "w" ? " piece-white" : " piece-black";
      if (state.lastMove && sq === state.lastMove.from) cls += " last-from";
      if (state.lastMove && sq === state.lastMove.to) cls += " last-to";
      if (state.hintMove && sq === state.hintMove.from) cls += " hint-from";
      if (state.hintMove && sq === state.hintMove.to) cls += " hint-to";
      if (state.selected === sq) cls += " selected";
      if (state.legalTargets.includes(sq)) cls += " legal";
      if (kingInCheckSquare === sq) cls += " check-king";
      if (el.className !== cls) el.className = cls;

      if (el.dataset.piece !== key) {
        el.dataset.piece = key;
        const old = el.querySelector("svg.piece");
        if (old) old.remove();
        if (piece) el.appendChild(makePieceSvg(piece, viewBox));
      } else if (piece) {
        // animatePieceSlide hides the original while its clone flies; a square
        // that kept its piece must never be left blank by that.
        const svg = el.querySelector("svg.piece");
        if (svg && svg.style.visibility) svg.style.visibility = "";
      }
    }

    renderGutters();
  }

  // Coordinate labels drawn OUTSIDE the squares, in dedicated strips along
  // the left (ranks) and bottom (files) edges — matching the convention
  // used by chess.com/lichess, rather than tucked into square corners.
  // Redrawn only when the orientation or the coords setting changes: they do
  // not depend on the position.
  function renderGutters() {
    const sig = state.showCoords ? state.orientation : "off";
    if (sig === gridCoords) return;
    gridCoords = sig;
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
    clone.style.willChange = "transform";
    boardEl.appendChild(clone);
    pieceSvg.style.visibility = "hidden"; // avoid a duplicate while the clone flies

    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    // Force a layout pass so the starting position is committed BEFORE the
    // transition is declared. A single requestAnimationFrame was not enough on
    // the WebView: the insertion and the transform landed in the same style
    // recalculation, so the slide started from a half-applied position and
    // visibly juddered.
    void clone.getBoundingClientRect().width;
    clone.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.6, 0.3, 1)`;
    clone.style.transform = `translate(${dx}px, ${dy}px)`;

    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clone.removeEventListener("transitionend", finish);
      // Redraw FIRST, remove the flying piece after. The other order left one
      // frame with the piece drawn nowhere, which read as a flicker.
      onDone();
      clone.remove();
    };
    clone.addEventListener("transitionend", finish);
    // Safety net: transitionend never fires if the transition is dropped
    // (app backgrounded, frames skipped under load).
    timer = setTimeout(finish, duration + 80);

    return { clone, timer, finish };
  }

  // Slide started by setChess (navigation), kept so a NEWER navigation can
  // cancel it. Without that, quick clicks left the earlier slide's final redraw
  // to run last and put an older move's highlight on the board.
  let navSlide = null;
  function cancelNavSlide() {
    if (!navSlide) return false;
    clearTimeout(navSlide.timer);
    navSlide.clone.remove();
    navSlide = null;
    state.animating = false;
    return true;
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
        state.hintMove = null;
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
      state.hintMove = null;
      render();
    },
    // opts.animate === false: redraw straight away, no sliding piece. The slide
    // only makes sense when the board goes ONE move forward from what is
    // currently drawn; after any bigger jump the piece at lastMove.from is
    // not the one that moved, and the fake slide shows a capture of a piece
    // the user never saw arrive (see goToPly in analysis.js).
    setChess(newChess, lastMove, opts) {
      // A slide still in flight means the drawn board is NOT the position just
      // before this move: cancel it and redraw directly, no new slide.
      const interrupted = cancelNavSlide();
      const animate = !(opts && opts.animate === false) && !interrupted;
      // The previous position's hint goes now; a hint set right AFTER this call
      // (correction card: goToPly then showHint) must survive the slide's
      // final redraw instead of being wiped by it.
      state.hintMove = null;
      // opts.hint: the suggested move of THIS position (green squares); it
      // appears together with the position, after the slide when there is one.
      const hint = (opts && opts.hint) || null;
      if (animate && lastMove && lastMove.from && lastMove.to && !state.animating) {
        state.animating = true;
        navSlide = animatePieceSlide(lastMove.from, lastMove.to, () => {
          navSlide = null;
          state.animating = false;
          state.chess = newChess;
          clearSelection();
          state.lastMove = lastMove;
          state.hintMove = hint;
          render();
        });
      } else {
        state.chess = newChess;
        clearSelection();
        state.lastMove = lastMove || null;
        state.hintMove = hint;
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
    setHintMove(hm) {
      state.hintMove = hm;
      render();
    },
    clearSelection() {
      clearSelection();
      render();
    },
    get chess() { return state.chess; },
  };
}
