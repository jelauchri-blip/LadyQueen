// Exporte / importe toutes les données locales de l'application (localStorage)
// dans un simple fichier JSON téléchargeable, pour permettre à l'utilisateur
// de changer d'appareil ou de navigateur sans tout perdre.

const KEYS = [
  "echiquier_lessons_done",
  "echiquier_puzzles_solved",
  "echiquier_board_theme",
  "echiquier_piece_style",
  "echiquier_engine_depth",
  "echiquier_library",
  "echiquier_sound_enabled",
  "echiquier_layout_sizes",
  "echiquier_layout_locked",
];

export function exportData() {
  const data = {};
  for (const key of KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) data[key] = val;
  }
  const payload = {
    app: "Échiquier — Académie",
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  a.href = url;
  a.download = `echiquier-academie-sauvegarde-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Adds the library games found in a backup file to this device's library,
// leaving everything else (progress, preferences, layout) and the games
// already here untouched. A game already present (same id, or same moves) is
// skipped, so importing the same file twice adds nothing.
// Resolves to { added, skipped }.
export function importGamesOnly(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const data = payload.data || payload;
        const incoming = typeof data.echiquier_library === "string" ? JSON.parse(data.echiquier_library) : [];
        if (!Array.isArray(incoming)) throw new Error("bibliothèque invalide");
        let current = [];
        try { current = JSON.parse(localStorage.getItem("echiquier_library") || "[]"); } catch (e) { current = []; }
        const ids = new Set(current.map((g) => g.id));
        const pgns = new Set(current.map((g) => (g.pgn || "").trim()));
        let added = 0, skipped = 0;
        for (const g of incoming) {
          if (!g || typeof g.pgn !== "string" || !g.pgn.trim()) continue;
          if (ids.has(g.id) || pgns.has(g.pgn.trim())) { skipped++; continue; }
          current.push(g);
          ids.add(g.id);
          pgns.add(g.pgn.trim());
          added++;
        }
        if (added) localStorage.setItem("echiquier_library", JSON.stringify(current));
        resolve({ added, skipped });
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Reads a File (from an <input type="file">) and restores its contents into
// localStorage. Returns a Promise resolving to the number of keys restored.
export function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const data = payload.data || payload; // tolerate a raw key/value file too
        let count = 0;
        for (const key of KEYS) {
          if (data[key] !== undefined) {
            localStorage.setItem(key, data[key]);
            count++;
          }
        }
        resolve(count);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
