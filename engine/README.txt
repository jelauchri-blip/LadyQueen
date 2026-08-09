Ce dossier contient une copie non modifiée du moteur d'échecs Stockfish
(build "18 lite single-thread" du paquet npm officiel "stockfish"),
incluse directement dans l'application pour éviter toute dépendance
à un serveur externe (CDN).

Stockfish est distribué sous licence GPL-3.0 (voir LICENSE.txt).
Code source officiel : https://github.com/official-stockfish/Stockfish
Paquet npm utilisé : https://www.npmjs.com/package/stockfish

Ces fichiers ne sont jamais modifiés — ils sont appelés par l'application
comme un processus séparé (Web Worker communiquant via le protocole UCI),
ce qui n'affecte pas la licence du reste de l'application.
