import { Chess } from "./chess.js";
import { createBoard } from "./board.js";
import { eloSteps } from "./engineSettings.js";

// Rough approximate difficulty (Elo) for our own hand-verified puzzle themes.
// These are estimates, not calibrated ratings — shown as "difficulté approximative" in the UI.
const THEME_ELO = { mat1: 500, mat2: 900, fourchette: 650 };

let ALL_PUZZLES = [];
let filtered = [];
let currentPuzzle = null;
let currentIndex = -1;
let board = null;
let solverStep = 0; // for multi-move puzzles
let firstMoveSan = null; // the move the user actually played, to spot other valid solutions
let recentIds = [];
let activeThemeFilter = "all";
let activeEloFilter = "all";

const els = {};

export async function initPuzzlesView() {
  els.mount = document.getElementById("puzzleBoardMount");
  els.status = document.getElementById("puzzleStatus");
  els.theme = document.getElementById("puzzleTheme");
  els.instruction = document.getElementById("puzzleInstruction");
  els.explanation = document.getElementById("puzzleExplanation");
  els.hintBtn = document.getElementById("hintBtn");
  els.resetBtn = document.getElementById("resetPuzzleBtn");
  els.nextBtn = document.getElementById("nextPuzzleBtn");
  els.lichessBtn = document.getElementById("lichessLoadBtn");
  els.filters = document.querySelectorAll(".filter-chip");
  els.eloFilter = document.getElementById("puzzleEloFilter");

  if (ALL_PUZZLES.length === 0) {
    try {
      const res = await fetch("data/puzzles.json");
      ALL_PUZZLES = await res.json();
      ALL_PUZZLES.forEach((p) => { if (p.elo === undefined) p.elo = THEME_ELO[p.theme] || 700; });
    } catch (e) {
      ALL_PUZZLES = [];
    }
  }

  els.eloFilter.innerHTML = '<option value="all">Tous niveaux</option>';
  for (const elo of eloSteps()) {
    const opt = document.createElement("option");
    opt.value = String(elo);
    opt.textContent = `≤ ${elo} Elo`;
    els.eloFilter.appendChild(opt);
  }
  els.eloFilter.onchange = () => {
    activeEloFilter = els.eloFilter.value;
    applyFilters();
    loadNextPuzzle();
  };

  applyFilters();

  els.filters.forEach(btn => {
    btn.addEventListener("click", () => {
      els.filters.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeThemeFilter = btn.dataset.theme;
      applyFilters();
      loadNextPuzzle();
    });
  });

  els.hintBtn.addEventListener("click", showHint);
  els.resetBtn.addEventListener("click", () => loadPuzzle(currentPuzzle));
  els.nextBtn.addEventListener("click", loadNextPuzzle);
  els.lichessBtn.addEventListener("click", loadLichessPuzzle);

  if (!currentPuzzle) loadNextPuzzle();
  else loadPuzzle(currentPuzzle);
}

function applyFilters() {
  filtered = ALL_PUZZLES.filter((p) => {
    const themeOk = activeThemeFilter === "all" || p.theme === activeThemeFilter;
    const eloOk = activeEloFilter === "all" || p.elo <= parseInt(activeEloFilter, 10);
    return themeOk && eloOk;
  });
}

function pickRandom(list) {
  if (list.length === 0) return null;
  const candidates = list.filter(p => !recentIds.includes(p.id));
  const pool = candidates.length > 0 ? candidates : list;
  const p = pool[Math.floor(Math.random() * pool.length)];
  recentIds.push(p.id);
  if (recentIds.length > 8) recentIds.shift();
  return p;
}

function loadNextPuzzle() {
  const p = pickRandom(filtered);
  if (!p) {
    els.instruction.textContent = "Aucun puzzle disponible dans cette catégorie.";
    return;
  }
  loadPuzzle(p);
}

function loadPuzzle(puzzle) {
  currentPuzzle = puzzle;
  solverStep = 0;
  firstMoveSan = null;
  const chess = new Chess(puzzle.fen);
  els.theme.textContent = `${puzzle.themeLabel} · ≈ ${puzzle.elo} Elo`;
  els.instruction.textContent = puzzle.instruction;
  els.status.textContent = "";
  els.status.className = "puzzle-status";
  els.explanation.hidden = true;
  els.explanation.textContent = "";

  board = createBoard(els.mount, chess, {
    interactive: true,
    onUserMove: (result, chessInst) => handleMove(result, chessInst),
  });
}

// A puzzle can have more than one correct move (several squares deliver the
// same mate) — instead of comparing against a single stored SAN string, we
// verify the actual resulting position, so any equally valid solution is
// accepted, not just the one written into the puzzle data.
function canMateInOne(chess) {
  for (const m of chess.moves({ verbose: true })) {
    const c2 = new Chess(chess.fen());
    c2.move(m.san);
    if (c2.isCheckmate()) return true;
  }
  return false;
}

// True if, no matter how the side to move (here: Black, right after White's
// candidate first move) replies, White still has a mate-in-1 available —
// i.e. the candidate move is a genuine forced mate in 2, not just one that
// happens to work against a specific reply.
function isForcedMateInTwo(chessAfterFirstMove) {
  if (chessAfterFirstMove.isCheckmate()) return true;
  const replies = chessAfterFirstMove.moves({ verbose: true });
  if (replies.length === 0) return false; // stalemate: not a mate
  return replies.every((rm) => {
    const c2 = new Chess(chessAfterFirstMove.fen());
    c2.move(rm.san);
    return canMateInOne(c2);
  });
}

function normalizeSan(san) {
  return san.replace(/[+#]/g, "");
}

// Other first moves (besides the one just played) that also solve the
// puzzle from its starting position — used to tell the user more than one
// solution exists so they can go look for it if they want.
function findOtherSolutions(fen, theme, playedSan) {
  const start = new Chess(fen);
  const others = [];
  for (const m of start.moves({ verbose: true })) {
    if (normalizeSan(m.san) === normalizeSan(playedSan)) continue;
    const c2 = new Chess(fen);
    c2.move(m.san);
    const works = theme === "mat1" ? c2.isCheckmate() : theme === "mat2" ? isForcedMateInTwo(c2) : false;
    if (works) others.push(m.san);
  }
  return others;
}

function handleMove(result, chessInst) {
  const p = currentPuzzle;
  if (!p) return;

  if (p.theme === "mat1") {
    if (chessInst.isCheckmate()) { firstMoveSan = result.san; return onSolved(); }
    return onWrong(chessInst, p.fen);
  }

  if (p.theme === "mat2") {
    if (solverStep === 0) {
      if (!isForcedMateInTwo(chessInst)) return onWrong(chessInst, p.fen);
      firstMoveSan = result.san;
      solverStep = 1;
      els.status.textContent = "Bien joué ! Les Noirs répondent…";
      els.status.className = "puzzle-status correct";
      // Play the scripted reply if it's still legal in this line, otherwise
      // fall back to any legal Black move (every reply still loses here).
      setTimeout(() => {
        try {
          let r;
          try { r = chessInst.move(p.solution[1]); }
          catch (e) { r = chessInst.move(chessInst.moves({ verbose: true })[0].san); }
          board.setChess(chessInst, { from: r.from, to: r.to });
          els.status.textContent = "À vous : trouvez le mat !";
        } catch (e) { /* ignore */ }
      }, 500);
      return;
    }
    if (solverStep === 1) {
      if (chessInst.isCheckmate()) return onSolved();
      return onWrong(chessInst, p.fen);
    }
  }

  if (p.theme === "fourchette") {
    const isFork = result.to === p.forkSquare && result.piece === "n";
    if (isFork) return onSolved();
    return onWrong(chessInst, p.fen);
  }

  if (p.theme === "lichess") {
    const expected = p.uciSolution[solverStep];
    const played = result.from + result.to + (result.promotion || "");
    if (played === expected || result.from + result.to === expected) {
      solverStep++;
      if (solverStep >= p.uciSolution.length) return onSolved();
      // auto play opponent forced reply if present
      const oppMove = p.uciSolution[solverStep];
      els.status.textContent = "Bien joué ! Les Noirs répondent…";
      els.status.className = "puzzle-status correct";
      setTimeout(() => {
        try {
          const from = oppMove.slice(0,2), to = oppMove.slice(2,4), promo = oppMove.slice(4) || undefined;
          const r = chessInst.move({ from, to, promotion: promo });
          board.setChess(chessInst, { from: r.from, to: r.to });
          solverStep++;
          els.status.textContent = "À vous de jouer.";
        } catch (e) { /* ignore */ }
      }, 500);
      return;
    }
    return onWrong(chessInst, p.fen);
  }
}

function onSolved() {
  els.status.textContent = "✓ Résolu !";
  els.status.className = "puzzle-status correct";
  els.explanation.hidden = false;

  let text = currentPuzzle.explanation || "Bravo, coup exact.";
  if (firstMoveSan && (currentPuzzle.theme === "mat1" || currentPuzzle.theme === "mat2")) {
    const others = findOtherSolutions(currentPuzzle.fen, currentPuzzle.theme, firstMoveSan);
    if (others.length > 0) {
      text += ` Il existe aussi d'autres façons de mater ici (par ex. ${others[0]}). Clique sur « Recommencer » pour en chercher une autre, ou passe au puzzle suivant.`;
    }
  }
  els.explanation.textContent = text;

  board.setInteractive(false);
  incrementSolvedCount();
}

function onWrong(chessInst, fen) {
  els.status.textContent = "Ce n'est pas le bon coup, réessayez.";
  els.status.className = "puzzle-status wrong";
  setTimeout(() => {
    chessInst.load(fen);
    // replay any forced steps already validated (for mat2/lichess mid-sequence) — simplest: full reset
    solverStep = 0;
    board.setChess(chessInst, null);
  }, 700);
}

function showHint() {
  const p = currentPuzzle;
  if (!p) return;
  let hint = "";
  if (p.theme === "mat1") {
    const pieceLetter = p.solution[0][0];
    const names = { K: "Roi", Q: "Dame", R: "Tour", B: "Fou", N: "Cavalier" };
    const pieceName = names[pieceLetter] || "Pion";
    hint = `Indice : c'est le ${pieceName} qui donne le mat, sur la case ${p.solution[0].replace(/[NBRQKx+#]/g, "").slice(-2)}.`;
  }
  if (p.theme === "mat2") hint = `Indice : le premier coup commence par « ${p.solution[0][0]} ». Cherchez un coup qui restreint tous les coups de secours noirs.`;
  if (p.theme === "fourchette") hint = `Indice : le Cavalier peut sauter en ${p.forkSquare} et attaquer deux pièces à la fois.`;
  if (p.theme === "lichess") hint = "Indice : cherchez le coup qui crée la plus grande menace immédiate (gain de matériel ou mat).";
  els.explanation.hidden = false;
  els.explanation.textContent = hint;
}

function incrementSolvedCount() {
  let n = 0;
  try { n = parseInt(localStorage.getItem("echiquier_puzzles_solved") || "0", 10); } catch {}
  n += 1;
  localStorage.setItem("echiquier_puzzles_solved", String(n));
  const statEl = document.getElementById("statPuzzlesSolved");
  if (statEl) statEl.textContent = n;
}

export function updatePuzzleStat() {
  const statEl = document.getElementById("statPuzzlesSolved");
  if (!statEl) return;
  let n = 0;
  try { n = parseInt(localStorage.getItem("echiquier_puzzles_solved") || "0", 10); } catch {}
  statEl.textContent = n;
}

async function loadLichessPuzzle() {
  els.instruction.textContent = "Chargement d'un puzzle Lichess…";
  els.lichessBtn.disabled = true;
  try {
    const res = await fetch("https://lichess.org/api/puzzle/daily");
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    const converted = convertLichessPuzzle(data);
    ALL_PUZZLES.push(converted);
    applyFilters();
    loadPuzzle(converted);
  } catch (e) {
    els.instruction.textContent = "Impossible de charger un puzzle Lichess (vérifiez votre connexion). Réessayez plus tard.";
  } finally {
    els.lichessBtn.disabled = false;
  }
}

function convertLichessPuzzle(data) {
  const chess = new Chess();
  const pgnMoves = data.game.pgn.split(/\s+/).filter(t => t && !/^\d+\.+$/.test(t));
  const initialPly = data.puzzle.initialPly;
  for (let i = 0; i < initialPly && i < pgnMoves.length; i++) {
    try { chess.move(pgnMoves[i]); } catch (e) { break; }
  }
  const solution = data.puzzle.solution; // array of UCI moves
  // play the first (setup) move automatically
  const setup = solution[0];
  try {
    chess.move({ from: setup.slice(0,2), to: setup.slice(2,4), promotion: setup.slice(4) || undefined });
  } catch (e) { /* ignore */ }

  const rest = solution.slice(1);
  const themes = (data.puzzle.themes || []).join(", ") || "Lichess";
  return {
    id: "lichess-" + data.puzzle.id,
    theme: "lichess",
    themeLabel: "Lichess · " + themes,
    elo: data.puzzle.rating || 1200,
    fen: chess.fen(),
    toMove: chess.turn() === "w" ? "blancs" : "noirs",
    uciSolution: rest,
    instruction: `Puzzle du jour Lichess (thème : ${themes}, note ${data.puzzle.rating}). Trouvez la meilleure suite pour ${chess.turn() === "w" ? "les Blancs" : "les Noirs"}.`,
    explanation: `Ce puzzle provient de la base ouverte Lichess (id ${data.puzzle.id}, note ${data.puzzle.rating}).`,
  };
}
