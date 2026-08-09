import { Chess } from "./chess.js";
import { createBoard } from "./board.js";
import { initFullGameAnalysis, explainBestMove, classify, buildHeuristicTags, buildExplanation, toWhiteCentipawns } from "./gameAnalysis.js";
import { initPositionEditor, renderEditableBoard } from "./positionEditor.js";
import { speakOne, stop as stopSpeech, isSupported as isVoiceSupported } from "./voiceCoach.js";
import { saveGame } from "./gameLibrary.js";
import { refreshLibraryView } from "./libraryView.js";
import { getDepth, getDepthKey, setDepthKey } from "./engineSettings.js";
import { eloSteps, uciOptionsForElo, resetEngineStrength, weakPlayParams, ELO_CALIBRATED_MIN } from "./engineSettings.js";
import { createClock, formatClock } from "./chessClock.js";
import { playMove, playCapture, playCheck, playGameEnd } from "./sounds.js";

// The local copy is tried FIRST — it removes any dependency on an external
// CDN being reachable, which is the most likely explanation for engine
// connections that never succeed on some networks (corporate firewalls,
// ad/privacy blockers filtering cross-origin Worker scripts, etc.). The CDN
// URLs are kept only as a fallback in case the local files are ever missing.
const STOCKFISH_CDN_URLS = [
  "engine/stockfish-18-lite-single.js",
  "https://cdn.jsdelivr.net/npm/stockfish@18.0.8/bin/stockfish-18-lite-single.js",
  "https://cdn.jsdelivr.net/npm/stockfish/bin/stockfish-18-lite-single.js",
];

let chess = new Chess();
let board = null;
let engine = null;
let engineReadyResolvers = [];
let engineIsReady = false;
// 'idle' | 'loading' | 'ready' | 'failed'. Once 'failed', every queued
// engine call short-circuits immediately instead of each re-waiting its own
// timeout — this is what previously made a single dead connection cost
// 12s multiplied by every internal sub-step of a single move.
let engineState = "idle";
let engineEnabled = false;
let orientation = "white";
let busy = false; // true while full-game analysis owns the engine
const els = {};

// --- Move history / navigation state ---------------------------------------
// plyFens[i] = FEN before the i-th ply is played; plyFens has length N+1 for N plies.
// plyMoves[i] = verbose move object that leads from plyFens[i] to plyFens[i+1].
let plyFens = [chess.fen()];
let plyMoves = [];
let currentPly = 0; // index into plyFens currently shown on the board (0..plyFens.length-1)
let liveCoachEnabled = false;
let liveMoveCountByPieceType = { w: {}, b: {} };
let vsComputerMode = false;
let computerSide = null; // 'w' | 'b' — which side the ENGINE plays
let computerElo = 1200;
let challengeMode = true; // true = "Défi" (read-only history, no branching); false = "Coach" (free branching)
let clock = null;
let vsComputerGameOver = false;

function startHistoryAt(fen) {
  plyFens = [fen];
  plyMoves = [];
  currentPly = 0;
  liveMoveCountByPieceType = { w: {}, b: {} };
}

function rebuildHistoryFromChessObject(chessWithHistory) {
  const hist = chessWithHistory.history({ verbose: true });
  plyFens = [hist.length ? hist[0].before : chessWithHistory.fen()];
  plyMoves = [];
  liveMoveCountByPieceType = { w: {}, b: {} };
  for (const h of hist) {
    plyMoves.push(h);
    plyFens.push(h.after);
  }
  currentPly = plyFens.length - 1;
}

export function goToPly(n) {
  currentPly = Math.max(0, Math.min(plyFens.length - 1, n));
  chess.load(plyFens[currentPly]);
  const lastMove = currentPly > 0 ? plyMoves[currentPly - 1] : null;
  board.setChess(chess, lastMove ? { from: lastMove.from, to: lastMove.to } : null);
  syncFen();
  updateMoveList();
  updateNavButtons();
  els.moveExplanation.hidden = true;
  requestEval();

  // In "Défi" mode against the computer, browsing history is read-only:
  // the board only accepts moves again once back at the live position.
  const atLatest = currentPly === plyFens.length - 1;
  if (vsComputerGameOver) {
    board.setInteractive(false);
  } else if (vsComputerMode && challengeMode) {
    board.setInteractive(atLatest);
  } else {
    board.setInteractive(true);
  }
}

function updateNavButtons() {
  const atStart = currentPly === 0;
  const atEnd = currentPly === plyFens.length - 1;
  els.navFirstBtn.disabled = atStart;
  els.navPrevBtn.disabled = atStart;
  els.navNextBtn.disabled = atEnd;
  els.navLastBtn.disabled = atEnd;
  els.navPosition.textContent = currentPly === 0
    ? "Début de partie"
    : `Coup ${Math.ceil(currentPly / 2)}${currentPly % 2 === 1 ? "" : " (Noirs)"} / ${plyMoves.length}`;
}

export function initAnalysisView() {
  els.mount = document.getElementById("analyseBoardMount");
  els.fenInput = document.getElementById("fenInput");
  els.pgnInput = document.getElementById("pgnInput");
  els.loadFenBtn = document.getElementById("loadFenBtn");
  els.loadPgnBtn = document.getElementById("loadPgnBtn");
  els.flipBtn = document.getElementById("flipBtn");
  els.resetBoardBtn = document.getElementById("resetBoardBtn");
  els.clearBoardBtn = document.getElementById("clearBoardBtn");
  els.saveGameBtn = document.getElementById("saveGameBtn");
  els.depthSelect = document.getElementById("depthSelect");
  els.navFirstBtn = document.getElementById("navFirstBtn");
  els.navPrevBtn = document.getElementById("navPrevBtn");
  els.navNextBtn = document.getElementById("navNextBtn");
  els.navLastBtn = document.getElementById("navLastBtn");
  els.navPosition = document.getElementById("navPosition");
  els.engineToggle = document.getElementById("engineToggle");
  els.engineStatus = document.getElementById("engineStatus");
  els.evalBar = document.getElementById("evalBar");
  els.evalBarFill = document.getElementById("evalBarFill");
  els.engineOutput = document.getElementById("engineOutput");
  els.moveList = document.getElementById("moveList");
  els.helpBtn = document.getElementById("helpMoveBtn");
  els.moveExplanation = document.getElementById("moveExplanation");
  els.helpSpeakBtn = document.getElementById("helpSpeakBtn");
  els.openEditorBtn = document.getElementById("openEditorBtn");
  els.editorMount = document.getElementById("editorMount");
  els.setupControls = document.getElementById("setupControls");

  if (!board) {
    board = createBoard(els.mount, chess, {
      interactive: true,
      onUserMove: (result) => {
        const fenBefore = plyFens[currentPly];
        recordMove(fenBefore, result);
        maybeTriggerComputerMove();
      },
    });
  }

  els.fenInput.value = chess.fen();

  els.loadFenBtn.onclick = () => {
    deactivateComputerMode();
    try {
      chess.load(els.fenInput.value.trim());
      board.setChess(chess, null);
      startHistoryAt(chess.fen());
      updateMoveList();
      updateNavButtons();
      requestEval();
    } catch (e) {
      alert("FEN invalide.");
    }
  };

  els.loadPgnBtn.onclick = () => {
    deactivateComputerMode();
    if (!loadPgnString(els.pgnInput.value.trim())) {
      alert("PGN invalide ou incomplet.");
    }
  };

  els.saveGameBtn.onclick = () => {
    if (plyMoves.length === 0) {
      alert("Jouez ou chargez d'abord une partie avant de l'enregistrer.");
      return;
    }
    const label = prompt("Nom de cette partie (facultatif) :", "");
    const pgn = buildPgnFromHistory();
    saveGame({ pgn, label: label && label.trim() ? label.trim() : undefined, moveCount: plyMoves.length });
    refreshLibraryView();
    els.saveGameBtn.textContent = "✓ Enregistré";
    setTimeout(() => { els.saveGameBtn.textContent = "💾 Enregistrer"; }, 1500);
  };

  els.flipBtn.onclick = () => { orientation = orientation === "white" ? "black" : "white"; board.flip(); };

  els.navFirstBtn.onclick = () => goToPly(0);
  els.navPrevBtn.onclick = () => goToPly(currentPly - 1);
  els.navNextBtn.onclick = () => goToPly(currentPly + 1);
  els.navLastBtn.onclick = () => goToPly(plyFens.length - 1);

  els.resetBoardBtn.onclick = () => {
    deactivateComputerMode();
    chess = new Chess();
    board.setChess(chess, null);
    startHistoryAt(chess.fen());
    syncFen();
    updateMoveList();
    updateNavButtons();
    requestEval();
  };

  els.clearBoardBtn.onclick = () => {
    deactivateComputerMode();
    chess = new Chess("7k/8/8/8/8/8/8/K7 w - - 0 1");
    board.setChess(chess, null);
    startHistoryAt(chess.fen());
    syncFen();
    updateMoveList();
    updateNavButtons();
  };

  els.engineToggle.onchange = () => {
    engineEnabled = els.engineToggle.checked;
    if (engineEnabled) {
      ensureEngine();
      requestEval();
    } else {
      els.engineStatus.textContent = "Moteur désactivé";
      els.evalBar.hidden = true;
      els.engineOutput.innerHTML = "";
    }
  };

  els.depthSelect.value = getDepthKey();
  els.depthSelect.onchange = () => {
    setDepthKey(els.depthSelect.value);
    if (engineEnabled) requestEval();
  };

  els.liveCoachToggle = document.getElementById("liveCoachToggle");
  els.liveCoachToggle.onchange = () => {
    liveCoachEnabled = els.liveCoachToggle.checked;
    if (liveCoachEnabled && !engineEnabled) {
      engineEnabled = true;
      els.engineToggle.checked = true;
      ensureEngine();
    }
  };

  // --- Opponent panel (play vs computer) ---
  els.opponentOptions = document.getElementById("opponentOptions");
  els.opponentSideSelect = document.getElementById("opponentSideSelect");
  els.opponentEloSelect = document.getElementById("opponentEloSelect");
  els.opponentEloHint = document.getElementById("opponentEloHint");
  els.startVsComputerBtn = document.getElementById("startVsComputerBtn");
  els.timeControlSelect = document.getElementById("timeControlSelect");
  els.incrementSelect = document.getElementById("incrementSelect");
  els.clockRow = document.getElementById("clockRow");
  els.clockWhite = document.getElementById("clockWhite");
  els.clockBlack = document.getElementById("clockBlack");
  els.resignBtn = document.getElementById("resignBtn");
  els.gameResultBanner = document.getElementById("gameResultBanner");
  els.gameResultOverlay = document.getElementById("gameResultOverlay");
  els.gameResultIcon = document.getElementById("gameResultIcon");
  els.gameResultTitle = document.getElementById("gameResultTitle");
  els.gameResultSub = document.getElementById("gameResultSub");
  els.gameResultCloseBtn = document.getElementById("gameResultCloseBtn");
  els.gameResultCloseBtn.onclick = (e) => { e.stopPropagation(); hideResultOverlay(); };
  els.gameResultOverlay.onclick = () => hideResultOverlay();

  for (const elo of eloSteps()) {
    const opt = document.createElement("option");
    opt.value = String(elo);
    opt.textContent = `${elo} Elo`;
    if (elo === 1200) opt.selected = true;
    els.opponentEloSelect.appendChild(opt);
  }
  function updateEloHint() {
    const elo = parseInt(els.opponentEloSelect.value, 10);
    els.opponentEloHint.textContent = elo < ELO_CALIBRATED_MIN
      ? "En dessous de 1320 : simulation approximative (coups faibles/aléatoires), pas de réglage officiel du moteur à ce niveau."
      : "Force calibrée officiellement par le moteur (UCI_Elo).";
  }
  els.opponentEloSelect.onchange = updateEloHint;
  updateEloHint();

  document.querySelectorAll('input[name="opponentMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      els.opponentOptions.hidden = radio.value !== "ordinateur" || !radio.checked;
      if (radio.value === "libre" && radio.checked) {
        deactivateComputerMode();
      } else if (radio.value === "ordinateur" && radio.checked) {
        // Free up vertical space as soon as the computer-opponent setup is
        // shown, not only once the game actually starts — the FEN/PGN/editor
        // controls aren't useful while configuring or playing a bot game.
        if (els.setupControls) els.setupControls.hidden = true;
        if (els.openEditorBtn) els.openEditorBtn.hidden = true;
      }
    });
  });

  els.startVsComputerBtn.onclick = async () => {
    const userSide = els.opponentSideSelect.value;
    computerSide = userSide === "w" ? "b" : "w";
    computerElo = parseInt(els.opponentEloSelect.value, 10);
    challengeMode = document.querySelector('input[name="vsComputerBehavior"]:checked').value === "defi";
    vsComputerMode = true;
    vsComputerGameOver = false;
    if (els.setupControls) els.setupControls.hidden = true; // free up vertical space during play
    if (els.openEditorBtn) els.openEditorBtn.hidden = true;

    chess = new Chess();
    board.setChess(chess, null);
    board.setInteractive(true);
    startHistoryAt(chess.fen());
    syncFen();
    updateMoveList();
    updateNavButtons();
    orientation = userSide === "b" ? "black" : "white";
    board.setOrientation(orientation);

    // Set up the clock (0 = illimité)
    const baseMinutes = parseInt(els.timeControlSelect.value, 10);
    const incrementSeconds = parseInt(els.incrementSelect.value, 10);
    if (clock) clock.stop();
    clock = createClock({
      baseMinutes: baseMinutes === 0 ? null : baseMinutes,
      incrementSeconds,
      onTick: updateClockDisplay,
      onFlag: handleFlag,
    });
    if (clock.isTimed()) {
      els.clockRow.hidden = false;
      updateClockDisplay(clock.getState());
      clock.start();
    } else {
      els.clockRow.hidden = true;
    }
    els.resignBtn.hidden = false;
    hideResultBanner();
    hideResultOverlay();

    if (!engineEnabled) {
      engineEnabled = true;
      els.engineToggle.checked = true;
    }
    ensureEngine();
    const modeLabel = challengeMode ? "Mode Défi" : "Mode Coach";
    els.engineStatus.textContent = `${modeLabel} — l'ordinateur joue les ${computerSide === "w" ? "Blancs" : "Noirs"} (≈ ${computerElo} Elo).`;
    maybeTriggerComputerMove();
  };

  els.resignBtn.onclick = () => {
    if (!vsComputerMode || vsComputerGameOver) return;
    if (!confirm("Abandonner la partie ?")) return;
    vsComputerGameOver = true;
    if (clock) clock.stop();
    board.setInteractive(false);
    els.engineStatus.textContent = "Partie terminée.";
    showResultBanner("🏳 Vous avez abandonné — l'ordinateur gagne.", "loss");
    showResultOverlay("loss", "Vous avez abandonné la partie.");
  };

  syncFen();
  updateMoveList();
  updateNavButtons();

  initFullGameAnalysis({
    getChess: () => chess,
    getPlies: () => plyMoves,
    evaluateFen,
    isEngineEnabled: () => engineEnabled,
    enableEngine: () => { engineEnabled = true; els.engineToggle.checked = true; ensureEngine(); },
    setBusy: (v) => { busy = v; },
    goToPly,
  });

  let lastHelpSpeech = "";
  els.helpBtn.onclick = async () => {
    if (vsComputerGameOver && currentPly === plyFens.length - 1) {
      els.moveExplanation.hidden = false;
      els.moveExplanation.textContent = "La partie est terminée — revenez en arrière dans l'historique pour demander de l'aide sur un coup passé.";
      return;
    }
    ensureEngine();
    els.helpBtn.disabled = true;
    els.helpSpeakBtn.hidden = true;
    els.moveExplanation.hidden = false;
    els.moveExplanation.textContent = "Réflexion en cours…";
    try {
      const result = await evaluateFen(chess.fen(), getDepth());
      if (!result.bestMove) {
        els.moveExplanation.textContent = "Aucun coup possible : la partie est terminée dans cette position.";
      } else {
        let bestSan = result.bestMove;
        try {
          const testChess = new Chess(chess.fen());
          const from = result.bestMove.slice(0, 2), to = result.bestMove.slice(2, 4), promo = result.bestMove.slice(4) || undefined;
          const r = testChess.move({ from, to, promotion: promo });
          if (r) bestSan = r.san;
        } catch (e) { /* keep uci form */ }
        const reasoning = explainBestMove(chess.fen(), result.bestMove);
        els.moveExplanation.innerHTML = `Meilleure solution : <span class="best-move">${bestSan}</span><br>${reasoning}`;
        lastHelpSpeech = `Meilleure solution : ${bestSan}. ${reasoning}`;
        if (isVoiceSupported()) els.helpSpeakBtn.hidden = false;
      }
    } catch (e) {
      els.moveExplanation.textContent = "Impossible d'obtenir une explication pour le moment (moteur indisponible, vérifiez la connexion internet).";
    } finally {
      els.helpBtn.disabled = false;
    }
  };

  if (els.helpSpeakBtn) {
    els.helpSpeakBtn.onclick = () => {
      if (!lastHelpSpeech) return;
      stopSpeech();
      speakOne(lastHelpSpeech);
    };
  }

  let editorInited = false;
  els.openEditorBtn.onclick = () => {
    const isOpen = !els.editorMount.hidden;
    if (isOpen) {
      els.editorMount.hidden = true;
      els.openEditorBtn.textContent = "✎ Créer une position (étude libre)";
      return;
    }
    els.editorMount.hidden = false;
    els.openEditorBtn.textContent = "✕ Fermer l'éditeur";
    if (!editorInited) {
      editorInited = true;
      const boardHolder = document.createElement("div");
      const controlsHolder = document.createElement("div");
      els.editorMount.appendChild(boardHolder);
      els.editorMount.appendChild(controlsHolder);
      const api = initPositionEditor({
        mount: controlsHolder,
        onValidate: (fen) => {
          deactivateComputerMode();
          chess.load(fen);
          board.setChess(chess, null);
          startHistoryAt(fen);
          syncFen();
          updateMoveList();
          updateNavButtons();
          els.moveExplanation.hidden = true;
          requestEval();
          els.editorMount.hidden = true;
          els.openEditorBtn.textContent = "✎ Créer une position (étude libre)";
        },
      });
      api.mountBoard(boardHolder);
    }
  };
}

// Opens the "Adversaire" panel and pre-selects "Contre l'ordinateur" — used
// by the prominent "Jouer" button on the home page for quick access.
export function openOpponentPanel() {
  const section = document.getElementById("opponentSection");
  if (section) section.open = true;
  const computerRadio = document.querySelector('input[name="opponentMode"][value="ordinateur"]');
  if (computerRadio) {
    computerRadio.checked = true;
    computerRadio.dispatchEvent(new Event("change"));
  }
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncFen() {
  els.fenInput.value = chess.fen();
}

// Precise, human-readable end-of-game description for the current position.
// Returns null if the game is not over.
function gameOverMessage(chessInst) {
  if (!chessInst.isGameOver()) return null;
  const winnerLabel = (color) => (color === "w" ? "les Blancs" : "les Noirs");
  if (chessInst.isCheckmate()) {
    // side to move is the one who got mated
    const loser = chessInst.turn();
    return `Échec et mat — ${winnerLabel(loser === "w" ? "b" : "w")} gagnent.`;
  }
  if (chessInst.isStalemate()) return "Pat — partie nulle (aucun coup légal, pas d'échec).";
  if (chessInst.isThreefoldRepetition()) return "Nulle par répétition de position (3 fois la même position).";
  if (chessInst.isDrawByFiftyMoves()) return "Nulle par la règle des 50 coups (sans capture ni poussée de pion).";
  if (chessInst.isInsufficientMaterial()) return "Nulle par matériel insuffisant pour mater.";
  return "Partie nulle.";
}

// Result relative to the HUMAN player (only meaningful in vsComputerMode).
function humanResultKind(chessInst) {
  if (!chessInst.isGameOver()) return null;
  if (chessInst.isCheckmate()) {
    const loser = chessInst.turn(); // side to move is the one who got mated
    return loser === computerSide ? "win" : "loss";
  }
  return "draw";
}

// Builds a clear, human-centric banner text ("Vous gagnez !" / "L'ordinateur
// gagne.") from the technical end-of-game message, so the result is obvious
// at a glance without having to remember which colour you were playing.
function humanBannerText(overMsg, kind) {
  if (kind === "win") return `🏆 Vous gagnez ! (${overMsg.replace(/^./, (c) => c.toLowerCase())})`;
  if (kind === "loss") return `L'ordinateur gagne. (${overMsg.replace(/^./, (c) => c.toLowerCase())})`;
  return overMsg; // draw: the technical message is already clear enough
}

// Always-visible banner (unlike engineStatus, which lives inside a
// collapsible section and can easily go unseen) announcing how the game
// against the computer ended.
function showResultBanner(text, kind) {
  if (!els.gameResultBanner) return;
  els.gameResultBanner.textContent = text;
  els.gameResultBanner.className = "game-result-banner" + (kind ? " " + kind : "");
  els.gameResultBanner.hidden = false;
}
function hideResultBanner() {
  if (els.gameResultBanner) els.gameResultBanner.hidden = true;
}

const RESULT_ICON = { win: "🏆", loss: "🤖", draw: "🤝" };
const RESULT_TITLE = { win: "Vous gagnez !", loss: "L'ordinateur gagne.", draw: "Partie nulle." };

// Big, impossible-to-miss overlay centered on the board itself.
function showResultOverlay(kind, sub) {
  if (!els.gameResultOverlay) return;
  els.gameResultIcon.textContent = RESULT_ICON[kind] || "♟";
  els.gameResultTitle.textContent = RESULT_TITLE[kind] || "Partie terminée.";
  els.gameResultSub.textContent = sub || "";
  els.gameResultOverlay.querySelector(".game-result-card").className = "game-result-card " + (kind || "");
  els.gameResultOverlay.hidden = false;
}
function hideResultOverlay() {
  if (els.gameResultOverlay) els.gameResultOverlay.hidden = true;
}

// Shared bookkeeping for any move (human or computer): updates history, UI, live coach.
function recordMove(fenBefore, moveResult, opts = {}) {
  plyFens = plyFens.slice(0, currentPly + 1);
  plyMoves = plyMoves.slice(0, currentPly);
  plyMoves.push(moveResult);
  plyFens.push(moveResult.after);
  currentPly = plyFens.length - 1;
  syncFen();
  updateMoveList();
  updateNavButtons();
  els.moveExplanation.hidden = true;
  if (!opts.skipEvalRefresh) requestEval();
  if (clock && vsComputerMode) clock.afterMove(moveResult.color);
  if (!opts.skipLiveCoach && liveCoachEnabled && engineEnabled) runLiveCoach(fenBefore, moveResult, currentPly - 1);

  const overMsg = gameOverMessage(chess);
  if (overMsg) {
    if (vsComputerMode) {
      vsComputerGameOver = true;
      if (clock) clock.stop();
      board.setInteractive(false);
      const kind = humanResultKind(chess);
      showResultBanner(humanBannerText(overMsg, kind), kind);
      showResultOverlay(kind, overMsg);
      els.engineStatus.textContent = "Partie terminée."; // full message already shown in the banner above
    } else {
      els.engineStatus.textContent = overMsg;
    }
  }
}

function updateClockDisplay(state) {
  if (!els.clockWhite) return;
  els.clockWhite.querySelector(".clock-time").textContent = formatClock(state.whiteMs);
  els.clockBlack.querySelector(".clock-time").textContent = formatClock(state.blackMs);
  els.clockWhite.classList.toggle("active", state.turn === "w");
  els.clockBlack.classList.toggle("active", state.turn === "b");
}

function handleFlag(loserColor) {
  vsComputerGameOver = true;
  board.setInteractive(false);
  const box = loserColor === "w" ? els.clockWhite : els.clockBlack;
  if (box) box.classList.add("flag");
  const loserLabel = loserColor === "w" ? "Les Blancs" : "Les Noirs";
  const humanWins = loserColor === computerSide;
  const winnerLabel = humanWins ? "vous gagnez" : "l'ordinateur gagne";
  const msg = `⏱ ${loserLabel} n'ont plus de temps — ${winnerLabel} !`;
  els.engineStatus.textContent = "Partie terminée.";
  showResultBanner(msg, humanWins ? "win" : "loss");
  showResultOverlay(humanWins ? "win" : "loss", `${loserLabel} n'ont plus de temps.`);
}

// Serializes every engine interaction (setoption commands, position/go
// searches) through a single promise chain. This replaces an earlier
// "check pendingResolve then set it" pattern that had a race window: two
// calls could both see the engine as free and both try to claim it, silently
// stranding the first one's promise forever (symptom: a "thinking" call that
// never returns, seen for example as the clock running out on a bot move).
let engineQueue = Promise.resolve();
function queueEngineTask(taskFn) {
  const run = async () => {
    await whenEngineReady();
    return taskFn();
  };
  const result = engineQueue.then(run);
  engineQueue = result.then(() => {}, () => {}); // keep the chain alive even on error
  return result;
}

// Sends UCI setoption commands to make the engine target an approximate Elo
// (or full strength if elo is null). Queued behind any pending eval.
function applyEngineStrength(elo) {
  ensureEngine();
  return queueEngineTask(() => {
    if (!engine) return;
    const opts = elo === null ? resetEngineStrength() : uciOptionsForElo(elo);
    opts.forEach((cmd) => engine.postMessage(cmd));
  });
}

function deactivateComputerMode() {
  vsComputerMode = false;
  vsComputerGameOver = false;
  if (clock) { clock.stop(); clock = null; }
  if (els.clockRow) els.clockRow.hidden = true;
  if (els.resignBtn) els.resignBtn.hidden = true;
  if (els.setupControls) els.setupControls.hidden = false;
  if (els.openEditorBtn) els.openEditorBtn.hidden = false;
  hideResultBanner();
  hideResultOverlay();
  const libreRadio = document.querySelector('input[name="opponentMode"][value="libre"]');
  if (libreRadio) libreRadio.checked = true;
  if (els.opponentOptions) els.opponentOptions.hidden = true;
  if (board) board.setInteractive(true);
}

async function maybeTriggerComputerMove() {
  if (!vsComputerMode || vsComputerGameOver) return;
  if (chess.turn() !== computerSide) return;
  if (chess.isGameOver()) return;
  els.engineStatus.textContent = "L'ordinateur réfléchit…";
  try {
    const fenBefore = chess.fen();
    const moveResult = computerElo < ELO_CALIBRATED_MIN
      ? await pickWeakMove(fenBefore, computerElo)
      : await pickEngineMove(fenBefore, computerElo);
    if (!moveResult) {
      els.engineStatus.textContent = gameOverMessage(chess)
        || (engineState === "failed"
          ? "Le moteur est indisponible — impossible de faire jouer l'ordinateur. Vérifiez votre connexion internet et relancez la partie."
          : "L'ordinateur n'a pas pu trouver de coup, réessayez.");
      return;
    }
    board.setChess(chess, { from: moveResult.from, to: moveResult.to });
    if (chess.isGameOver()) playGameEnd();
    else if (chess.inCheck()) playCheck();
    else if (moveResult.captured) playCapture();
    else playMove();
    recordMove(fenBefore, moveResult, { skipLiveCoach: true, skipEvalRefresh: true });
  } catch (e) {
    els.engineStatus.textContent = "L'ordinateur n'a pas pu jouer (moteur indisponible).";
  }
}

// Full-strength engine move, aimed at a calibrated Elo (>= 1320) via UCI_Elo.
// Opponent moves are capped to a depth that's reliably fast on modest
// hardware — depth 16 is still crushingly strong (nowhere near "skimping"),
// but "Approfondi" (depth 20) was measured taking several minutes on some
// machines for a single position, which made a live game unplayable. The
// "Profondeur" setting keeps its full effect for deliberate one-off actions
// (Aide, Analyser coup par coup) where the user has explicitly agreed to wait.
const OPPONENT_DEPTH_CAP = 16;

async function pickEngineMove(fenBefore, elo) {
  await applyEngineStrength(elo);
  const result = await evaluateFen(fenBefore, Math.min(getDepth(), OPPONENT_DEPTH_CAP));
  await applyEngineStrength(null); // restore full strength for analysis features
  if (!result.bestMove) return null;
  const from = result.bestMove.slice(0, 2), to = result.bestMove.slice(2, 4), promo = result.bestMove.slice(4) || undefined;
  return chess.move({ from, to, promotion: promo });
}

// Artisanal weakening below the engine's calibrated range: mixes uniformly
// random legal moves with shallow-depth engine moves, similar in spirit to
// how commercial low-rated bots (e.g. chess.com) deliberately misplay rather
// than relying on the engine's own (non-existent, below ~1320) strength dial.
async function pickWeakMove(fenBefore, elo) {
  const { blunderProb, depth } = weakPlayParams(elo);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  if (Math.random() < blunderProb) {
    const mv = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    return chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  }
  await applyEngineStrength(null);
  const result = await evaluateFen(fenBefore, depth);
  if (!result.bestMove) {
    const mv = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    return chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  }
  const from = result.bestMove.slice(0, 2), to = result.bestMove.slice(2, 4), promo = result.bestMove.slice(4) || undefined;
  return chess.move({ from, to, promotion: promo });
}

// Explains a single move immediately after it's played (used by the "Coach en direct" toggle).
async function runLiveCoach(fenBefore, moveResult, plyIndex) {
  els.moveExplanation.hidden = false;
  els.moveExplanation.textContent = "Le coach réfléchit…";
  try {
    const depth = getDepth();
    const [beforeR, afterR] = await Promise.all([
      evaluateFen(fenBefore, depth),
      evaluateFen(moveResult.after, depth),
    ]);
    const beforeWhiteCp = toWhiteCentipawns(beforeR.score, fenBefore.split(" ")[1]);
    const afterWhiteCp = toWhiteCentipawns(afterR.score, moveResult.after.split(" ")[1]);
    const color = moveResult.color;
    const beforeSigned = color === "w" ? beforeWhiteCp : -beforeWhiteCp;
    const afterSigned = color === "w" ? afterWhiteCp : -afterWhiteCp;
    const cpLoss = Math.max(0, Math.round(beforeSigned - afterSigned));
    const classification = classify(cpLoss);
    const tags = buildHeuristicTags(moveResult, plyIndex, liveMoveCountByPieceType);
    const explanation = buildExplanation(moveResult, classification, cpLoss, tags, beforeSigned, afterSigned);

    els.moveExplanation.innerHTML = `<span class="mv-symbol sym-${classification.key}">${classification.symbol}</span> <span class="best-move">${moveResult.san}</span><br>${explanation}`;
    if (isVoiceSupported()) {
      stopSpeech();
      speakOne(`${moveResult.san}. ${explanation}`);
    }
  } catch (e) {
    els.moveExplanation.textContent = "Coach indisponible pour ce coup (moteur non prêt ou hors ligne).";
  }
}

// Loads a PGN string into the analysis board. Returns true on success.
export function loadPgnString(pgn) {
  const tmp = new Chess();
  try {
    tmp.loadPgn(pgn);
  } catch (e) {
    return false;
  }
  chess = tmp;
  board.setChess(chess, null);
  rebuildHistoryFromChessObject(chess);
  syncFen();
  updateMoveList();
  updateNavButtons();
  requestEval();
  return true;
}

function buildPgnFromHistory() {
  const startFen = plyFens[0];
  const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const tmp = new Chess(startFen);
  if (startFen !== DEFAULT_FEN) {
    tmp.header("SetUp", "1", "FEN", startFen);
  }
  for (const mv of plyMoves) {
    tmp.move(mv.san);
  }
  return tmp.pgn();
}

function updateMoveList() {
  els.moveList.innerHTML = "";
  for (let i = 0; i < plyMoves.length; i += 2) {
    const li = document.createElement("li");
    li.className = "mv-pair";
    const whiteMove = plyMoves[i];
    const blackMove = plyMoves[i + 1];
    const whiteSpan = document.createElement("span");
    whiteSpan.className = "mv-clickable" + (currentPly === i + 1 ? " current" : "");
    whiteSpan.textContent = whiteMove.san;
    whiteSpan.addEventListener("click", () => goToPly(i + 1));
    li.appendChild(whiteSpan);
    if (blackMove) {
      li.appendChild(document.createTextNode("  "));
      const blackSpan = document.createElement("span");
      blackSpan.className = "mv-clickable" + (currentPly === i + 2 ? " current" : "");
      blackSpan.textContent = blackMove.san;
      blackSpan.addEventListener("click", () => goToPly(i + 2));
      li.appendChild(blackSpan);
    }
    els.moveList.appendChild(li);
  }
  if (currentPly === 0 && els.moveList.children.length) {
    // no move highlighted yet before first move; nothing to do
  }
}

function ensureEngine(urlIndex = 0) {
  if (engine || engineState === "failed") return;
  if (urlIndex >= STOCKFISH_CDN_URLS.length) {
    engineState = "failed";
    els.engineStatus.textContent = "Le moteur n'a pas pu se charger (vérifiez la connexion internet, ou qu'aucun bloqueur ne filtre cdn.jsdelivr.net).";
    engineReadyResolvers.forEach((r) => r());
    engineReadyResolvers = [];
    return;
  }
  engineState = "loading";
  els.engineStatus.textContent = "Chargement du moteur…";
  try {
    const w = new Worker(STOCKFISH_CDN_URLS[urlIndex]);
    let settled = false;
    w.onmessage = (e) => { settled = true; handleEngineMessage(e); };
    w.onerror = () => {
      if (settled) return;
      w.terminate();
      engine = null;
      ensureEngine(urlIndex + 1);
    };
    engine = w;
    engine.postMessage("uci");
    // ONE single timeout for this whole loading attempt (not one per queued
    // caller — that was the earlier bug, where every internal sub-step of a
    // single move re-waited its own timeout and they all added up). If the
    // engine hasn't said "ready" by then — silently blocked, stuck between
    // uciok and readyok, whatever — move on to the next CDN URL, or give up.
    setTimeout(() => {
      if (engineState === "ready") return;
      w.onerror = null;
      w.terminate();
      if (engine === w) engine = null;
      ensureEngine(urlIndex + 1);
    }, 7000);
  } catch (e) {
    ensureEngine(urlIndex + 1);
  }
}

function whenEngineReady() {
  if (engineIsReady) return Promise.resolve();
  if (engineState === "failed") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    engineReadyResolvers.push(() => { if (!done) { done = true; resolve(); } });
  });
}

let lastBestMove = null;
let lastScore = null;
let pendingResolve = null;

function handleEngineMessage(e) {
  const line = typeof e.data === "string" ? e.data : "";
  if (line === "uciok") {
    engine.postMessage("isready");
    return;
  }
  if (line === "readyok") {
    if (!engineIsReady) {
      engineIsReady = true;
      engineState = "ready";
      els.engineStatus.textContent = "Moteur prêt.";
      engineReadyResolvers.forEach((r) => r());
      engineReadyResolvers = [];
    }
    return;
  }
  if (line.startsWith("info") && line.includes("score")) {
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);
    if (mateMatch) {
      lastScore = { mate: parseInt(mateMatch[1], 10) };
    } else if (cpMatch) {
      lastScore = { cp: parseInt(cpMatch[1], 10) };
    }
    if (pvMatch) {
      lastBestMove = pvMatch[1].split(" ")[0];
    }
    if (!busy) renderEval();
  }
  if (line.startsWith("bestmove")) {
    const parts = line.split(" ");
    if (parts[1] && parts[1] !== "(none)") lastBestMove = parts[1];
    if (!busy) renderEval(true);
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ score: lastScore, bestMove: lastBestMove });
    }
  }
}

function renderEval(final) {
  if (!lastScore) return;
  els.evalBar.hidden = false;
  const turn = chess.turn();
  let cpForWhite;
  if (lastScore.mate !== undefined) {
    cpForWhite = (lastScore.mate > 0 ? 1 : -1) * 1000 * (turn === "w" ? 1 : -1);
  } else {
    cpForWhite = turn === "w" ? lastScore.cp : -lastScore.cp;
  }
  const pct = Math.max(2, Math.min(98, 50 + cpForWhite / 20));
  els.evalBarFill.style.width = pct + "%";
  els.evalBarFill.style.background = cpForWhite >= 0 ? "var(--brass)" : "var(--ink-faint)";

  const evalText = lastScore.mate !== undefined
    ? `Mat en ${Math.abs(lastScore.mate)} coup${Math.abs(lastScore.mate) > 1 ? "s" : ""} pour ${(lastScore.mate > 0) === (turn === "w") ? "les Blancs" : "les Noirs"}`
    : `Évaluation : ${(cpForWhite / 100).toFixed(2)} (${cpForWhite >= 0 ? "avantage Blancs" : "avantage Noirs"})`;

  let bestSan = lastBestMove;
  try {
    if (lastBestMove && lastBestMove.length >= 4) {
      const testChess = new Chess(chess.fen());
      const from = lastBestMove.slice(0, 2), to = lastBestMove.slice(2, 4), promo = lastBestMove.slice(4) || undefined;
      const r = testChess.move({ from, to, promotion: promo });
      if (r) bestSan = r.san;
    }
  } catch (e) { /* keep UCI form */ }

  els.engineStatus.textContent = final ? "Analyse terminée." : "Analyse en cours…";
  els.engineOutput.innerHTML = `${evalText}<br>Meilleur coup : <span class="best-move">${bestSan || "…"}</span>`;
}

let evalTimeout = null;
// Depth used for the always-on live evaluation bar. Kept fast and fixed on
// purpose — it refreshes automatically after every move (including the
// computer's), so it must never inherit the user's "Profondeur" setting,
// which is meant for deliberate one-off actions (Aide, analyse complète)
// where the user has explicitly agreed to wait.
const LIVE_EVAL_DEPTH = 12;

function requestEval() {
  if (!engineEnabled || busy) return;
  ensureEngine();
  if (chess.isGameOver()) {
    els.engineOutput.textContent = gameOverMessage(chess) || "Partie terminée.";
    els.evalBar.hidden = true;
    return;
  }
  clearTimeout(evalTimeout);
  const fenAtRequest = chess.fen();
  evalTimeout = setTimeout(async () => {
    if (!engine) return;
    try {
      const result = await evaluateFen(fenAtRequest, LIVE_EVAL_DEPTH);
      if (fenAtRequest !== chess.fen()) return; // position changed while we were waiting
      lastScore = result.score;
      lastBestMove = result.bestMove;
      renderEval(true);
    } catch (e) { /* engine unavailable */ }
  }, 250);
}

// Queued one-off evaluation used by the full-game analyzer. Resolves once
// with { score: {cp|mate}, bestMove: uci } for the given FEN.
// A hard timeout guarantees this NEVER hangs forever, even if the engine
// stalls or a message is somehow lost — worst case we give up gracefully
// after a few seconds instead of freezing the whole game (and its clock).
export function evaluateFen(fen, depth = 12) {
  ensureEngine();
  return queueEngineTask(() => {
    return new Promise((resolve) => {
      if (!engine) { resolve({ score: null, bestMove: null }); return; }
      lastScore = null;
      lastBestMove = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (pendingResolve === finish) pendingResolve = null;
        clearTimeout(timer);
        resolve(value);
      };
      // Generous safety ceiling. If it fires, don't just politely ask the
      // engine to "stop" — on this single-threaded WASM build "stop" isn't
      // always honored promptly at high depth, and the old search can keep
      // silently chewing CPU in the background, corrupting every request
      // that follows. Instead, kill the worker outright and let the next
      // call spin up a fresh one — guarantees a clean slate no matter what.
      const timer = setTimeout(() => {
        if (engine) { engine.terminate(); engine = null; }
        engineIsReady = false;
        engineState = "idle";
        finish({ score: lastScore, bestMove: lastBestMove });
      }, 20000);
      pendingResolve = finish;
      engine.postMessage("position fen " + fen);
      engine.postMessage("go depth " + depth);
    });
  });
}
