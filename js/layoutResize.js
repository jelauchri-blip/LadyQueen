// Drag-to-resize handles for the left sidebar and the Analyse tab's columns
// (board / Moteur & coach / Coups joués). Dragging updates CSS custom
// properties live for instant feedback; nothing is kept between reloads
// until the user clicks "Valider" in the confirmation bar, at which point
// the current values are written to localStorage. "Annuler" (or reloading
// without validating) reverts to whatever was last saved.

const STORAGE_KEY = "echiquier_layout_sizes";
const VARS = ["--sidebar-w", "--board-col-w", "--side-col-w"];
const DEFAULTS = { "--sidebar-w": 195, "--board-col-w": null, "--side-col-w": 320 };

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    return {};
  }
}

function applyVars(values) {
  const root = document.documentElement.style;
  for (const name of VARS) {
    const v = values[name];
    if (v == null) root.removeProperty(name);
    else root.setProperty(name, v + "px");
  }
}

function currentVars() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const name of VARS) {
    const raw = document.documentElement.style.getPropertyValue(name);
    out[name] = raw ? parseFloat(raw) : null;
  }
  return out;
}

export function initLayoutResize() {
  applyVars({ ...DEFAULTS, ...loadSaved() });

  const confirmBar = document.getElementById("layoutConfirmBar");
  const validateBtn = document.getElementById("layoutValidateBtn");
  const resetBtn = document.getElementById("layoutResetBtn");
  let sessionStart = null; // values in effect when the current unsaved drag session began

  function markDirty() {
    if (!sessionStart) sessionStart = { ...loadSaved() };
    confirmBar.hidden = false;
  }

  validateBtn.onclick = () => {
    const merged = { ...loadSaved(), ...currentVars() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) {}
    sessionStart = null;
    confirmBar.hidden = true;
  };

  resetBtn.onclick = () => {
    applyVars({ ...DEFAULTS, ...(sessionStart || loadSaved()) });
    sessionStart = null;
    confirmBar.hidden = true;
  };

  function dragHandle(handle, onMove) {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      const onMouseMove = (ev) => { onMove(ev.clientX); markDirty(); };
      const onMouseUp = () => {
        handle.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  const sidebarHandle = document.getElementById("sidebarResizeHandle");
  if (sidebarHandle) {
    dragHandle(sidebarHandle, (clientX) => {
      const sidebar = document.querySelector(".sidebar");
      const left = sidebar.getBoundingClientRect().left;
      const w = Math.max(160, Math.min(320, clientX - left));
      document.documentElement.style.setProperty("--sidebar-w", w + "px");
    });
  }

  const boardSideHandle = document.getElementById("boardSideResizeHandle");
  if (boardSideHandle) {
    dragHandle(boardSideHandle, (clientX) => {
      const layout = document.querySelector(".analyse-layout");
      const boardCol = document.querySelector(".analyse-board-col");
      const sideColW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--side-col-w")) || 320;
      const layoutW = layout.getBoundingClientRect().width;
      const left = boardCol.getBoundingClientRect().left;
      const maxW = layoutW - sideColW - 150 - 16; // reserve side-col + movelist floor + 2 handles
      const w = Math.max(480, Math.min(maxW, clientX - left));
      document.documentElement.style.setProperty("--board-col-w", w + "px");
    });
  }

  const sideMovelistHandle = document.getElementById("sideMovelistResizeHandle");
  if (sideMovelistHandle) {
    dragHandle(sideMovelistHandle, (clientX) => {
      const layout = document.querySelector(".analyse-layout");
      const sideCol = document.querySelector(".analyse-side-col");
      const boardColW = document.querySelector(".analyse-board-col").getBoundingClientRect().width;
      const layoutW = layout.getBoundingClientRect().width;
      const left = sideCol.getBoundingClientRect().left;
      const maxW = layoutW - boardColW - 150 - 16; // reserve board-col + movelist floor + 2 handles
      const w = Math.max(230, Math.min(maxW, clientX - left));
      document.documentElement.style.setProperty("--side-col-w", w + "px");
    });
  }
}
