// Drag-to-resize handles for the left sidebar and the Analyse tab's columns
// (board / Moteur & coach / Coups joués). Dragging updates CSS custom
// properties live for instant feedback; nothing is kept between reloads
// until the user clicks "Valider" in the confirmation bar, at which point
// the current values are written to localStorage. "Annuler" (or reloading
// without validating) reverts to whatever was last saved.

const STORAGE_KEY = "echiquier_layout_sizes";
const VARS = ["--sidebar-w", "--board-col-w", "--side-col-w", "--side-col-h", "--board-move-x", "--board-move-y", "--board-sq-override", "--movelist-col-w"];
const DEFAULTS = {
  "--sidebar-w": 195, "--board-col-w": null, "--side-col-w": 320, "--side-col-h": null,
  "--board-move-x": 0, "--board-move-y": 0, "--board-sq-override": null, "--movelist-col-w": null,
};

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

  // Pointer Events + setPointerCapture instead of plain mouse events: once
  // the drag starts, every subsequent move/up for that pointer is routed to
  // this element even if the cursor moves faster than the browser can track
  // it or briefly leaves the element — a plain mousemove-on-document listener
  // can drop/desync in exactly that situation, which reads to the user as
  // "the handle just doesn't do anything".
  function dragHandle(handle, onMove) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // setPointerCapture can throw (e.g. no "active" pointer by the time
      // this runs, seen with some browser/extension combos) — if it does,
      // the drag must still work, just without capture's benefit of staying
      // tracked past the element's edges. A throw here must never abort the
      // rest of the handler, or the whole handle would silently do nothing.
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      handle.classList.add("dragging");
      onMove(e.clientX, e.clientY);
      markDirty();
      const onPointerMove = (ev) => { onMove(ev.clientX, ev.clientY); markDirty(); };
      const onPointerUp = (ev) => {
        handle.classList.remove("dragging");
        try { handle.releasePointerCapture(ev.pointerId); } catch (err) {}
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
      };
      // Listen on `document`, not just `handle`: pointer capture (when it
      // succeeds) already redirects events to `handle` regardless of where
      // the cursor physically is, but if capture failed above, only a
      // document-level listener keeps receiving moves once the cursor drifts
      // off the 16px-wide handle — which, dragging fast, it always will.
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
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

  // The board itself is re-created by board.js/positionEditor.js (it's not a
  // static element), so its size/position can only be read live, never
  // assumed. This finds whichever one is actually visible right now — the
  // normal game board, or the position editor's board when that's open.
  function activeBoard() {
    const editorMount = document.getElementById("editorMount");
    if (editorMount && !editorMount.hidden) {
      const b = editorMount.querySelector(".board");
      if (b) return b;
    }
    return document.querySelector("#analyseBoardMount .board");
  }

  const boardGrip = document.getElementById("boardCornerGrip");
  const moveGrip = document.getElementById("boardMoveGrip");

  function positionBoardGrip() {
    if (!boardGrip) return;
    const analyseView = document.getElementById("view-analyse");
    const board = analyseView && analyseView.classList.contains("active") ? activeBoard() : null;
    if (!board) { boardGrip.style.display = "none"; return; }
    boardGrip.style.display = "";
    const rect = board.getBoundingClientRect();
    boardGrip.style.left = (rect.right - 24) + "px";
    boardGrip.style.top = (rect.bottom - 24) + "px";
  }

  function positionMoveGrip() {
    if (!moveGrip) return;
    const analyseView = document.getElementById("view-analyse");
    const board = analyseView && analyseView.classList.contains("active") ? activeBoard() : null;
    if (!board) { moveGrip.style.display = "none"; return; }
    moveGrip.style.display = "";
    const rect = board.getBoundingClientRect();
    moveGrip.style.left = (rect.left - 13) + "px";
    moveGrip.style.top = (rect.top - 13) + "px";
  }

  function positionGrips() { positionBoardGrip(); positionMoveGrip(); }

  if (boardGrip) {
    dragHandle(boardGrip, (clientX) => {
      const board = activeBoard();
      if (!board) return;
      const layout = document.querySelector(".analyse-layout");
      const layoutW = layout.getBoundingClientRect().width;
      const boardRect = board.getBoundingClientRect();
      const left = boardRect.left;
      // Reserve actual rendered widths, not guessed constants: the movelist
      // column's minmax(150px, 190px) track does NOT shrink to its 150px
      // floor just because the board wants more room — the grid shrinks the
      // board's own track instead (it has the widest min/max range), so a
      // reserve based on movelist's 150px floor let --board-col-w be set
      // past what the grid would actually grant it, and the board (sized off
      // that too-generous value) overflowed past its own column box.
      const sideColEl = document.querySelector(".analyse-side-col");
      const movelistEl = document.querySelector(".movelist-wrap");
      const sideColW = sideColEl ? sideColEl.getBoundingClientRect().width : 320;
      const movelistW = movelistEl && movelistEl.offsetParent ? movelistEl.getBoundingClientRect().width : 0;
      const maxW = layoutW - sideColW - movelistW - 16; // reserve side-col + movelist + 1 handle, from their real widths
      const maxH = window.innerHeight - boardRect.top - 16; // reserve bottom margin so a wide-but-short window can't push the board off-screen
      const w = Math.max(480, Math.min(maxW, maxH, clientX - left));
      document.documentElement.style.setProperty("--board-col-w", w + "px");
      // Also drive --sq directly: the automatic formula's own 8.5vh term
      // caps square size to a flat guess at the viewport's height regardless
      // of how much column width dragging frees up, which on a tall window
      // made the drag stop moving the board well before it ran out of real
      // space. This override replaces that flat guess with the board's
      // actual available width/height (maxW/maxH above) while dragging.
      const sq = Math.max(40, (w - 24) / 8);
      document.documentElement.style.setProperty("--board-sq-override", sq + "px");
      positionGrips();
    });
  }

  // Free repositioning: drag delta (not absolute position, unlike the other
  // handles) added to whatever offset was already in effect, clamped so the
  // board can be nudged around but never dragged into the sidebar or the
  // side column, or off the top/bottom of the screen.
  if (moveGrip) {
    let moveStart = null;
    moveGrip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { moveGrip.setPointerCapture(e.pointerId); } catch (err) {}
      moveGrip.classList.add("dragging");
      const boardCol = document.querySelector(".analyse-board-col");
      const sidebar = document.querySelector(".sidebar");
      const sideCol = document.querySelector(".analyse-side-col");
      const cs = getComputedStyle(document.documentElement);
      const offsetX = parseFloat(cs.getPropertyValue("--board-move-x")) || 0;
      const offsetY = parseFloat(cs.getPropertyValue("--board-move-y")) || 0;
      moveStart = {
        startX: e.clientX, startY: e.clientY, offsetX, offsetY,
        boardColRect: boardCol.getBoundingClientRect(),
        sidebarRight: sidebar ? sidebar.getBoundingClientRect().right : 0,
        sideColLeft: sideCol ? sideCol.getBoundingClientRect().left : window.innerWidth,
      };
      markDirty();
      const onPointerMove = (ev) => {
        if (!moveStart) return;
        const dx = ev.clientX - moveStart.startX;
        const dy = ev.clientY - moveStart.startY;
        // No safety buffer here: the board sits flush (0 gap) against the
        // sidebar/side-col by default, and that flush position must stay
        // reachable — an earlier version reserved 8px on each side "just in
        // case", which doesn't sound like much but as a hard minimum it
        // shoved the board 8px away from flush the instant a drag started,
        // and then refused to let it back to flush ("un mur infranchissable"
        // for a gap the fix itself had just created).
        const naturalLeft = moveStart.boardColRect.left - moveStart.offsetX;
        const naturalRight = moveStart.boardColRect.right - moveStart.offsetX;
        const minX = moveStart.sidebarRight - naturalLeft;
        const maxX = moveStart.sideColLeft - naturalRight;
        const newX = Math.max(minX, Math.min(maxX, moveStart.offsetX + dx));
        const naturalTop = moveStart.boardColRect.top - moveStart.offsetY;
        const naturalBottom = moveStart.boardColRect.bottom - moveStart.offsetY;
        const minY = 8 - naturalTop;
        const maxY = window.innerHeight - 8 - naturalBottom;
        const newY = Math.max(minY, Math.min(maxY, moveStart.offsetY + dy));
        document.documentElement.style.setProperty("--board-move-x", newX + "px");
        document.documentElement.style.setProperty("--board-move-y", newY + "px");
        positionGrips();
        markDirty();
      };
      const onPointerUp = (ev) => {
        moveGrip.classList.remove("dragging");
        try { moveGrip.releasePointerCapture(ev.pointerId); } catch (err) {}
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        moveStart = null;
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });
  }

  if (boardGrip || moveGrip) {
    positionGrips();
    window.addEventListener("resize", positionGrips);
    // Catches the editor opening/closing, switching tabs, and any other
    // change to the board area (a plain resize listener alone wouldn't fire
    // for those) — recomputing the grips' position is cheap enough that
    // there's no need to be selective about which mutation actually mattered.
    new MutationObserver(positionGrips).observe(document.body, {
      attributes: true, attributeFilter: ["hidden", "class"], subtree: true, childList: true,
    });
  }

  const sideMovelistHandle = document.getElementById("sideMovelistResizeHandle");
  if (sideMovelistHandle) {
    const SIDE_COL_DEFAULT = 320, MOVELIST_DEFAULT = 190, MOVELIST_FLOOR = 150;
    dragHandle(sideMovelistHandle, (clientX) => {
      const layout = document.querySelector(".analyse-layout");
      const sideCol = document.querySelector(".analyse-side-col");
      const boardColW = document.querySelector(".analyse-board-col").getBoundingClientRect().width;
      const layoutW = layout.getBoundingClientRect().width;
      const left = sideCol.getBoundingClientRect().left;
      const maxW = layoutW - boardColW - MOVELIST_FLOOR - 16; // reserve board-col + movelist floor + 1 handle
      const w = Math.max(230, Math.min(maxW, clientX - left));
      document.documentElement.style.setProperty("--side-col-w", w + "px");
      // The board column is `1fr` (flexible) in the grid, so it silently
      // absorbed whatever "Moteur & coach" grew into — widening the coach
      // panel visibly shrank the board even though nothing about the board
      // itself was touched. The move-list column next to it, on the other
      // hand, sat untouched at a fixed width regardless of this drag. Taking
      // the growth out of the move-list's width instead (down to its own
      // floor) keeps side-col + move-list's combined width constant, so the
      // board's automatic share of the row never changes from this handle.
      const growth = Math.max(0, w - SIDE_COL_DEFAULT);
      const movelistW = Math.max(MOVELIST_FLOOR, MOVELIST_DEFAULT - growth);
      document.documentElement.style.setProperty("--movelist-col-w", movelistW + "px");
    });
  }

  const sideColHeightHandle = document.getElementById("sideColHeightHandle");
  if (sideColHeightHandle) {
    dragHandle(sideColHeightHandle, (clientX, clientY) => {
      const sideCol = document.querySelector(".analyse-side-col");
      const top = sideCol.getBoundingClientRect().top;
      const maxH = window.innerHeight - top - 16;
      const h = Math.max(120, Math.min(maxH, clientY - top));
      document.documentElement.style.setProperty("--side-col-h", h + "px");
    });
  }
}
