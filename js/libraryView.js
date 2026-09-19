import { listGames, deleteGame } from "./gameLibrary.js";
import { exportData, importData, importGamesOnly, exportGamesText, importGamesText } from "./dataBackup.js";

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

  els.addGamesBtn = document.getElementById("addGamesBtn");
  els.addGamesInput = document.getElementById("addGamesInput");
  els.addGamesBtn.addEventListener("click", () => els.addGamesInput.click());
  els.addGamesInput.addEventListener("change", async () => {
    const file = els.addGamesInput.files[0];
    if (!file) return;
    try {
      const { added, skipped } = await importGamesOnly(file);
      els.backupStatus.textContent = added
        ? `✓ ${added} partie(s) ajoutée(s)${skipped ? ` (${skipped} déjà présente(s))` : ""}.`
        : skipped ? "Ces parties sont déjà dans ta bibliothèque." : "Aucune partie trouvée dans ce fichier.";
      render();
    } catch (e) {
      els.backupStatus.textContent = "✗ Fichier de sauvegarde invalide.";
    }
    els.addGamesInput.value = "";
  });

  function reportAdded({ added, skipped }) {
    els.backupStatus.textContent = added
      ? `✓ ${added} partie(s) ajoutée(s)${skipped ? ` (${skipped} déjà présente(s))` : ""}.`
      : skipped ? "Ces parties sont déjà dans ta bibliothèque." : "Aucune partie trouvée dans ce texte.";
  }

  // Copy / paste route: all games as one piece of text.
  const pasteBox = document.getElementById("pasteGamesBox");
  const pasteArea = document.getElementById("pasteGamesArea");
  document.getElementById("copyGamesBtn").addEventListener("click", async () => {
    const text = exportGamesText();
    if (!text) { els.backupStatus.textContent = "Aucune partie à copier : la bibliothèque est vide."; return; }
    try {
      await navigator.clipboard.writeText(text);
      els.backupStatus.textContent = "✓ Parties copiées. Colle-les maintenant dans un message.";
    } catch (e) {
      // Clipboard refused: show the text ready to be copied by hand.
      pasteBox.hidden = false;
      pasteArea.value = text;
      pasteArea.focus();
      pasteArea.select();
      els.backupStatus.textContent = "Copie le texte ci-dessous (appui long → Tout sélectionner → Copier).";
    }
  });
  document.getElementById("pasteGamesBtn").addEventListener("click", () => {
    pasteBox.hidden = !pasteBox.hidden;
    if (!pasteBox.hidden) pasteArea.focus();
  });
  document.getElementById("pasteGamesAddBtn").addEventListener("click", () => {
    try {
      reportAdded(importGamesText(pasteArea.value));
      pasteArea.value = "";
      render();
    } catch (e) {
      els.backupStatus.textContent = "✗ Texte non reconnu : colle le message copié depuis « Copier mes parties ».";
    }
  });

  // "Tout restaurer" replaces everything on this device: ask first.
  els.importBtn.addEventListener("click", () => {
    if (confirm("Tout restaurer remplace TOUTES les données de cet appareil (parties, leçons, puzzles, préférences) par celles du fichier. Continuer ?")) els.importInput.click();
  });
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
