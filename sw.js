// Le fetch handler ci-dessous vérifie toujours le réseau en premier, donc
// ce numéro n'a plus besoin d'être incrémenté à chaque publication — il ne
// sert qu'à purger l'ancien cache une fois, au prochain déploiement.
const CACHE_NAME = "echiquier-academie-v31";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/board.js",
  "./js/chess.js",
  "./js/lessons.js",
  "./js/puzzles.js",
  "./js/analysis.js",
  "./js/gameAnalysis.js",
  "./js/positionEditor.js",
  "./data/puzzles.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/pieces.svg",
  "./icons/og-image.png",
  "./icons/cburnett-classic.svg",
  "./icons/cburnett-wood.svg",
  "./js/pieceStyle.js",
  "./js/voiceCoach.js",
  "./js/gameLibrary.js",
  "./js/libraryView.js",
  "./js/engineSettings.js",
  "./js/chessClock.js",
  "./js/dataBackup.js",
  "./js/sounds.js",
  "./js/playerNames.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests (fonts, Stockfish CDN, Lichess API):
  // let the network handle them directly so the engine and live puzzles keep working.
  if (url.origin !== self.location.origin) return;

  // Network-first, cache as fallback: whenever online, this always fetches
  // the latest published version (no more "close and reopen still shows the
  // old version until a manual refresh"). The cache only kicks in offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
