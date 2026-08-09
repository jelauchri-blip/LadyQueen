import { listGames, deleteGame } from "./gameLibrary.js";
import { exportData, importData } from "./dataBackup.js";

let els = {};
let onLoadGame = null;

export function initLibraryView({ loadPgnIntoAnalysis }) {
  onLoadGame = loadPgnIntoAnalysis;
  els.list = document.getElementById("libraryList");
  els.exportBtn = document.getElementById("exportDataBtn");
  els.importBtn = document.getElementById("importDataBtn");
  els.importInput = document.getElementById("importDataInput");
  els.backupStatus = document.getElementById("backupStatus");

  els.exportBtn.addEventListener("click", () => {
    exportData();
    els.backupStatus.textContent = "✓ Fichier de sauvegarde téléchargé.";
  });

  els.importBtn.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", async () => {
    const file = els.importInput.files[0];
    if (!file) return;
    try {
      const count = await importData(file);
      els.backupStatus.textContent = `✓ ${count} élément(s) restauré(s). Rechargement…`;
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      els.backupStatus.textContent = "✗ Fichier de sauvegarde invalide.";
    }
    els.importInput.value = "";
  });

  render();
}

export function refreshLibraryView() {
  if (els.list) render();
}

function render() {
  const games = listGames();
  if (games.length === 0) {
    els.list.innerHTML = `<div class="phase-block"><p>Aucune partie enregistrée pour l'instant. Dans l'onglet Analyse, joue ou charge une partie puis clique sur « 💾 Enregistrer » pour la retrouver ici.</p></div>`;
    return;
  }
  els.list.innerHTML = "";
  for (const g of games) {
    const card = document.createElement("div");
    card.className = "library-card";
    const date = new Date(g.savedAt);
    const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    card.innerHTML = `
      <div class="library-card-info">
        <span class="library-card-label">${g.label}</span>
        <span class="library-card-meta">${dateStr} · ${g.moveCount} coup${g.moveCount > 1 ? "s" : ""}</span>
      </div>
      <div class="library-card-actions">
        <button class="btn-primary lib-open-btn">Ouvrir et analyser →</button>
        <button class="btn-ghost lib-delete-btn" title="Supprimer">🗑</button>
      </div>
    `;
    card.querySelector(".lib-open-btn").addEventListener("click", () => {
      if (onLoadGame) onLoadGame(g.pgn);
    });
    card.querySelector(".lib-delete-btn").addEventListener("click", () => {
      if (confirm(`Supprimer « ${g.label} » ?`)) {
        deleteGame(g.id);
        render();
      }
    });
    els.list.appendChild(card);
  }
}
