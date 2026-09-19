import { Chess } from "./chess.js";
import { speakOne, playSequence, pauseSequence, resumeSequence, stop as stopSpeech, isSupported as isVoiceSupported } from "./voiceCoach.js";
import { getDepth } from "./engineSettings.js";
import { sanFr, sanSpoken } from "./notation.js";

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

// "🔊 Écouter la partie" (Moteur & coach): reads the coach commentary for the
// game on the board, running the analysis first when it hasn't been done for
// this exact game yet.
let analyzedSig = null;   // moves of the game the results on screen belong to
let wantVoice = false;    // start reading as soon as the running analysis ends
let coachPlaying = false;
let voiceProgress = "";

function gameSig() {
  const plies = ctx.getPlies ? ctx.getPlies() : ctx.getChess().history({ verbose: true });
  return plies.slice(0, 80).map((p) => p.san).join(" ");
}

function refreshVoiceBtn() {
  if (!els.voiceBtn) return;
  els.voiceBtn.textContent = coachPlaying ? "⏹ Arrêter la voix" : voiceProgress ? voiceProgress : "🔊 Écouter la partie";
}

function setCoachPlaying(v) {
  coachPlaying = v;
  refreshVoiceBtn();
  if (ctx.onCoachState) ctx.onCoachState(v);
}

function toggleCoachVoice() {
  const stopBtn = document.getElementById("coachStopBtn");
  if (stopBtn && !stopBtn.hidden) { stopBtn.click(); return; }
  if (running) { wantVoice = true; return; }
  const playBtn = document.getElementById("coachPlayBtn");
  if (playBtn && analyzedSig !== null && analyzedSig === gameSig()) { playBtn.click(); return; }
  wantVoice = true;
  runAnalysis();
}

export function initFullGameAnalysis(context) {
  ctx = context;
  els.btn = document.getElementById("analyzeGameBtn");
  els.select = document.getElementById("playerSideSelect");
  els.progress = document.getElementById("fullgameProgress");
  els.results = document.getElementById("fullgameResults");
  els.voiceBtn = document.getElementById("engineVoiceBtn");

  els.btn.addEventListener("click", () => {
    if (running) return;
    runAnalysis();
  });
  if (els.voiceBtn) {
    els.voiceBtn.hidden = !isVoiceSupported();
    els.voiceBtn.addEventListener("click", toggleCoachVoice);
  }
}

async function runAnalysis() {
  const verboseHistory = ctx.getPlies ? ctx.getPlies() : ctx.getChess().history({ verbose: true });
  if (verboseHistory.length === 0) {
    if (wantVoice) {
      wantVoice = false;
      voiceProgress = "Aucun coup à lire";
      refreshVoiceBtn();
      setTimeout(() => { voiceProgress = ""; refreshVoiceBtn(); }, 2500);
    }
    els.results.innerHTML = `<div class="phase-block"><p>Chargez ou jouez d'abord une partie (plusieurs coups) avant de lancer l'analyse complète.</p></div>`;
    return;
  }

  const MAX_PLIES = 80;
  const plies = verboseHistory.slice(0, MAX_PLIES);

  running = true;
  els.btn.disabled = true;
  els.progress.hidden = false;
  els.results.innerHTML = "";
  analyzedSig = null;
  stopSpeech();
  setCoachPlaying(false);
  ctx.setBusy(true);
  if (!ctx.isEngineEnabled()) ctx.enableEngine();

  try {
    // Evaluate every position in the sequence once: start position + after each ply.
    const fens = [plies[0].before, ...plies.map((p) => p.after)];
    const evals = [];
    const bestMoves = [];
    for (let i = 0; i < fens.length; i++) {
      els.progress.textContent = `Analyse du coup ${i} / ${fens.length - 1} (profondeur ${getDepth()})…`;
      if (ctx.onAnalysisProgress) ctx.onAnalysisProgress(i, fens.length - 1);
      if (wantVoice) { voiceProgress = `Analyse ${i}/${fens.length - 1}…`; refreshVoiceBtn(); }
      const result = await ctx.evaluateFen(fens[i], getDepth());
      const turn = fens[i].split(" ")[1]; // 'w' | 'b' — side to move in this position
      evals.push(toWhiteCentipawns(result.score, turn));
      bestMoves.push(result.bestMove || null);
    }

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
    analyzedSig = plies.map((p) => p.san).join(" ");
    if (ctx.onAnalysisDone) ctx.onAnalysisDone(true);
    if (wantVoice) {
      wantVoice = false;
      voiceProgress = "";
      const playBtn = document.getElementById("coachPlayBtn");
      if (playBtn) playBtn.click();
    }
  } catch (e) {
    els.results.innerHTML = `<div class="phase-block"><p>L'analyse a été interrompue (moteur indisponible). Réessayez avec le moteur activé et une connexion internet stable.</p></div>`;
    if (ctx.onAnalysisDone) ctx.onAnalysisDone(false);
  } finally {
    running = false;
    wantVoice = false;
    voiceProgress = "";
    refreshVoiceBtn();
    els.btn.disabled = false;
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
  const tags = [];
  const color = mv.color;
  const moveNumber = Math.floor(plyIndex / 2) + 1;
  const opening = moveNumber <= 12;

  if (mv.flags && (mv.flags.includes("k") || mv.flags.includes("q"))) {
    tags.push({ kind: "pro", text: "met le Roi à l'abri (roque)" });
  }
  if (mv.captured) {
    const val = PIECE_VALUE[mv.captured] || 0;
    tags.push({ kind: "pro", text: `gagne du matériel (capture, valeur ≈ ${val})` });
  }
  if (opening && mv.piece === "p" && ["d4", "d5", "e4", "e5"].includes(mv.to)) {
    tags.push({ kind: "pro", text: "renforce le contrôle du centre" });
  }
  if (opening && (mv.piece === "n" || mv.piece === "b")) {
    moveCountByPieceType[color][mv.piece] = (moveCountByPieceType[color][mv.piece] || 0) + 1;
    if (moveCountByPieceType[color][mv.piece] > 1) {
      tags.push({ kind: "con", text: "déplace une pièce déjà développée, au détriment du rythme de développement" });
    }
  }
  if (mv.flags && mv.flags.includes("p")) {
    tags.push({ kind: "pro", text: "promotion : gain de matériel décisif" });
  }
  return tags;
}

export function classify(cpLoss) {
  if (cpLoss < 10) return { key: "excellent", symbol: "!!", label: "Excellent" };
  if (cpLoss < 25) return { key: "good", symbol: "", label: "Bon coup" };
  if (cpLoss < 50) return { key: "inaccuracy", symbol: "?!", label: "Imprécision" };
  if (cpLoss < 100) return { key: "mistake", symbol: "?", label: "Erreur" };
  return { key: "blunder", symbol: "??", label: "Gaffe" };
}

export function buildExplanation(mv, classification, cpLoss, tags, beforeSigned, afterSigned) {
  const parts = [];
  const sideLabel = mv.color === "w" ? "Les Blancs" : "Les Noirs";

  const engineSentence = {
    excellent: `${classification.label} : coup quasi optimal.`,
    good: `${classification.label} : coup solide, proche de l'optimum du moteur.`,
    inaccuracy: `${classification.label} : un coup plus précis existait.`,
    mistake: `${classification.label} : ce coup cède un avantage significatif.`,
    blunder: `${classification.label} : ce coup change probablement l'issue de la partie.`,
  }[classification.key];
  parts.push(engineSentence);

  const pros = tags.filter((t) => t.kind === "pro").map((t) => t.text);
  const cons = tags.filter((t) => t.kind === "con").map((t) => t.text);
  if (pros.length) parts.push(`Avantage : ${sideLabel} ${pros.join(", ")}.`);
  if (cons.length) parts.push(`Inconvénient : ${cons.join(", ")}.`);

  return parts.join(" ");
}

// --- Rendering ---------------------------------------------------------------

function renderMoveList(reports) {
  const wrap = document.createElement("div");
  wrap.className = "phase-block";
  const titleRow = document.createElement("div");
  titleRow.className = "coach-title-row";
  const title = document.createElement("h4");
  title.textContent = "Coup par coup";
  titleRow.appendChild(title);
  // Filled by renderElo(): the level estimate sits on this same line.
  const eloSlot = document.createElement("span");
  eloSlot.className = "coach-elo-slot";
  eloSlot.id = "coachEloSlot";
  titleRow.appendChild(eloSlot);

  if (isVoiceSupported()) {
    const coachBar = document.createElement("div");
    coachBar.className = "coach-bar";
    coachBar.innerHTML = `
      <button class="btn-ghost coach-btn" id="coachPlayBtn">🔊 Coach vocal</button>
      <button class="btn-ghost coach-btn" id="coachPauseBtn" hidden>⏸ Pause</button>
      <button class="btn-ghost coach-btn" id="coachStopBtn" hidden>⏹ Arrêter</button>
    `;
    titleRow.appendChild(coachBar);
  }
  wrap.appendChild(titleRow);
  els.results.appendChild(wrap);

  if (isVoiceSupported()) wireCoachControls(reports);
}

function wireCoachControls(reports) {
  const playBtn = document.getElementById("coachPlayBtn");
  const pauseBtn = document.getElementById("coachPauseBtn");
  const stopBtn = document.getElementById("coachStopBtn");
  let playing = false;

  playBtn.addEventListener("click", () => {
    if (playing) {
      // resume from pause
      resumeSequence();
      playBtn.hidden = true;
      pauseBtn.hidden = false;
      stopBtn.hidden = false;
      return;
    }
    playing = true;
    setCoachPlaying(true);
    playBtn.hidden = true;
    pauseBtn.hidden = false;
    stopBtn.hidden = false;
    const items = reports.map((report) => {
      const numWord = report.color === "w" ? `Coup ${report.moveNumber}, les Blancs jouent` : `Coup ${report.moveNumber}, les Noirs jouent`;
      let text = `${numWord} ${sanSpoken(report.san)}. ${report.explanation}`;
      if (hasBetterMove(report)) text += " Il y avait un meilleur coup ici. Touche l'ampoule pour le voir.";
      return { text };
    });
    playSequence(items, {
      // The board follows the move being commented: on the position BEFORE
      // it when a better move existed (so the ampoule can show that move),
      // otherwise on the position after it.
      onItemStart: (i) => {
        const report = reports[i];
        if (!report || !ctx.goToPly) return;
        ctx.goToPly(hasBetterMove(report) ? report.ply : report.ply + 1);
      },
      onComplete: () => {
        playing = false;
        setCoachPlaying(false);
        playBtn.hidden = false;
        playBtn.textContent = "🔊 Coach vocal";
        pauseBtn.hidden = true;
        stopBtn.hidden = true;
      },
    });
  });

  pauseBtn.addEventListener("click", () => {
    pauseSequence();
    pauseBtn.hidden = true;
    playBtn.hidden = false;
    playBtn.textContent = "▶ Reprendre";
  });

  stopBtn.addEventListener("click", () => {
    stopSpeech();
    playing = false;
    setCoachPlaying(false);
    playBtn.hidden = false;
    playBtn.textContent = "🔊 Coach vocal";
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
    const c = new Chess(fenBefore);
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4) || undefined;
    const r = c.move({ from, to, promotion: promo });
    if (!r) return null;
    const tags = buildHeuristicTags(r, plyIndex, { w: {}, b: {} });
    const pros = tags.filter((t) => t.kind === "pro").map((t) => t.text);
    const points = (cpLoss / 100).toFixed(1).replace(".", ",");
    const parts = [`${bestSan} évitait de perdre environ ${points} point${cpLoss >= 200 ? "s" : ""} d'avantage.`];
    if (pros.length) parts.push(`Ce coup ${pros.join(", ")}.`);
    return parts.join(" ");
  } catch (e) {
    return null;
  }
}

function renderErrorCoach(reports) {
  const mistakes = reports.filter((r) => r.classification.key === "mistake" || r.classification.key === "blunder");

  const wrap = document.createElement("div");
  wrap.className = "phase-block coach-error-block";
  const title = document.createElement("h4");
  title.textContent = "Correction guidée";
  wrap.appendChild(title);

  if (mistakes.length === 0) {
    const perfectible = reports.filter(hasBetterMove).length;
    const p = document.createElement("p");
    p.textContent = perfectible === 0
      ? "Aucune erreur ni gaffe détectée."
      : `Aucune erreur ni gaffe, mais ${perfectible} coup${perfectible > 1 ? "s" : ""} perfectible${perfectible > 1 ? "s" : ""}.`;
    wrap.appendChild(p);
    els.results.appendChild(wrap);
    return;
  }

  let index = 0;
  const body = document.createElement("div");
  wrap.appendChild(body);
  els.results.appendChild(wrap);

  function render() {
    stopSpeech();
    const m = mistakes[index];
    const sideLabel = m.color === "w" ? "les Blancs" : "les Noirs";
    const numLabel = m.color === "w" ? `${m.moveNumber}.` : `${m.moveNumber}…`;
    const bestSanEn = bestMoveSan(m.fenBefore, m.bestMoveUci);
    const bestSan = bestSanEn ? sanFr(bestSanEn) : null;

    body.innerHTML = `
      <div class="coach-error-counter">Erreur ${index + 1} / ${mistakes.length}</div>
      <div class="coach-error-move">
        <span class="mv-symbol sym-${m.classification.key}">${m.classification.symbol}</span>
        ${numLabel} <span class="mv-san">${sanFr(m.san)}</span> — ${sideLabel}
      </div>
      ${bestSan ? `<p class="coach-error-best">→ <span class="best-move">${bestSan}</span></p>` : ""}
      ${bestSan ? `<p class="coach-error-why" id="errWhyText" hidden></p>` : ""}
      <div class="coach-error-actions">
        <button class="btn-ghost" id="errPrevBtn" title="Erreur précédente" aria-label="Erreur précédente" ${index === 0 ? "disabled" : ""}>◀</button>
        ${isVoiceSupported() ? '<button class="btn-ghost" id="errSpeakBtn" title="Écouter l\'explication" aria-label="Écouter l\'explication">🔊</button>' : ""}
        ${bestSan ? `<button class="btn-ghost" id="errWhyBtn" title="Pourquoi ${bestSan} est meilleur ?" aria-label="Pourquoi ce coup est meilleur">💡</button>` : ""}
        <button class="btn-primary" id="errResumeBtn">↩ Reprendre ici</button>
        <button class="btn-ghost" id="errIgnoreBtn" ${index === mistakes.length - 1 ? "" : 'title="Ignorer, aller à l\'erreur suivante" aria-label="Ignorer, aller à l\'erreur suivante"'}>${index === mistakes.length - 1 ? "Terminer" : "▶"}</button>
      </div>
    `;

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
        const text = `Erreur ${index + 1} sur ${mistakes.length}. Coup ${m.moveNumber}, ${sideLabel}, ${sanSpoken(m.san)}. ${m.explanation}` +
          (bestSanEn ? ` Le coup suggéré à la place était ${sanSpoken(bestSanEn)}.` : "");
        speakOne(text);
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
        speakOne(whyText);
      };
    }

    // Put the board on the position BEFORE this move and light up the
    // suggested move's start and end squares.
    if (m.bestMoveUci && ctx.goToPly) {
      ctx.goToPly(m.ply);
      if (ctx.showHint) ctx.showHint(m.bestMoveUci.slice(0, 2), m.bestMoveUci.slice(2, 4));
    }
  }

  render();
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

function renderElo(reports) {
  const side = els.select.value;
  const sides = side === "both" ? ["w", "b"] : [side];

  // Goes on the "Coup par coup" title line (slot made by renderMoveList).
  const slot = document.getElementById("coachEloSlot");
  if (!slot) return;
  slot.innerHTML = "";

  for (const s of sides) {
    const moves = reports.filter((r) => r.color === s);
    if (moves.length === 0) continue;
    let value = "—";
    let tip = `Trop peu de coups pour estimer le niveau (il en faut au moins ${ELO_MIN_MOVES} par camp)`;
    if (moves.length >= ELO_MIN_MOVES) {
      const acpl = Math.round(moves.reduce((sum, r) => sum + r.cpLoss, 0) / moves.length);
      value = `≈ ${acplToElo(acpl)}`;
      tip = "Niveau estimé d'après la qualité des coups joués";
    }
    const item = document.createElement("span");
    item.className = "elo-inline";
    item.title = tip;
    item.innerHTML = `<span class="elo-side">${s === "w" ? "Blancs" : "Noirs"}</span> <span class="elo-value">${value}</span>`;
    slot.appendChild(item);
  }
}

// --- Single-move "help" explanation, used by the Analyse tab's Aide button ---

export function pieceNameFr(letter) {
  return { p: "pion", n: "Cavalier", b: "Fou", r: "Tour", q: "Dame", k: "Roi" }[letter] || letter;
}
