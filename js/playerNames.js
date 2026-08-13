const PLAYER_KEY = "echiquier_player_name";
const BOT_KEY = "echiquier_bot_name";
const DEFAULT_PLAYER_NAME = "Jelau";
const DEFAULT_BOT_NAME = "Ruben";

export function getPlayerName() {
  return localStorage.getItem(PLAYER_KEY) || DEFAULT_PLAYER_NAME;
}

export function setPlayerName(name) {
  const trimmed = (name || "").trim();
  localStorage.setItem(PLAYER_KEY, trimmed || DEFAULT_PLAYER_NAME);
}

export function getBotName() {
  return localStorage.getItem(BOT_KEY) || DEFAULT_BOT_NAME;
}

export function setBotName(name) {
  const trimmed = (name || "").trim();
  localStorage.setItem(BOT_KEY, trimmed || DEFAULT_BOT_NAME);
}
