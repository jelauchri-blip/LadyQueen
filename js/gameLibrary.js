// Bibliothèque de parties sauvegardées (localStorage). Chaque entrée stocke le PGN
// complet ainsi que quelques métadonnées d'affichage.

const KEY = "echiquier_library";

export function listGames() {
  let games = [];
  try { games = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { games = []; }
  return games.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame({ pgn, label, moveCount }) {
  const games = listGames();
  const entry = {
    id: "g" + Date.now() + Math.floor(Math.random() * 1000),
    savedAt: Date.now(),
    label: label || defaultLabel(),
    pgn,
    moveCount: moveCount || 0,
  };
  games.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(games));
  return entry;
}

export function deleteGame(id) {
  const games = listGames().filter((g) => g.id !== id);
  localStorage.setItem(KEY, JSON.stringify(games));
}

export function getGame(id) {
  return listGames().find((g) => g.id === id) || null;
}

function defaultLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Partie du ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}
