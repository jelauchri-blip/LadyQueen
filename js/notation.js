// Notation des coups par langue (affichage et voix uniquement : le PGN gardé en
// mémoire, importé ou enregistré reste en notation standard anglaise).

const LANG_DATA = {
  fr: {
    pieceLetter: { K: "R", Q: "D", R: "T", B: "F", N: "C" },
    pieceName: { K: "Roi", Q: "Dame", R: "Tour", B: "Fou", N: "Cavalier", P: "pion" },
    captureWord: "prend en",
    toWord: "en",
    promoSpoken: (piece) => `, promotion en ${piece.toLowerCase()}`,
    promoNote: (piece) => `promotion en ${piece}`,
    captureNote: "prise",
    enPassantNote: "prise en passant",
    checkmateWord: "échec et mat",
    checkWord: "échec",
    kingsideCastle: "Petit roque",
    queensideCastle: "Grand roque",
    kingsideCastleSpoken: "petit roque",
    queensideCastleSpoken: "grand roque",
  },
  en: {
    pieceLetter: { K: "K", Q: "Q", R: "R", B: "B", N: "N" },
    pieceName: { K: "King", Q: "Queen", R: "Rook", B: "Bishop", N: "Knight", P: "pawn" },
    captureWord: "captures on",
    toWord: "to",
    promoSpoken: (piece) => `, promotes to ${piece.toLowerCase()}`,
    promoNote: (piece) => `promotes to ${piece}`,
    captureNote: "capture",
    enPassantNote: "en passant",
    checkmateWord: "checkmate",
    checkWord: "check",
    kingsideCastle: "Kingside castling",
    queensideCastle: "Queenside castling",
    kingsideCastleSpoken: "kingside castling",
    queensideCastleSpoken: "queenside castling",
  },
  es: {
    pieceLetter: { K: "R", Q: "D", R: "T", B: "A", N: "C" },
    pieceName: { K: "Rey", Q: "Dama", R: "Torre", B: "Alfil", N: "Caballo", P: "peón" },
    captureWord: "captura en",
    toWord: "a",
    promoSpoken: (piece) => `, corona a ${piece.toLowerCase()}`,
    promoNote: (piece) => `corona a ${piece}`,
    captureNote: "captura",
    enPassantNote: "al paso",
    checkmateWord: "jaque mate",
    checkWord: "jaque",
    kingsideCastle: "Enroque corto",
    queensideCastle: "Enroque largo",
    kingsideCastleSpoken: "enroque corto",
    queensideCastleSpoken: "enroque largo",
  },
  de: {
    pieceLetter: { K: "K", Q: "D", R: "T", B: "L", N: "S" },
    pieceName: { K: "König", Q: "Dame", R: "Turm", B: "Läufer", N: "Springer", P: "Bauer" },
    captureWord: "schlägt auf",
    toWord: "auf",
    promoSpoken: (piece) => `, Umwandlung in ${piece.toLowerCase()}`,
    promoNote: (piece) => `Umwandlung in ${piece}`,
    captureNote: "Schlagzug",
    enPassantNote: "en passant",
    checkmateWord: "Schachmatt",
    checkWord: "Schach",
    kingsideCastle: "Kurze Rochade",
    queensideCastle: "Lange Rochade",
    kingsideCastleSpoken: "kurze Rochade",
    queensideCastleSpoken: "lange Rochade",
  },
  it: {
    pieceLetter: { K: "R", Q: "D", R: "T", B: "A", N: "C" },
    pieceName: { K: "Re", Q: "Donna", R: "Torre", B: "Alfiere", N: "Cavallo", P: "pedone" },
    captureWord: "cattura in",
    toWord: "in",
    promoSpoken: (piece) => `, promozione a ${piece.toLowerCase()}`,
    promoNote: (piece) => `promozione a ${piece}`,
    captureNote: "cattura",
    enPassantNote: "en passant",
    checkmateWord: "scacco matto",
    checkWord: "scacco",
    kingsideCastle: "Arrocco corto",
    queensideCastle: "Arrocco lungo",
    kingsideCastleSpoken: "arrocco corto",
    queensideCastleSpoken: "arrocco lungo",
  },
  pt: {
    pieceLetter: { K: "R", Q: "D", R: "T", B: "B", N: "C" },
    pieceName: { K: "Rei", Q: "Dama", R: "Torre", B: "Bispo", N: "Cavalo", P: "peão" },
    captureWord: "captura em",
    toWord: "em",
    promoSpoken: (piece) => `, promove a ${piece.toLowerCase()}`,
    promoNote: (piece) => `promove a ${piece}`,
    captureNote: "captura",
    enPassantNote: "en passant",
    checkmateWord: "xeque-mate",
    checkWord: "xeque",
    kingsideCastle: "Roque pequeno",
    queensideCastle: "Roque grande",
    kingsideCastleSpoken: "roque pequeno",
    queensideCastleSpoken: "roque grande",
  },
};

function data(lang) {
  return LANG_DATA[lang] || LANG_DATA.fr;
}

export function pieceName(letter, lang = "fr") {
  const d = data(lang);
  if (letter === "p" || letter === "P") return d.pieceName.P;
  const upper = letter.toUpperCase();
  return d.pieceName[upper] || letter;
}

// Single-letter piece abbreviation ("p" -> "P" (pawn), "n" -> "C" in French…),
// used for the beginner-friendly "F f8 → c5" move write-up.
export function pieceLetter(letter, lang = "fr") {
  const d = data(lang);
  if (letter === "p" || letter === "P") return d.pieceName.P[0].toUpperCase();
  const upper = letter.toUpperCase();
  return d.pieceLetter[upper] || letter;
}

// Locale decimal separator for "1,5 points" (fr/es/de/it/pt) vs "1.5 points" (en).
export function decimalSeparator(lang) {
  return lang === "en" ? "." : ",";
}

export function castleNote(lang, kingside) {
  const d = data(lang);
  return kingside ? d.kingsideCastle : d.queensideCastle;
}

export function captureNote(lang) { return data(lang).captureNote; }
export function enPassantNote(lang) { return data(lang).enPassantNote; }
export function promoNote(lang, pieceLetterCode) { return data(lang).promoNote(data(lang).pieceName[pieceLetterCode.toUpperCase()]); }
export function checkmateWord(lang) { return data(lang).checkmateWord; }
export function checkWord(lang) { return data(lang).checkWord; }
export function toWord(lang) { return data(lang).toWord; }

// "Nbd7" -> "Cbd7" (fr), unchanged for en, "Nbd7" -> "Cbd7" (es)…; castling
// and pawn moves are unchanged.
export function sanDisplay(san, lang = "fr") {
  if (!san) return san;
  const d = data(lang);
  let out = san;
  if (d.pieceLetter[out[0]]) out = d.pieceLetter[out[0]] + out.slice(1);
  return out.replace(/=([QRBN])/, (_, p) => "=" + d.pieceLetter[p]);
}

// Same move as words, for the voice: "Nxf7+" -> "Cavalier prend en f7, échec".
export function sanSpoken(san, lang = "fr") {
  if (!san) return san;
  const d = data(lang);
  if (san.startsWith("O-O-O")) return d.queensideCastleSpoken + suffixSpoken(san, lang);
  if (san.startsWith("O-O")) return d.kingsideCastleSpoken + suffixSpoken(san, lang);
  let rest = san.replace(/[+#]/g, "");
  let piece = "";
  if (d.pieceName[rest[0]]) { piece = d.pieceName[rest[0]] + " "; rest = rest.slice(1); }
  let promo = "";
  const m = rest.match(/=([QRBN])/);
  if (m) { promo = d.promoSpoken(d.pieceName[m[1]]); rest = rest.replace(/=[QRBN]/, ""); }
  const capture = rest.includes("x");
  rest = rest.replace("x", "");
  const dest = rest.slice(-2);
  const from = rest.slice(0, -2);
  return `${piece}${from ? from + " " : ""}${capture ? d.captureWord + " " : d.toWord + " "}${dest}${promo}${suffixSpoken(san, lang)}`;
}

function suffixSpoken(san, lang) {
  const d = data(lang);
  if (san.endsWith("#")) return ", " + d.checkmateWord;
  if (san.endsWith("+")) return ", " + d.checkWord;
  return "";
}
