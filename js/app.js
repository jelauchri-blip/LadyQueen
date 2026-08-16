import { Chess } from "./chess.js";
import { createBoard } from "./board.js";
import { initLessonsView } from "./lessons.js";
import { initPuzzlesView } from "./puzzles.js";
import { initAnalysisView, loadPgnString } from "./analysis.js";
import { getPieceStyle, setPieceStyle } from "./pieceStyle.js";
import { isSoundEnabled, setSoundEnabled } from "./sounds.js";
import { initLibraryView } from "./libraryView.js";
import { initLayoutResize } from "./layoutResize.js";

initLayoutResize();

const tabButtons = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".view");
const initialized = { regles: false, tactique: false, analyse: false, bibliotheque: false };

function showTab(name) {
  tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  views.forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  document.body.classList.toggle("wide-view", name === "analyse");
  document.getElementById("views").scrollTop = 0;

  if (name === "regles" && !initialized.regles) {
    initialized.regles = true;
    initLessonsView(document.getElementById("lessonNav"), document.getElementById("lessonContent"));
  }
  if (name === "tactique" && !initialized.tactique) {
    initialized.tactique = true;
    initPuzzlesView();
  }
  if (name === "bibliotheque" && !initialized.bibliotheque) {
    initialized.bibliotheque = true;
    initLibraryView({
      loadPgnIntoAnalysis: (pgn) => {
        loadPgnString(pgn);
        showTab("analyse");
      },
    });
  }
}

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

// The "Adversaire" panel lives in the sidebar and is visible on every tab
// (not just Analyse), so its controls (and the board it starts games on)
// need to be wired up immediately rather than lazily on first tab visit.
initAnalysisView();
initialized.analyse = true;

// "Créer une position" and "Position de départ" now live in the sidebar
// (visible on every tab), but the controls they open only make sense on
// the Analyse board — jump there first when used from elsewhere.
document.getElementById("openEditorBtn").addEventListener("click", () => {
  if (!document.getElementById("view-analyse").classList.contains("active")) showTab("analyse");
});
document.querySelector("#setupControls > summary").addEventListener("click", () => {
  if (!document.getElementById("view-analyse").classList.contains("active")) showTab("analyse");
});

// ---- Home board preview + "Jouer" CTA ----
// Purely cosmetic orientation for the idle preview board — the balanced
// (tracked) color pick happens once, inside the actual "Jouer" click.
const homeColor = Math.random() < 0.5 ? "w" : "b";
createBoard(document.getElementById("homeBoardMount"), new Chess(), {
  interactive: false,
  orientation: homeColor === "b" ? "black" : "white",
});

document.getElementById("homePlayBtn").addEventListener("click", () => {
  showTab("analyse");
  document.getElementById("startVsComputerBtn").click();
});

// ---- Sound toggle ----
const soundBtn = document.getElementById("soundToggleBtn");
function refreshSoundBtn() {
  soundBtn.textContent = isSoundEnabled() ? "🔊" : "🔇";
}
refreshSoundBtn();
soundBtn.addEventListener("click", () => {
  setSoundEnabled(!isSoundEnabled());
  refreshSoundBtn();
});

// ---- First-visit onboarding ----
const ONBOARDING_KEY = "echiquier_onboarding_seen";
if (!localStorage.getItem(ONBOARDING_KEY)) {
  const overlay = document.getElementById("onboardingOverlay");
  overlay.hidden = false;
  document.getElementById("onboardingCloseBtn").addEventListener("click", () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    overlay.hidden = true;
  });
}

// ---- Board theme picker ----
const THEME_KEY = "echiquier_board_theme";
function applyTheme(theme) {
  if (theme && theme !== "noyer") {
    document.documentElement.setAttribute("data-board-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-board-theme");
  }
  document.querySelectorAll(".theme-swatch-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === (theme || "noyer"));
  });
}
const savedTheme = localStorage.getItem(THEME_KEY) || "noyer";
applyTheme(savedTheme);

// ---- Board brightness slider ----
const BRIGHTNESS_KEY = "echiquier_board_brightness";
const brightnessSlider = document.getElementById("brightnessSlider");
const brightnessValue = document.getElementById("brightnessValue");
function applyBrightness(pct) {
  document.documentElement.style.setProperty("--board-brightness", pct / 100);
  brightnessValue.textContent = pct + "%";
}
const savedBrightness = parseInt(localStorage.getItem(BRIGHTNESS_KEY) || "100", 10);
brightnessSlider.value = savedBrightness;
applyBrightness(savedBrightness);
brightnessSlider.addEventListener("input", () => {
  const pct = parseInt(brightnessSlider.value, 10);
  applyBrightness(pct);
  localStorage.setItem(BRIGHTNESS_KEY, String(pct));
});

// ---- Board coordinate size & contrast sliders ----
const COORD_SIZE_KEY = "echiquier_coord_size";
const COORD_CONTRAST_KEY = "echiquier_coord_contrast";
const coordSizeSlider = document.getElementById("coordSizeSlider");
const coordSizeValue = document.getElementById("coordSizeValue");
const coordContrastSlider = document.getElementById("coordContrastSlider");
const coordContrastValue = document.getElementById("coordContrastValue");

function applyCoordSize(px) {
  document.documentElement.style.setProperty("--coord-size", px + "px");
  coordSizeValue.textContent = px + "px";
}
function applyCoordContrast(pct) {
  document.documentElement.style.setProperty("--coord-opacity", pct / 100);
  coordContrastValue.textContent = pct + "%";
}
const savedCoordSize = parseInt(localStorage.getItem(COORD_SIZE_KEY) || "9", 10);
coordSizeSlider.value = savedCoordSize;
applyCoordSize(savedCoordSize);
coordSizeSlider.addEventListener("input", () => {
  const px = parseInt(coordSizeSlider.value, 10);
  applyCoordSize(px);
  localStorage.setItem(COORD_SIZE_KEY, String(px));
});

const savedCoordContrast = parseInt(localStorage.getItem(COORD_CONTRAST_KEY) || "55", 10);
coordContrastSlider.value = savedCoordContrast;
applyCoordContrast(savedCoordContrast);
coordContrastSlider.addEventListener("input", () => {
  const pct = parseInt(coordContrastSlider.value, 10);
  applyCoordContrast(pct);
  localStorage.setItem(COORD_CONTRAST_KEY, String(pct));
});

const themeBtn = document.getElementById("themeBtn");
const themePanel = document.getElementById("themePanel");
const sidebarEl = document.querySelector(".sidebar");
themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = themePanel.hidden;
  themePanel.hidden = !themePanel.hidden;
  if (opening) {
    // Stretch the panel down to the sidebar's own bottom edge instead of
    // leaving a bare gap of sidebar background below a short panel.
    const sidebarRect = sidebarEl.getBoundingClientRect();
    const topbarBottom = document.querySelector(".topbar").getBoundingClientRect().bottom;
    const top = topbarBottom - sidebarRect.top;
    themePanel.style.top = top + "px";
    themePanel.style.minHeight = (sidebarRect.height - top) + "px";
  }
});
document.querySelectorAll(".theme-swatch-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    themePanel.hidden = true;
  });
});
document.addEventListener("click", (e) => {
  if (!themePanel.hidden && !themePanel.contains(e.target) && e.target !== themeBtn) {
    themePanel.hidden = true;
  }
});

// ---- Piece style picker ----
function refreshPieceStyleButtons() {
  const current = getPieceStyle();
  document.querySelectorAll(".piece-style-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.style === current);
  });
}
refreshPieceStyleButtons();
document.querySelectorAll(".piece-style-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setPieceStyle(btn.dataset.style);
    location.reload();
  });
});

// ---- PWA install prompt ----
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("installBtn");
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    btn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
});

// ---- Service worker registration ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
