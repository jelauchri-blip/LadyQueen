import { Chess } from "./chess.js";
import { createBoard } from "./board.js";

// Pièges d'ouverture. Deux modes sur le même plateau :
//   - "demo"  : on parcourt la ligne coup par coup, avec le commentaire de chaque coup
//   - "actif" : on joue soi-même les coups de son camp, l'appli répond pour l'autre
// Les données viennent de data/traps.json, dont chaque coup porte déjà son SAN,
// ses cases de départ et d'arrivée, et son commentaire.

let ALL_TRAPS = [];
let current = null;      // le piège en cours
let ply = 0;             // combien de demi-coups sont joués sur le plateau
let mode = "demo";
let board = null;
let chess = null;
let failedAt = -1;       // en mode actif : index du coup raté, pour l'afficher en rouge

const els = {};

export async function initTrapsView() {
  els.mount = document.getElementById("trapBoardMount");
  els.list = document.getElementById("trapList");
  els.title = document.getElementById("trapTitle");
  els.summary = document.getElementById("trapSummary");
  els.note = document.getElementById("trapNote");
  els.lesson = document.getElementById("trapLesson");
  els.movelist = document.getElementById("trapMoves");
  els.modeDemo = document.getElementById("trapModeDemo");
  els.modePlay = document.getElementById("trapModePlay");
  els.first = document.getElementById("trapFirstBtn");
  els.prev = document.getElementById("trapPrevBtn");
  els.next = document.getElementById("trapNextBtn");
  els.last = document.getElementById("trapLastBtn");
  els.restart = document.getElementById("trapRestartBtn");
  els.nav = document.getElementById("trapNav");

  if (ALL_TRAPS.length === 0) {
    try {
      const res = await fetch("data/traps.json");
      ALL_TRAPS = await res.json();
    } catch (e) {
      ALL_TRAPS = [];
      els.title.textContent = "Pièges indisponibles";
      els.summary.textContent = "Le fichier des pièges n'a pas pu être chargé.";
      return;
    }
  }

  // Le tri vit ici plutôt que dans le fichier : l'ordre affiché ne dépend
  // alors plus de l'ordre d'écriture de data/traps.json, qu'un ajout futur
  // pourrait casser sans qu'on s'en aperçoive.
  ALL_TRAPS.sort((a, b) => a.elo - b.elo || a.name.localeCompare(b.name, "fr"));
  renderList();
  const eyebrow = els.list.parentElement.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = ALL_TRAPS.length + " pièges d'ouverture";
  els.modeDemo.onclick = () => setMode("demo");
  els.modePlay.onclick = () => setMode("actif");
  els.first.onclick = () => goTo(0);
  els.prev.onclick = () => goTo(ply - 1);
  els.next.onclick = () => goTo(ply + 1);
  els.last.onclick = () => goTo(current ? current.moves.length : 0);
  els.restart.onclick = () => selectTrap(current.id);

  selectTrap(ALL_TRAPS[0].id);
}

function renderList() {
  els.list.innerHTML = "";
  for (const t of ALL_TRAPS) {
    const btn = document.createElement("button");
    btn.className = "trap-item";
    btn.dataset.trap = t.id;
    btn.innerHTML =
      `<span class="trap-item-elo">${t.elo}</span>` +
      `<span class="trap-item-name">${t.name}</span>`;
    btn.onclick = () => selectTrap(t.id);
    els.list.appendChild(btn);
  }
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  els.modeDemo.classList.toggle("active", m === "demo");
  els.modePlay.classList.toggle("active", m === "actif");
  if (current) selectTrap(current.id);
}

function selectTrap(id) {
  current = ALL_TRAPS.find((t) => t.id === id) || ALL_TRAPS[0];
  ply = 0;
  failedAt = -1;
  chess = new Chess();

  document.querySelectorAll(".trap-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.trap === current.id)
  );

  els.title.textContent = current.name;
  // Le camp n'est plus dans la liste : il est rappelé ici.
  els.summary.textContent =
    (current.side === "w" ? "Côté Blancs" : "Côté Noirs") + " · " + current.summary;
  els.lesson.textContent = current.lesson;
  els.lesson.hidden = true;

  // Le plateau est toujours vu du côté qui tend le piège.
  const orientation = current.side === "w" ? "white" : "black";

  if (board) els.mount.innerHTML = "";
  board = createBoard(els.mount, chess, {
    orientation,
    interactive: mode === "actif",
    onUserMove: onUserMove,
  });

  els.nav.hidden = mode !== "demo";
  els.restart.hidden = mode !== "actif";

  if (mode === "demo") {
    setNote(`Avance coup par coup avec les flèches. ${current.moves.length} demi-coups.`);
  } else {
    setNote("À toi de jouer. Trouve les coups du piège.");
    // Si le piège se joue côté Noirs, les Blancs commencent : l'appli joue pour eux.
    if (current.side === "b") setTimeout(() => playOpponentMove(), 400);
  }
  renderMoves();
  updateNavButtons();
}

function setNote(text, kind) {
  els.note.textContent = text;
  els.note.className = "trap-note" + (kind ? " trap-note-" + kind : "");
}

// ── Mode démonstration ──────────────────────────────────────────────────────

function goTo(target) {
  if (!current || mode !== "demo") return;
  const max = current.moves.length;
  target = Math.max(0, Math.min(max, target));
  if (target === ply) return;

  const stepForward = target === ply + 1;

  // Rejoue depuis le début : plus simple et plus sûr qu'une pile d'annulations,
  // et imperceptible sur des lignes de vingt coups.
  chess = new Chess();
  for (let i = 0; i < target; i++) chess.move(current.moves[i].san);
  ply = target;

  const last = ply > 0 ? current.moves[ply - 1] : null;
  board.setChess(chess, last ? { from: last.from, to: last.to } : null, { animate: stepForward });

  if (last) {
    setNote(last.note, last.annot.includes("?") ? "bad" : last.annot.includes("!") ? "good" : null);
  } else {
    setNote(`Avance coup par coup avec les flèches. ${current.moves.length} demi-coups.`);
  }
  els.lesson.hidden = ply < current.moves.length;
  renderMoves();
  updateNavButtons();
}

function updateNavButtons() {
  if (mode !== "demo" || !current) return;
  const atStart = ply === 0;
  const atEnd = ply === current.moves.length;
  els.first.disabled = atStart;
  els.prev.disabled = atStart;
  els.next.disabled = atEnd;
  els.last.disabled = atEnd;
}

// ── Mode actif ──────────────────────────────────────────────────────────────

function onUserMove(result) {
  if (mode !== "actif" || !current) return;
  const expected = current.moves[ply];

  if (!expected || result.san !== expected.san) {
    // Mauvais coup : on annule et on laisse réessayer.
    chess.undo();
    board.setChess(chess, null, { animate: false });
    failedAt = ply;
    setNote("Ce n'est pas le coup du piège. Réessaie.", "bad");
    renderMoves();
    return;
  }

  failedAt = -1;
  ply++;
  board.setLastMove({ from: expected.from, to: expected.to });
  setNote(expected.note, expected.annot.includes("!") ? "good" : null);
  renderMoves();

  if (ply >= current.moves.length) return finishTrap();
  setTimeout(() => playOpponentMove(), 500);
}

function playOpponentMove() {
  if (mode !== "actif" || !current || ply >= current.moves.length) return;
  const mv = current.moves[ply];
  chess.move(mv.san);
  ply++;
  board.setChess(chess, { from: mv.from, to: mv.to }, { animate: true });
  setNote(mv.note, mv.annot.includes("?") ? "bad" : null);
  renderMoves();
  if (ply >= current.moves.length) finishTrap();
}

function finishTrap() {
  board.setInteractive(false);
  els.lesson.hidden = false;
  setNote(current.endsInMate ? "Mat. Le piège a fonctionné." : "Le piège est en place.", "good");
}

// ── Liste des coups ─────────────────────────────────────────────────────────

function renderMoves() {
  if (!current) return;
  els.movelist.innerHTML = "";
  for (let i = 0; i < current.moves.length; i++) {
    const m = current.moves[i];
    if (i % 2 === 0) {
      const num = document.createElement("span");
      num.className = "trap-move-num";
      num.textContent = (i / 2 + 1) + ".";
      els.movelist.appendChild(num);
    }
    const el = document.createElement("span");
    el.className = "trap-move";
    // En mode actif, les coups pas encore joués restent masqués : les révéler
    // reviendrait à donner la solution avant que le joueur ne cherche.
    const hidden = mode === "actif" && i >= ply;
    el.textContent = hidden ? "…" : m.san + m.annot;
    if (i < ply) el.classList.add("played");
    if (i === ply - 1) el.classList.add("current");
    if (i === failedAt) el.classList.add("failed");
    if (!hidden && mode === "demo") el.onclick = () => goTo(i + 1);
    els.movelist.appendChild(el);
  }
}
