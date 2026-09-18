// Notation française des coups (affichage et voix uniquement : le PGN gardé en
// mémoire, importé ou enregistré reste en notation standard anglaise).

const PIECE_FR = { K: "R", Q: "D", R: "T", B: "F", N: "C" };
const PIECE_NAME = { K: "Roi", Q: "Dame", R: "Tour", B: "Fou", N: "Cavalier" };

// "Nbd7" -> "Cbd7", "Qxf7+" -> "Dxf7+", "e8=Q" -> "e8=D"; castling and pawn
// moves are unchanged.
export function sanFr(san) {
  if (!san) return san;
  let out = san;
  if (PIECE_FR[out[0]]) out = PIECE_FR[out[0]] + out.slice(1);
  return out.replace(/=([QRBN])/, (_, p) => "=" + PIECE_FR[p]);
}

// Same move as words, for the voice: "Nxf7+" -> "Cavalier prend en f7, échec".
export function sanSpoken(san) {
  if (!san) return san;
  if (san.startsWith("O-O-O")) return "grand roque" + suffixSpoken(san);
  if (san.startsWith("O-O")) return "petit roque" + suffixSpoken(san);
  let rest = san.replace(/[+#]/g, "");
  let piece = "";
  if (PIECE_NAME[rest[0]]) { piece = PIECE_NAME[rest[0]] + " "; rest = rest.slice(1); }
  let promo = "";
  const m = rest.match(/=([QRBN])/);
  if (m) { promo = ", promotion en " + PIECE_NAME[m[1]].toLowerCase(); rest = rest.replace(/=[QRBN]/, ""); }
  const capture = rest.includes("x");
  rest = rest.replace("x", "");
  const dest = rest.slice(-2);
  const from = rest.slice(0, -2);
  return `${piece}${from ? from + " " : ""}${capture ? "prend en " : "en "}${dest}${promo}${suffixSpoken(san)}`;
}

function suffixSpoken(san) {
  if (san.endsWith("#")) return ", échec et mat";
  if (san.endsWith("+")) return ", échec";
  return "";
}
