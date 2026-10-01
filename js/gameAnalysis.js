import { Chess } from "./chess.js";
import { speakOne, playSequence, pauseSequence, resumeSequence, stop as stopSpeech, isSupported as isVoiceSupported } from "./voiceCoach.js";
import { getDepth } from "./engineSettings.js";
import { sanDisplay, sanSpoken, castleNote, captureNote, enPassantNote, promoNote, checkmateWord, checkWord, pieceLetter, decimalSeparator } from "./notation.js";
import { getCoachLang, t, ttsLangFor } from "./i18n.js";
import { gameSignature, getSavedAnalysis, saveAnalysis } from "./gameLibrary.js";

// A move counts as "there was a better one" from an inaccuracy up (≥ 25
// centipawns lost) — below that the difference is too small to act on.
const BETTER_MOVE_MIN_LOSS = 25;
// Below this many moves per side the level estimate isn't meaningful (one
// perfect opening move would read as ~2800 Elo).
const ELO_MIN_MOVES = 8;

function hasBetterMove(report) {
  return report.cpLoss >= BETTER_MOVE_MIN_LOSS && !!report.bestMoveUci && report.bestMoveUci !== report.playedUci;
}

export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

let ctx = null; // { getChess, evaluateFen, isEngineEnabled, enableEngine, setBusy }
let els = {};
let running = false;
// Signature of the game the analysis on screen belongs to (null = none).
let analyzedSig = null;

// Green "correction" move of each error/blunder of the analysed game, by the
// ply of the position BEFORE the bad move: shown whenever the board lands there.
const correctionHints = new Map();
export function correctionHintAt(ply) {
  return correctionHints.get(ply) || null;
}

// Engine results already worked out during this session, by game signature —
// and, for games of the library, kept with the game itself (gameLibrary.js).
const sessionAnalyses = new Map();

// Coach voice state: "idle" (nothing read), "playing", or "paused". A click on
// the voice button while it reads = pause; the board can then be moved freely
// (◀ ▶ ...), and "Reprendre" carries on from the move now on the board.
let coachState = "idle";
let coachNavigated = false; // the board was moved by the user during the pause

// The voice moves the board itself (onItemStart below): those moves are marked,
// so a position change made by the USER while it talks can be told apart. A
// user move of the board while the voice reads simply pauses it (see
// coachUserNavigated); loading another game etc. stops it (stopCoachIfPlaying).
let coachDriving = false;
export function isCoachDriving() { return coachDriving; }
export function stopCoachIfPlaying() {
  if (coachState === "idle") return;
  const stopBtn = document.getElementById("coachStopBtn");
  if (stopBtn && !stopBtn.hidden) stopBtn.click();
  else { stopSpeech(); setCoachState("idle"); }
}
export function coachUserNavigated() {
  if (coachState === "idle") return;
  if (coachState === "playing") {
    const pauseBtn = document.getElementById("coachPauseBtn");
    if (pauseBtn && !pauseBtn.hidden) pauseBtn.click();
  }
  coachNavigated = true;
}

function setCoachState(state) {
  coachState = state;
  if (els.results) els.results.classList.toggle("coach-reading", state !== "idle");
  if (state !== "paused") coachNavigated = false;
  if (ctx.onCoachState) ctx.onCoachState(state);
}

function currentGameSig() {
  if (!ctx) return null;
  const plies = ctx.getPlies ? ctx.getPlies() : ctx.getChess().history({ verbose: true });
  if (plies.length === 0) return null;
  return gameSignature(plies[0].before, plies.slice(0, 80).map((p) => p.san));
}

// Once the game on the board is analysed, the "Analyser coup par coup" row goes
// away (the results, with their own ↻ and ▾, take its place); it comes back
// when the game changes.
export function refreshAnalysisButton() {
  if (!els.btn) return;
  const done = !running && analyzedSig !== null && analyzedSig === currentGameSig();
  const panel = document.querySelector(".fullgame-panel");
  if (panel) panel.classList.toggle("fullgame-done", done);
}

// A new game / position replaces the analysis on screen.
export function resetAnalysis() {
  analyzedSig = null;
  correctionHints.clear();
  refreshAnalysisButton();
}

export function initFullGameAnalysis(context) {
  ctx = context;
  els.btn = document.getElementById("analyzeGameBtn");
  els.progress = document.getElementById("fullgameProgress");
  els.results = document.getElementById("fullgameResults");

  els.btn.addEventListener("click", () => {
    if (running) return;
    runAnalysis();
  });
  // ↻ and ▾ live in the results (they replace the button row once it is gone).
  els.results.addEventListener("click", (e) => {
    if (e.target.closest(".fullgame-redo-btn")) { if (!running) runAnalysis({ force: true }); }
    else if (e.target.closest(".fullgame-close-btn")) e.target.closest("details").open = false;
  });
}

async function runAnalysis(options = {}) {
  const verboseHistory = ctx.getPlies ? ctx.getPlies() : ctx.getChess().history({ verbose: true });
  if (verboseHistory.length === 0) {
    els.results.innerHTML = `<div class="phase-block"><p>Chargez ou jouez d'abord une partie (plusieurs coups) avant de lancer l'analyse complète.</p></div>`;
    return;
  }

  const MAX_PLIES = 80;
  const plies = verboseHistory.slice(0, MAX_PLIES);

  running = true;
  els.btn.disabled = true;
  els.progress.hidden = false;
  els.results.innerHTML = "";
  // The voice button is there from the start, greyed out until the analysis is done.
  const pending = document.createElement("div");
  pending.className = "phase-block";
  pending.innerHTML = isVoiceSupported()
    ? '<button class="btn-ghost coach-btn" disabled>🔊<span class="coach-label"> Coach vocal</span></button> <span class="analysis-pending-text">Analyse…</span>'
    : '<span class="analysis-pending-text">Analyse…</span>';
  els.results.appendChild(pending);
  const pendingText = pending.querySelector(".analysis-pending-text");
  stopSpeech();
  setCoachState("idle");
  ctx.setBusy(true);
  if (!ctx.isEngineEnabled()) ctx.enableEngine();

  try {
    // Evaluate every position in the sequence once: start position + after each ply.
    const fens = [plies[0].before, ...plies.map((p) => p.after)];
    let evals = [];
    let bestMoves = [];
    const sig = gameSignature(plies[0].before, plies.map((p) => p.san));
    const depth = getDepth();
    const known = options.force ? null : sessionAnalyses.get(sig);
    const saved = options.force ? null : (known && known.depth >= depth ? known : getSavedAnalysis(sig, depth));
    if (saved && saved.evals.length === fens.length) {
      // Already analysed: nothing to compute.
      evals = saved.evals;
      bestMoves = saved.bestMoves;
      pendingText.textContent = "Analyse déjà faite";
      if (ctx.onAnalysisProgress) ctx.onAnalysisProgress(fens.length - 1, fens.length - 1);
    } else {
      for (let i = 0; i < fens.length; i++) {
        els.progress.textContent = `Analyse du coup ${i} / ${fens.length - 1} (profondeur ${depth})…`;
        pendingText.textContent = `Analyse ${i} / ${fens.length - 1}…`;
        if (ctx.onAnalysisProgress) ctx.onAnalysisProgress(i, fens.length - 1);
        const result = await ctx.evaluateFen(fens[i], depth);
        const turn = fens[i].split(" ")[1]; // 'w' | 'b' — side to move in this position
        evals.push(toWhiteCentipawns(result.score, turn));
        bestMoves.push(result.bestMove || null);
      }
      const analysis = { depth, evals, bestMoves };
      sessionAnalyses.set(sig, analysis);
      saveAnalysis(sig, analysis); // kept with the game when it is in the library
    }
    pending.remove();

    const moveReports = [];
    const devTracker = { w: new Set(), b: new Set() }; // piece types moved more than once tracking
    const moveCountByPieceType = { w: {}, b: {} };

    for (let i = 0; i < plies.length; i++) {
      const mv = plies[i];
      const color = mv.color; // 'w' | 'b'
      const beforeWhiteCp = evals[i];
      const afterWhiteCp = evals[i + 1];
      const beforeSigned = color === "w" ? beforeWhiteCp : -beforeWhiteCp;
      const afterSigned = color === "w" ? afterWhiteCp : -afterWhiteCp;
      const cpLoss = Math.max(0, Math.round(beforeSigned - afterSigned));

      const classification = classify(cpLoss);
      const tags = buildHeuristicTags(mv, i, moveCountByPieceType);
      const explanation = buildExplanation(mv, classification, cpLoss, tags, beforeSigned, afterSigned);

      moveReports.push({
        ply: i,
        moveNumber: Math.floor(i / 2) + 1,
        color,
        san: mv.san,
        fenBefore: fens[i],
        cpLoss,
        classification,
        tags,
        explanation,
        evalAfterWhiteCp: afterWhiteCp,
        bestMoveUci: bestMoves[i],
        playedUci: mv.from + mv.to + (mv.promotion || ""),
      });
    }

    renderMoveList(moveReports);
    renderElo(moveReports);
    renderErrorCoach(moveReports);
    analyzedSig = sig;
    if (ctx.onAnalysisDone) ctx.onAnalysisDone(true, { elo: { w: estimateElo(moveReports, "w"), b: estimateElo(moveReports, "b") } });
  } catch (e) {
    els.results.innerHTML = `<div class="phase-block"><p>L'analyse a été interrompue (moteur indisponible). Réessayez avec le moteur activé et une connexion internet stable.</p></div>`;
    if (ctx.onAnalysisDone) ctx.onAnalysisDone(false);
  } finally {
    running = false;
    els.btn.disabled = false;
    refreshAnalysisButton();
    els.progress.hidden = true;
    ctx.setBusy(false);
    syncResultsHeight();
    // Re-sync once webfonts (Fraunces/Source Sans/JetBrains Mono) finish
    // loading: on a first visit (nothing cached yet — e.g. a fresh browser
    // profile or private window) they can swap in after this point, subtly
    // resizing the board-column text and shifting the nav row's position
    // just enough to throw off the height computed above.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncResultsHeight);
    setTimeout(syncResultsHeight, 400);
  }
}

// Lines up "Analyse complète de la partie"'s bottom edge with the board's
// move-navigation row (⏮◀▶⏭) — set as an explicit height (not just a cap)
// so a short result set still stretches down to that line instead of
// stopping early and leaving a gap. Only while the two columns actually sit
// side by side (desktop grid); on the stacked mobile layout there's nothing
// to line up with, so it's left free to take whatever height it needs.
// On a short window the nav row itself can be below the visible fold, so
// lining up with it alone isn't enough — the height is also clamped to the
// actual viewport height, whichever of the two limits is smaller wins.
function syncResultsHeight() {
  const nav = document.querySelector(".nav-controls");
  const boardCol = document.querySelector(".analyse-board-col");
  const sideCol = document.querySelector(".analyse-side-col");
  const panel = els.results && els.results.closest(".side-section");
  if (!nav || !boardCol || !sideCol || !els.results || !panel) return;

  // Clear any previous forced height first so the measurements below reflect
  // the content's natural size, not a stale constraint from an earlier call.
  els.results.style.height = "";
  els.results.style.overflowY = "";

  const boardRect = boardCol.getBoundingClientRect();
  const sideRect = sideCol.getBoundingClientRect();
  // Side-by-side means the side column starts at/after the board column's
  // right edge — checking horizontal position instead of exact .top equality
  // survives sub-pixel rounding differences from display scaling, where the
  // old "top1 === top2" check could be off by a few px and wrongly assume a
  // stacked (mobile) layout, silently skipping the sync entirely.
  const sideByCol = sideRect.left >= boardRect.right - 20;
  if (!sideByCol) return;

  const navBottom = nav.getBoundingClientRect().bottom;
  const viewportBottom = window.innerHeight - 16;
  const panelRect = panel.getBoundingClientRect();
  const resultsRect = els.results.getBoundingClientRect();
  // The card the user actually sees is `.side-section` (its border/background),
  // not #fullgameResults — the section has its own bottom padding, so its
  // visible edge sits a fixed amount below #fullgameResults's own bottom.
  // Growing/shrinking #fullgameResults by the gap between the section's
  // CURRENT bottom and the target lines the section's real edge up with the
  // nav row regardless of that fixed offset.
  const targetPanelBottom = Math.min(navBottom, viewportBottom);
  const delta = targetPanelBottom - panelRect.bottom;
  const targetHeight = resultsRect.height + delta;
  els.results.style.height = Math.max(120, targetHeight) + "px";
  els.results.style.overflowY = "auto";
}

window.addEventListener("resize", () => { if (els.results && els.results.children.length) syncResultsHeight(); });

export function toWhiteCentipawns(score, turn) {
  if (!score) return 0;
  const sign = turn === "w" ? 1 : -1;
  if (score.mate !== undefined) {
    const magnitude = 2000 - Math.min(50, Math.abs(score.mate)) * 10;
    return sign * (score.mate > 0 ? 1 : -1) * magnitude;
  }
  return sign * (score.cp || 0);
}

// --- Heuristic move tagging -------------------------------------------------

export function buildHeuristicTags(mv, plyIndex, moveCountByPieceType) {
  const d = t(getCoachLang());
  const tags = [];
  const color = mv.color;
  const moveNumber = Math.floor(plyIndex / 2) + 1;
  const opening = moveNumber <= 12;

  if (mv.flags && (mv.flags.includes("k") || mv.flags.includes("q"))) {
    tags.push({ kind: "pro", text: d.tagRoque });
  }
  if (mv.captured) {
    const val = PIECE_VALUE[mv.captured] || 0;
    tags.push({ kind: "pro", text: d.tagCapture(val) });
  }
  if (opening && mv.piece === "p" && ["d4", "d5", "e4", "e5"].includes(mv.to)) {
    tags.push({ kind: "pro", text: d.tagCenter });
  }
  if (opening && (mv.piece === "n" || mv.piece === "b")) {
    moveCountByPieceType[color][mv.piece] = (moveCountByPieceType[color][mv.piece] || 0) + 1;
    if (moveCountByPieceType[color][mv.piece] > 1) {
      tags.push({ kind: "con", text: d.tagRedeveloped });
    }
  }
  if (mv.flags && mv.flags.includes("p")) {
    tags.push({ kind: "pro", text: d.tagPromotion });
  }
  return tags;
}

export function classify(cpLoss) {
  const d = t(getCoachLang());
  if (cpLoss < 10) return { key: "excellent", symbol: "!!", label: d.classifyLabel.excellent };
  if (cpLoss < 25) return { key: "good", symbol: "", label: d.classifyLabel.good };
  if (cpLoss < 50) return { key: "inaccuracy", symbol: "?!", label: d.classifyLabel.inaccuracy };
  if (cpLoss < 100) return { key: "mistake", symbol: "?", label: d.classifyLabel.mistake };
  return { key: "blunder", symbol: "??", label: d.classifyLabel.blunder };
}

export function buildExplanation(mv, classification, cpLoss, tags, beforeSigned, afterSigned) {
  const d = t(getCoachLang());
  const parts = [];
  const sideLabel = d.sideLabel(mv.color, true);

  parts.push(d.engineSentence[classification.key](classification.label));

  const pros = tags.filter((tag) => tag.kind === "pro").map((tag) => tag.text);
  const cons = tags.filter((tag) => tag.kind === "con").map((tag) => tag.text);
  if (pros.length) parts.push(d.advantageLine(`${sideLabel} ${pros.join(", ")}`));
  if (cons.length) parts.push(d.drawbackLine(cons.join(", ")));

  return parts.join(" ");
}

// --- Rendering ---------------------------------------------------------------

function coachPlayHtml() { return `🔊<span class="coach-label"> ${t(getCoachLang()).coachVocalLabel}</span>`; }
function coachResumeHtml() { return `▶<span class="coach-label"> ${t(getCoachLang()).resumeLabel}</span>`; }

function renderMoveList(reports) {
  const wrap = document.createElement("div");
  wrap.className = "phase-block";
  const titleRow = document.createElement("div");
  titleRow.className = "coach-title-row";
  // Filled by renderElo(): the level estimate sits on this same line.
  const eloSlot = document.createElement("span");
  eloSlot.className = "coach-elo-slot";
  eloSlot.id = "coachEloSlot";
  titleRow.appendChild(eloSlot);

  const d0 = t(getCoachLang());
  if (isVoiceSupported()) {
    const coachBar = document.createElement("div");
    coachBar.className = "coach-bar";
    coachBar.innerHTML = `
      <button class="btn-ghost coach-btn" id="coachPlayBtn" title="${d0.coachVocalLabel}">${coachPlayHtml()}</button>
      <button class="btn-ghost coach-btn" id="coachPauseBtn" title="${d0.pauseLabel}" aria-label="${d0.pauseLabel}" hidden>⏸<span class="coach-label"> ${d0.pauseLabel}</span></button>
      <button class="btn-ghost coach-btn" id="coachStopBtn" title="${d0.stopLabel}" aria-label="${d0.stopLabel}" hidden>⏹<span class="coach-label"> ${d0.stopLabel}</span></button>
    `;
    titleRow.appendChild(coachBar);
  }
  // "How to read the moves" legend, in the free space right of the levels.
  const legendBtn = document.createElement("button");
  legendBtn.type = "button";
  legendBtn.className = "info-icon-btn legend-info-btn";
  legendBtn.title = d0.legendInfoTitle;
  legendBtn.setAttribute("aria-label", d0.legendInfoTitle);
  legendBtn.textContent = "i";
  titleRow.appendChild(legendBtn);
  const tools = document.createElement("span");
  tools.className = "fullgame-tools";
  tools.innerHTML = `<button type="button" class="btn-ghost fullgame-redo-btn" title="${d0.redoTitle}" aria-label="${d0.redoTitle}">↻</button>`
    + `<button type="button" class="side-close-btn fullgame-close-btn" aria-label="${d0.closeAria}">▾</button>`;
  titleRow.appendChild(tools);
  wrap.appendChild(titleRow);
  els.results.appendChild(wrap);

  if (isVoiceSupported()) wireCoachControls(reports);
}

function wireCoachControls(reports) {
  const playBtn = document.getElementById("coachPlayBtn");
  const pauseBtn = document.getElementById("coachPauseBtn");
  const stopBtn = document.getElementById("coachStopBtn");
  let playing = false; // a reading is under way (playing OR paused)

  const lang = getCoachLang();
  const d = t(lang);
  const items = reports.map((report) => {
    let text = `${d.moveSays(report.moveNumber, report.color)} ${sanSpoken(report.san, lang)}. ${report.explanation}`;
    if (hasBetterMove(report)) text += " " + d.betterMoveHint;
    return { text };
  });
  const callbacks = {
    // The board follows the move being commented: on the position BEFORE
    // it when a better move existed (so the ampoule can show that move),
    // otherwise on the position after it.
    onItemStart: (i) => {
      const report = reports[i];
      if (!report || !ctx.goToPly) return;
      coachDriving = true;
      try { ctx.goToPly(hasBetterMove(report) ? report.ply : report.ply + 1); } finally { coachDriving = false; }
    },
    onComplete: () => {
      playing = false;
      setCoachState("idle");
      playBtn.hidden = false;
      playBtn.innerHTML = coachPlayHtml();
      pauseBtn.hidden = true;
      stopBtn.hidden = true;
    },
  };
  // First move not yet shown on the board: where a reading carries on after
  // the user has moved the board during the pause.
  const indexFromBoard = () => {
    const at = ctx.getCurrentPly ? ctx.getCurrentPly() : 0;
    const i = reports.findIndex((r) => r.ply >= at);
    return i < 0 ? reports.length - 1 : i;
  };

  playBtn.addEventListener("click", () => {
    if (playing) {
      // Resume after a pause: from where the reading stopped, or — if the
      // board was moved meanwhile — from the move now on the board.
      playBtn.hidden = true;
      pauseBtn.hidden = false;
      stopBtn.hidden = false;
      const restart = coachNavigated;
      setCoachState("playing");
      if (restart) playSequence(items, callbacks, indexFromBoard(), ttsLangFor(lang));
      else resumeSequence();
      return;
    }
    playing = true;
    setCoachState("playing");
    playBtn.hidden = true;
    pauseBtn.hidden = false;
    stopBtn.hidden = false;
    playSequence(items, callbacks, 0, ttsLangFor(lang));
  });

  pauseBtn.addEventListener("click", () => {
    pauseSequence();
    setCoachState("paused");
    pauseBtn.hidden = true;
    playBtn.hidden = false;
    playBtn.innerHTML = coachResumeHtml();
  });

  stopBtn.addEventListener("click", () => {
    stopSpeech();
    playing = false;
    setCoachState("idle");
    playBtn.hidden = false;
    playBtn.innerHTML = coachPlayHtml();
    pauseBtn.hidden = true;
    stopBtn.hidden = true;
  });
}

// --- Guided error-correction coach ------------------------------------------

function bestMoveSan(fenBefore, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const c = new Chess(fenBefore);
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4) || undefined;
    const r = c.move({ from, to, promotion: promo });
    return r ? r.san : null;
  } catch (e) {
    return null;
  }
}

// Explique pourquoi le coup suggéré (bestSan) était meilleur que le coup joué :
// rejoue le coup suggéré pour récupérer ses propriétés (capture, roque, centre…)
// et réutilise les mêmes tags heuristiques que pour le coup joué.
function explainBestMove(fenBefore, uci, bestSan, cpLoss, plyIndex) {
  if (!uci || uci.length < 4) return null;
  try {
    const lang = getCoachLang();
    const d = t(lang);
    const c = new Chess(fenBefore);
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4) || undefined;
    const r = c.move({ from, to, promotion: promo });
    if (!r) return null;
    const tags = buildHeuristicTags(r, plyIndex, { w: {}, b: {} });
    const pros = tags.filter((tag) => tag.kind === "pro").map((tag) => tag.text);
    const points = (cpLoss / 100).toFixed(1).replace(".", decimalSeparator(lang));
    return d.whyTemplate(bestSan, points, cpLoss >= 200, pros.join(", "));
  } catch (e) {
    return null;
  }
}

// A move written for a beginner: piece letter, square it leaves, arrow, square
// it reaches, then what happens — "F f8 → c5", "P d2 → c3 (prise)",
// "C d6 → f7 (prise, échec)". Castling is spelt out.
function describeMove(fenBefore, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const lang = getCoachLang();
    const c = new Chess(fenBefore);
    const r = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    if (!r) return null;
    const notes = [];
    if (r.flags.includes("k") || r.flags.includes("q")) {
      const isMate = r.san.endsWith("#"), isCheck = r.san.endsWith("+");
      return castleNote(lang, r.flags.includes("k")) + (isMate ? ` (${checkmateWord(lang)})` : isCheck ? ` (${checkWord(lang)})` : "");
    }
    if (r.flags.includes("e")) notes.push(enPassantNote(lang));
    else if (r.captured) notes.push(captureNote(lang));
    if (r.promotion) notes.push(promoNote(lang, r.promotion));
    if (r.san.endsWith("#")) notes.push(checkmateWord(lang));
    else if (r.san.endsWith("+")) notes.push(checkWord(lang));
    return `${pieceLetter(r.piece, lang)} ${r.from} → ${r.to}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  } catch (e) { return null; }
}

function renderErrorCoach(reports) {
  const mistakes = reports.filter((r) => r.classification.key === "mistake" || r.classification.key === "blunder");

  const wrap = document.createElement("div");
  wrap.className = "phase-block coach-error-block";

  const d0 = t(getCoachLang());
  if (mistakes.length === 0) {
    const perfectible = reports.filter(hasBetterMove).length;
    const p = document.createElement("p");
    p.textContent = perfectible === 0 ? d0.noMistakes : d0.noMistakesPerfectible(perfectible);
    wrap.appendChild(p);
    els.results.appendChild(wrap);
    return;
  }

  correctionHints.clear();
  for (const r of mistakes) {
    if (r.bestMoveUci) correctionHints.set(r.ply, { from: r.bestMoveUci.slice(0, 2), to: r.bestMoveUci.slice(2, 4) });
  }
  if (ctx.refreshHint) ctx.refreshHint(); // the board may already be on one of these positions

  let index = 0;
  const body = document.createElement("div");
  wrap.appendChild(body);
  els.results.appendChild(wrap);

  // moveBoard is false for the card shown when the analysis ends: the board
  // stays where the user is until he asks (◀ ▶, 👁 Voir).
  function render(moveBoard = true) {
    stopSpeech();
    const lang = getCoachLang();
    const d = t(lang);
    const m = mistakes[index];
    const sideLabel = d.sideLabel(m.color, false);
    const bestSanEn = bestMoveSan(m.fenBefore, m.bestMoveUci);
    const bestSan = bestSanEn ? sanDisplay(bestSanEn, lang) : null;
    const playedText = describeMove(m.fenBefore, m.playedUci) || sanDisplay(m.san, lang);
    const bestText = describeMove(m.fenBefore, m.bestMoveUci) || bestSan;

    // The legend explains "E n / total" with the very numbers on this card.
    const legendItem = document.getElementById("legendErrorItem");
    if (legendItem) legendItem.innerHTML = `<b>${d.errorWordShort}${d.errorWordRest} ${index + 1} / ${mistakes.length}</b> : ${d.legendErrorLine(index + 1, mistakes.length)}`;

    body.innerHTML = `
      <div class="coach-error-head">
        <span class="coach-error-counter" title="${d.errorCounterTitle(index + 1, mistakes.length)}">${d.errorWordShort}<span class="err-word">${d.errorWordRest}</span> ${index + 1} / ${mistakes.length}</span>
        <span class="coach-error-move">
          <span class="mv-symbol sym-${m.classification.key}">${m.classification.symbol}</span>
          ${d.moveHeadLine(m.moveNumber, sideLabel)} <span class="mv-san">${playedText}</span>
        </span>
      </div>
      ${bestText ? `<p class="coach-error-best">${d.betterLabel} <span class="best-move">${bestText}</span></p>` : ""}
      ${bestSan ? `<p class="coach-error-why" id="errWhyText" hidden></p>` : ""}
      <div class="coach-error-actions">
        <button class="btn-ghost" id="errPrevBtn" title="${d.prevErrorTitle}" aria-label="${d.prevErrorTitle}" ${index === 0 ? "disabled" : ""}>◀</button>
        ${isVoiceSupported() ? `<button class="btn-ghost" id="errSpeakBtn" title="${d.listenTitle}" aria-label="${d.listenTitle}">🔊</button>` : ""}
        ${bestSan ? `<button class="btn-ghost" id="errWhyBtn" title="${d.whyTitle(bestSan)}" aria-label="${d.whyAria}">💡</button>` : ""}
        <button class="btn-ghost" id="errShowBtn" title="${d.showBoardTitle}" aria-label="${d.showBoardTitle}">👁</button>
        <button class="btn-primary" id="errResumeBtn">${d.resumeHereLabel}</button>
        <button class="btn-ghost" id="errIgnoreBtn" ${index === mistakes.length - 1 ? "" : `title="${d.ignoreTitle}" aria-label="${d.ignoreTitle}"`}>${index === mistakes.length - 1 ? d.finishLabel : "▶"}</button>
      </div>
    `;

    const showOnBoard = () => {
      if (m.bestMoveUci && ctx.goToPly) {
        ctx.goToPly(m.ply);
        if (ctx.showHint) ctx.showHint(m.bestMoveUci.slice(0, 2), m.bestMoveUci.slice(2, 4));
      }
    };
    body.querySelector("#errShowBtn").onclick = showOnBoard;
    body.querySelector("#errPrevBtn").onclick = () => { index = Math.max(0, index - 1); render(); };
    body.querySelector("#errIgnoreBtn").onclick = () => {
      if (index < mistakes.length - 1) { index++; render(); }
    };
    body.querySelector("#errResumeBtn").onclick = () => {
      if (ctx.goToPly) ctx.goToPly(m.ply);
      const boardEl = document.getElementById("analyseBoardMount");
      if (boardEl) boardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const speakBtn = body.querySelector("#errSpeakBtn");
    if (speakBtn) {
      speakBtn.onclick = () => {
        const text = d.speakErrorTemplate(index + 1, mistakes.length, m.moveNumber, sideLabel, sanSpoken(m.san, lang), m.explanation, bestSanEn ? sanSpoken(bestSanEn, lang) : null);
        speakOne(text, undefined, ttsLangFor(lang));
      };
    }
    const whyBtn = body.querySelector("#errWhyBtn");
    if (whyBtn) {
      whyBtn.onclick = () => {
        const whyText = explainBestMove(m.fenBefore, m.bestMoveUci, bestSan, m.cpLoss, m.ply);
        if (!whyText) return;
        const whyEl = body.querySelector("#errWhyText");
        whyEl.textContent = whyText;
        whyEl.hidden = false;
        speakOne(whyText, undefined, ttsLangFor(lang));
      };
    }

    // Put the board on the position BEFORE this move and light up the
    // suggested move's start and end squares.
    if (moveBoard) showOnBoard();
  }

  render(false);
}

const ACPL_ELO_TABLE = [
  [0, 2900], [10, 2500], [20, 2200], [30, 2000], [40, 1800], [50, 1650],
  [60, 1500], [80, 1300], [100, 1150], [130, 1000], [160, 850], [200, 700], [260, 500],
];

function acplToElo(acpl) {
  if (acpl <= ACPL_ELO_TABLE[0][0]) return ACPL_ELO_TABLE[0][1];
  for (let i = 0; i < ACPL_ELO_TABLE.length - 1; i++) {
    const [x0, y0] = ACPL_ELO_TABLE[i];
    const [x1, y1] = ACPL_ELO_TABLE[i + 1];
    if (acpl >= x0 && acpl <= x1) {
      const t = (acpl - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return ACPL_ELO_TABLE[ACPL_ELO_TABLE.length - 1][1];
}

// Estimated level of one side over the whole game, or null when it has too
// few moves for the figure to mean anything.
export function estimateElo(reports, side) {
  const moves = reports.filter((r) => r.color === side);
  if (moves.length < ELO_MIN_MOVES) return null;
  return acplToElo(Math.round(moves.reduce((sum, r) => sum + r.cpLoss, 0) / moves.length));
}

function renderElo(reports) {
  const sides = ["w", "b"];
  const d = t(getCoachLang());

  // Level of both sides, in the slot made by renderMoveList.
  const slot = document.getElementById("coachEloSlot");
  if (!slot) return;
  slot.innerHTML = "";

  for (const s of sides) {
    const moves = reports.filter((r) => r.color === s);
    if (moves.length === 0) continue;
    let value = "—";
    let tip = d.tooFewMoves(ELO_MIN_MOVES);
    if (moves.length >= ELO_MIN_MOVES) {
      const acpl = Math.round(moves.reduce((sum, r) => sum + r.cpLoss, 0) / moves.length);
      value = `≈ ${acplToElo(acpl)}`;
      tip = d.eloEstimateTip;
    }
    const item = document.createElement("span");
    item.className = "elo-inline";
    item.title = tip;
    item.innerHTML = `<span class="elo-side">${d.sideShort(s)}</span> <span class="elo-value">${value}</span>`;
    slot.appendChild(item);
  }
}
