import { Chess } from "./chess.js";
import { createBoard } from "./board.js";

export const LESSONS = [
  {
    id: "plateau",
    title: "Le plateau et la notation",
    fen: "7k/8/8/8/8/8/8/K7 w - - 0 1",
    text: [
      "L'échiquier compte 64 cases, 8 colonnes nommées de <b>a à h</b> (de gauche à droite pour les Blancs) et 8 rangées numérotées de <b>1 à 8</b>. Chaque case a donc un nom unique, comme e4 ou g7.",
      "Chaque camp doit avoir une case blanche dans le coin droit le plus proche de lui : « case blanche à droite ».",
      "Dans ce cours, touchez une case pour voir apparaître les coups légaux d'une pièce quand il y en a une dessus — c'est comme cela que vous jouerez partout dans l'application.",
    ],
  },
  {
    id: "pion",
    title: "Le Pion",
    fen: "k7/8/8/8/8/4p3/PPPPPPPP/7K w - - 0 1",
    text: [
      "Le pion avance <b>tout droit</b>, d'une case, et de <b>deux cases</b> au tout premier coup de ce pion précis.",
      "Il <b>capture en diagonale</b>, jamais tout droit. Touchez le pion blanc en d2 : il peut avancer en d3/d4, mais aussi capturer le pion noir en e3 uniquement parce qu'il s'y trouve en diagonale.",
      "Arrivé sur la dernière rangée (8 pour les Blancs, 1 pour les Noirs), le pion est <b>promu</b> : il se transforme en Dame, Tour, Fou ou Cavalier au choix du joueur.",
    ],
  },
  {
    id: "tour",
    title: "La Tour",
    fen: "7k/8/8/3p4/8/8/8/3R3K w - - 0 1",
    text: [
      "La Tour se déplace en <b>ligne droite</b>, horizontalement ou verticalement, sur autant de cases libres qu'elle veut.",
      "Elle ne peut pas sauter par-dessus une pièce. Touchez la Tour blanche en d1 : elle contrôle toute la colonne d et la première rangée, jusqu'à la pièce noire qu'elle peut capturer.",
      "La Tour est une pièce majeure, particulièrement puissante en fin de partie sur les colonnes et rangées ouvertes.",
    ],
  },
  {
    id: "cavalier",
    title: "Le Cavalier",
    fen: "k7/8/2p1p3/1p3p2/3N4/1p3p2/2p1p3/K7 w - - 0 1",
    text: [
      "Le Cavalier se déplace en <b>« L »</b> : deux cases dans une direction, puis une case perpendiculaire.",
      "C'est la seule pièce qui <b>saute par-dessus les autres</b> pièces. Touchez le Cavalier en d4 : il peut atterrir sur 8 cases différentes, ici toutes occupées par des pièces noires qu'il peut capturer.",
      "Le Cavalier est plus fort au centre de l'échiquier, où il contrôle davantage de cases, et plus faible sur le bord.",
    ],
  },
  {
    id: "fou",
    title: "Le Fou",
    fen: "7k/6p1/8/8/3B4/8/1p6/7K w - - 0 1",
    text: [
      "Le Fou se déplace en <b>diagonale</b>, sur autant de cases libres qu'il veut, sans jamais changer de couleur de case.",
      "Chaque joueur possède un Fou de cases blanches et un Fou de cases noires : ils ne se rencontrent jamais sur la même diagonale.",
      "Touchez le Fou en d4 pour voir ses deux diagonales, jusqu'aux pions noirs qu'il peut capturer.",
    ],
  },
  {
    id: "dame",
    title: "La Dame",
    fen: "7k/4p3/8/8/3Q4/8/1p6/7K w - - 0 1",
    text: [
      "La Dame combine les pouvoirs de la Tour et du Fou : elle se déplace en ligne droite <b>ou</b> en diagonale, sur autant de cases libres qu'elle veut.",
      "C'est la pièce la plus puissante du jeu (valeur approximative : 9 points, contre 5 pour la Tour, 3 pour le Fou et le Cavalier, 1 pour le pion).",
      "Touchez la Dame en d4 pour visualiser l'étendue de son contrôle.",
    ],
  },
  {
    id: "roi",
    title: "Le Roi",
    fen: "k7/8/8/3p4/3K4/8/8/8 w - - 0 1",
    text: [
      "Le Roi se déplace d'<b>une seule case</b>, dans n'importe quelle direction (horizontale, verticale ou diagonale).",
      "Il ne peut jamais se déplacer sur une case attaquée par une pièce adverse : ce serait un coup illégal.",
      "Le but du jeu est de mettre le Roi adverse <b>échec et mat</b> : l'attaquer sans qu'il puisse s'échapper, bloquer l'attaque ou capturer l'attaquant.",
    ],
  },
  {
    id: "echec-mat",
    title: "L'échec et le mat",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    text: [
      "Un Roi est <b>en échec</b> quand il est attaqué par une pièce adverse. Le joueur doit immédiatement parer l'échec : déplacer le Roi, bloquer l'attaque avec une autre pièce, ou capturer la pièce attaquante.",
      "S'il est impossible de parer l'échec, c'est <b>échec et mat</b> : la partie est perdue pour le camp maté.",
      "Essayez : touchez la Tour en a1 et jouez Ra8 pour livrer échec et mat au Roi noir, coincé sur la dernière rangée par ses propres pions.",
    ],
  },
  {
    id: "roque",
    title: "Le roque",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    text: [
      "Le roque est le seul coup qui déplace <b>deux pièces à la fois</b> : le Roi se déplace de deux cases vers une Tour, qui saute par-dessus lui.",
      "Conditions : ni le Roi ni la Tour concernée n'ont bougé, aucune case entre eux n'est occupée, et le Roi n'est ni en échec, ni ne traverse, ni n'arrive sur une case attaquée.",
      "Touchez le Roi blanc en e1 : vous verrez g1 (petit roque) et c1 (grand roque) proposés parmi ses coups légaux.",
    ],
  },
  {
    id: "en-passant",
    title: "La prise « en passant »",
    fen: "7k/8/8/3pP3/8/8/8/7K w - d6 0 1",
    text: [
      "Quand un pion avance de deux cases et se retrouve <b>à côté</b> d'un pion adverse, ce dernier peut le capturer « en passant », comme s'il n'avait avancé que d'une case — mais uniquement au coup suivant immédiat.",
      "Touchez le pion blanc en e5 : il peut capturer le pion noir en d5 en se posant sur d6, alors même que d5 n'est pas sur sa diagonale d'arrivée directe.",
      "C'est la règle la plus souvent oubliée des débutants : elle existe pour empêcher un pion d'« esquiver » un pion adverse en avançant de deux cases.",
    ],
  },
  {
    id: "promotion",
    title: "La promotion",
    fen: "8/4P3/8/8/8/8/8/4k2K w - - 0 1",
    text: [
      "Quand un pion atteint la dernière rangée, il doit immédiatement se transformer en Dame, Tour, Fou ou Cavalier de sa couleur (jamais en Roi, ni rester pion).",
      "On choisit presque toujours la Dame (« promotion en Dame »), la pièce la plus forte — sauf cas rares où une autre pièce évite un pat ou crée un mat immédiat (« sous-promotion »).",
      "Touchez le pion en e7 et jouez e8 : dans cette application, la promotion se fait automatiquement en Dame pour simplifier.",
    ],
  },
  {
    id: "pat-nulles",
    title: "Le pat et les parties nulles",
    fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
    text: [
      "Le <b>pat</b> survient quand un joueur n'est pas en échec mais n'a <b>aucun coup légal</b> disponible : la partie est immédiatement nulle, même si l'un des deux camps a beaucoup plus de matériel.",
      "Autres cas de nullité : accord mutuel, répétition de position trois fois, règle des 50 coups sans capture ni poussée de pion, matériel insuffisant pour mater (ex. Roi seul contre Roi et Fou).",
      "Attention en fin de partie gagnante : un mat mal calculé peut accidentellement provoquer un pat et priver de la victoire !",
    ],
  },
];

export function initLessonsView(navEl, contentEl) {
  const progress = loadProgress();
  let current = 0;

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem("echiquier_lessons_done") || "[]");
    } catch { return []; }
  }
  function saveProgress(arr) {
    localStorage.setItem("echiquier_lessons_done", JSON.stringify(arr));
  }
  function markDone(id) {
    const p = loadProgress();
    if (!p.includes(id)) { p.push(id); saveProgress(p); }
    renderNav();
    updateHomeStats();
  }

  function renderNav() {
    const p = loadProgress();
    navEl.innerHTML = "";
    LESSONS.forEach((lesson, i) => {
      const btn = document.createElement("button");
      btn.className = "lesson-nav-item" + (i === current ? " active" : "") + (p.includes(lesson.id) ? " done" : "");
      btn.innerHTML = `<span class="chk"></span> ${i + 1}. ${lesson.title}`;
      btn.addEventListener("click", () => { current = i; render(); });
      navEl.appendChild(btn);
    });
  }

  function render() {
    const lesson = LESSONS[current];
    renderNav();
    contentEl.innerHTML = `
      <h2>${current + 1}. ${lesson.title}</h2>
      <div class="lesson-body">
        <div class="lesson-text">${lesson.text.map(p => `<p>${p}</p>`).join("")}</div>
        <div id="lessonBoardMount"></div>
      </div>
      <div class="lesson-footer">
        <button class="btn-ghost" id="prevLessonBtn" ${current === 0 ? "disabled" : ""}>← Précédent</button>
        <button class="btn-primary" id="doneLessonBtn">Leçon terminée ✓</button>
        <button class="btn-ghost" id="nextLessonBtn" ${current === LESSONS.length - 1 ? "disabled" : ""}>Suivant →</button>
      </div>
    `;
    const chess = new Chess(lesson.fen);
    createBoard(document.getElementById("lessonBoardMount"), chess, { interactive: true });

    document.getElementById("prevLessonBtn").onclick = () => { if (current > 0) { current--; render(); } };
    document.getElementById("nextLessonBtn").onclick = () => { if (current < LESSONS.length - 1) { current++; render(); } };
    document.getElementById("doneLessonBtn").onclick = () => markDone(lesson.id);
  }

  render();
  return { render, goTo(i) { current = i; render(); } };
}

export function updateHomeStats() {
  const doneEl = document.getElementById("statLessonsDone");
  if (!doneEl) return;
  let p = [];
  try { p = JSON.parse(localStorage.getItem("echiquier_lessons_done") || "[]"); } catch {}
  doneEl.textContent = p.length;
}
