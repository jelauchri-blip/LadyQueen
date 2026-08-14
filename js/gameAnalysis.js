import { Chess } from "./chess.js";
import { speakOne, playSequence, pauseSequence, resumeSequence, stop as stopSpeech, isSupported as isVoiceSupported } from "./voiceCoach.js";
import { getDepth } from "./engineSettings.js";

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

let ctx = null; // { getChess, evaluateFen, isEngineEnabled, enableEngine, setBusy }
let els = {};
let running = false;

export function initFullGameAnalysis(context) {
  ctx = context;
  els.btn = document.getElementById("analyzeGameBtn");
  els.select = document.getElementById("playerSideSelect");
  els.progress = document.getElementById("fullgameProgress");
  els.results = document.getElementById("fullgameResults");

  els.btn.addEventListener("click", () => {
    if (running) return;
    runAnalysis();
  });
}

async function runAnalysis() {
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
  stopSpeech();
  ctx.setBusy(true);
  if (!ctx.isEngineEnabled()) ctx.enableEngine();

  try {
    // Evaluate every position in the sequence once: start position + after each ply.
    const fens = [plies[0].before, ...plies.map((p) => p.after)];
    const evals = [];
    const bestMoves = [];
    for (let i = 0; i < fens.length; i++) {
      els.progress.textContent = `Analyse du coup ${i} / ${fens.length - 1} (profondeur ${getDepth()})…`;
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
      });
    }

    renderMoveList(moveReports);
    renderPhases(moveReports, plies);
    renderElo(moveReports);
    renderErrorCoach(moveReports);
  } catch (e) {
    els.results.innerHTML = `<div class="phase-block"><p>L'analyse a été interrompue (moteur indisponible). Réessayez avec le moteur activé et une connexion internet stable.</p></div>`;
  } finally {
    running = false;
    els.btn.disabled = false;
    els.progress.hidden = true;
    ctx.setBusy(false);
  }
}

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
    excellent: `${classification.label} : ce coup ne cède quasiment rien par rapport au meilleur coup du moteur (perte ≈ ${cpLoss} centipions).`,
    good: `${classification.label} : coup solide, proche de l'optimum du moteur (perte ≈ ${cpLoss} centipions).`,
    inaccuracy: `${classification.label} : un coup plus précis existait ; l'évaluation se dégrade légèrement (perte ≈ ${cpLoss} centipions).`,
    mistake: `${classification.label} : ce coup cède un avantage significatif (perte ≈ ${cpLoss} centipions).`,
    blunder: `${classification.label} : ce coup change probablement l'issue de la partie (perte ≈ ${cpLoss} centipions).`,
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

  const list = document.createElement("div");
  list.className = "annotated-move-wrap";

  const rows = [];
  for (const r of reports) {
    const row = document.createElement("div");
    row.className = "annotated-move";
    const numLabel = r.color === "w" ? `${r.moveNumber}.` : `${r.moveNumber}…`;
    row.innerHTML = `
      <span class="mv-num">${numLabel}</span>
      <span class="mv-san">${r.san}</span>
      <span class="mv-symbol sym-${r.classification.key}">${r.classification.symbol}</span>
      ${isVoiceSupported() ? '<button class="mv-speak" title="Écouter ce coup">🔊</button>' : ""}
      <div class="mv-explain">${r.explanation}</div>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("mv-speak")) return;
      row.classList.toggle("expanded");
    });
    const speakBtn = row.querySelector(".mv-speak");
    if (speakBtn) {
      speakBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stopSpeech();
        row.classList.add("expanded", "speaking");
        const numWord = r.color === "w" ? `Coup ${r.moveNumber} pour les Blancs` : `Coup ${r.moveNumber} pour les Noirs`;
        speakOne(`${numWord}, ${r.san}. ${r.explanation}`, () => row.classList.remove("speaking"));
      });
    }
    list.appendChild(row);
    rows.push({ row, report: r });
  }
  wrap.appendChild(list);
  els.results.appendChild(wrap);

  if (isVoiceSupported()) wireCoachControls(rows);
}

function wireCoachControls(rows) {
  const playBtn = document.getElementById("coachPlayBtn");
  const pauseBtn = document.getElementById("coachPauseBtn");
  const stopBtn = document.getElementById("coachStopBtn");
  let playing = false;

  function clearHighlights() {
    rows.forEach(({ row }) => row.classList.remove("speaking"));
  }

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
    playBtn.hidden = true;
    pauseBtn.hidden = false;
    stopBtn.hidden = false;
    const items = rows.map(({ report }) => {
      const numWord = report.color === "w" ? `Coup ${report.moveNumber}, les Blancs jouent` : `Coup ${report.moveNumber}, les Noirs jouent`;
      return { text: `${numWord} ${report.san}. ${report.explanation}` };
    });
    playSequence(items, {
      onItemStart: (i) => {
        clearHighlights();
        rows[i].row.classList.add("expanded", "speaking");
        rows[i].row.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      onComplete: () => {
        playing = false;
        clearHighlights();
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
    clearHighlights();
    playBtn.hidden = false;
    playBtn.textContent = "🔊 Coach vocal";
    pauseBtn.hidden = true;
    stopBtn.hidden = true;
  });
}

function renderPhases(reports, plies) {
  const openingEnd = Math.min(24, reports.length); // ~12 full moves
  const totalMaterial = (fenPly) => fenPly; // placeholder not used
  const endgameStartIdx = findEndgameStart(plies);

  const phases = [
    { name: "Ouverture", from: 0, to: openingEnd },
    { name: "Milieu de partie", from: openingEnd, to: endgameStartIdx },
    { name: "Finale", from: endgameStartIdx, to: reports.length },
  ].filter((p) => p.to > p.from);

  for (const phase of phases) {
    const slice = reports.slice(phase.from, phase.to);
    if (slice.length === 0) continue;
    const blunders = slice.filter((r) => r.classification.key === "blunder").length;
    const mistakes = slice.filter((r) => r.classification.key === "mistake").length;
    const inaccuracies = slice.filter((r) => r.classification.key === "inaccuracy").length;
    const avgLoss = Math.round(slice.reduce((s, r) => s + r.cpLoss, 0) / slice.length);

    let text = `${slice.length} coups analysés, perte moyenne ≈ ${avgLoss} centipions. `;
    if (blunders + mistakes === 0 && inaccuracies === 0) {
      text += "Aucune erreur notable sur cette phase — jeu précis.";
    } else {
      const bits = [];
      if (blunders) bits.push(`${blunders} gaffe${blunders > 1 ? "s" : ""}`);
      if (mistakes) bits.push(`${mistakes} erreur${mistakes > 1 ? "s" : ""}`);
      if (inaccuracies) bits.push(`${inaccuracies} imprécision${inaccuracies > 1 ? "s" : ""}`);
      text += `Points à travailler : ${bits.join(", ")}.`;
    }
    if (phase.name === "Ouverture") {
      const devIssues = slice.filter((r) => r.tags.some((t) => t.kind === "con")).length;
      if (devIssues > 0) text += ` ${devIssues} coup${devIssues > 1 ? "s ont" : " a"} retardé le développement des pièces.`;
    }

    const block = document.createElement("div");
    block.className = "phase-block";
    block.innerHTML = `<h4>${phase.name}</h4><p>${text}</p>`;
    els.results.appendChild(block);
  }
}

function findEndgameStart(plies) {
  // Endgame heuristic: both queens off the board, or total non-king material <= 14 points.
  for (let i = 0; i < plies.length; i++) {
    const fen = plies[i].after;
    const boardPart = fen.split(" ")[0];
    let material = 0;
    let queens = 0;
    for (const ch of boardPart) {
      const lower = ch.toLowerCase();
      if (PIECE_VALUE[lower] !== undefined && lower !== "k") material += PIECE_VALUE[lower];
      if (lower === "q") queens++;
    }
    if (queens === 0 || material <= 14) return i;
  }
  return plies.length;
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

function renderErrorCoach(reports) {
  const mistakes = reports.filter((r) => r.classification.key === "mistake" || r.classification.key === "blunder");

  const wrap = document.createElement("div");
  wrap.className = "phase-block coach-error-block";
  const title = document.createElement("h4");
  title.textContent = "Correction guidée";
  wrap.appendChild(title);

  if (mistakes.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Aucune erreur ni gaffe détectée dans cette partie — rien à corriger ici !";
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
    const bestSan = bestMoveSan(m.fenBefore, m.bestMoveUci);

    body.innerHTML = `
      <div class="coach-error-counter">Erreur ${index + 1} / ${mistakes.length}</div>
      <div class="coach-error-move">
        <span class="mv-symbol sym-${m.classification.key}">${m.classification.symbol}</span>
        ${numLabel} <span class="mv-san">${m.san}</span> — ${sideLabel}
      </div>
      <p class="coach-error-explain">${m.explanation}</p>
      ${bestSan ? `<p class="coach-error-best">Coup suggéré à la place : <span class="best-move">${bestSan}</span></p>` : ""}
      <div class="coach-error-actions">
        <button class="btn-ghost" id="errPrevBtn" ${index === 0 ? "disabled" : ""}>◀ Précédente</button>
        ${isVoiceSupported() ? '<button class="btn-ghost" id="errSpeakBtn">🔊 Écouter</button>' : ""}
        <button class="btn-primary" id="errResumeBtn">↩ Reprendre à partir d'ici</button>
        <button class="btn-ghost" id="errIgnoreBtn">${index === mistakes.length - 1 ? "Terminer" : "Ignorer → Suivante ▶"}</button>
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
        const text = `Erreur ${index + 1} sur ${mistakes.length}. Coup ${m.moveNumber}, ${sideLabel}, ${m.san}. ${m.explanation}` +
          (bestSan ? ` Le coup suggéré à la place était ${bestSan}.` : "");
        speakOne(text);
      };
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

  const cards = document.createElement("div");
  cards.className = "elo-cards";

  for (const s of sides) {
    const moves = reports.filter((r) => r.color === s);
    if (moves.length === 0) continue;
    const acpl = Math.round(moves.reduce((sum, r) => sum + r.cpLoss, 0) / moves.length);
    const elo = acplToElo(acpl);
    const card = document.createElement("div");
    card.className = "elo-card";
    card.innerHTML = `
      <span class="elo-side">${s === "w" ? "Blancs" : "Noirs"}</span>
      <span class="elo-value">≈ ${elo}</span>
      <span class="elo-acpl">perte moyenne : ${acpl} cp / coup</span>
    `;
    cards.appendChild(card);
  }

  const disclaimer = document.createElement("div");
  disclaimer.className = "elo-disclaimer";
  disclaimer.textContent = "Estimation informelle basée uniquement sur la perte de centipions moyenne face au moteur dans cette partie. Ce n'est pas un classement officiel : une seule partie ne suffit pas à mesurer un niveau de façon fiable, le résultat varie selon l'adversaire, le format de jeu et la phase de partie.";

  const wrap = document.createElement("div");
  wrap.className = "phase-block";
  const title = document.createElement("h4");
  title.textContent = "Estimation de niveau (Elo)";
  wrap.appendChild(title);
  wrap.appendChild(cards);
  wrap.appendChild(disclaimer);
  els.results.appendChild(wrap);
}

// --- Single-move "help" explanation, used by the Analyse tab's Aide button ---

export function pieceNameFr(letter) {
  return { p: "pion", n: "Cavalier", b: "Fou", r: "Tour", q: "Dame", k: "Roi" }[letter] || letter;
}
