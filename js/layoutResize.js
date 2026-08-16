// Drag-to-resize handles for the left sidebar and the Analyse tab's columns
// (board / Moteur & coach / Coups joués). Dragging updates CSS custom
// properties live for instant feedback; nothing is kept between reloads
// until the user clicks "Valider" in the confirmation bar, at which point
// the current values are written to localStorage. "Annuler" (or reloading
// without validating) reverts to whatever was last saved.

const STORAGE_KEY = "echiquier_layout_sizes";
const LOCK_KEY = "echiquier_layout_locked";
const VARS = ["--sidebar-w", "--board-col-w", "--side-col-w", "--side-col-h", "--board-move-x", "--board-move-y", "--board-sq-override", "--movelist-col-w", "--side-move-x", "--side-move-y", "--movelist-move-x", "--movelist-move-y"];
const DEFAULTS = {
  "--sidebar-w": 195, "--board-col-w": null, "--side-col-w": 320, "--side-col-h": null,
  "--board-move-x": 0, "--board-move-y": 0, "--board-sq-override": null, "--movelist-col-w": null,
  "--side-move-x": 0, "--side-move-y": 0, "--movelist-move-x": 0, "--movelist-move-y": 0,
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

  // Double-clicking any handle locks the whole layout in place: saves
  // whatever's currently in effect (same as clicking "Valider"), then hides
  // every handle so nothing can be nudged by accident. Double-clicking again
  // (same spot — the elements stay in the DOM, just invisible, so the hit
  // target doesn't move) brings them all back. Locked state persists across
  // reloads, separately from the sizes themselves.
  let locked = localStorage.getItem(LOCK_KEY) === "1";
  function applyLockedClass() { document.body.classList.toggle("layout-locked", locked); }
  applyLockedClass();
  function toggleLock() {
    if (!locked) {
      const merged = { ...loadSaved(), ...currentVars() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) {}
      sessionStart = null;
      confirmBar.hidden = true;
    }
    locked = !locked;
    try { localStorage.setItem(LOCK_KEY, locked ? "1" : "0"); } catch (e) {}
    applyLockedClass();
  }
  function registerLockToggle(el) {
    if (el) el.addEventListener("dblclick", (e) => { e.preventDefault(); toggleLock(); });
  }

  // Pointer Events + setPointerCapture instead of plain mouse events: once
  // the drag starts, every subsequent move/up for that pointer is routed to
  // this element even if the cursor moves faster than the browser can track
  // it or briefly leaves the element — a plain mousemove-on-document listener
  // can drop/desync in exactly that situation, which reads to the user as
  // "the handle just doesn't do anything".
  function dragHandle(handle, onMove) {
    registerLockToggle(handle);
    handle.addEventListener("pointerdown", (e) => {
      if (locked) return;
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
  const sideMoveGrip = document.getElementById("sideColMoveGrip");
  const movelistMoveGrip = document.getElementById("movelistMoveGrip");

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

  // Same idea as positionMoveGrip, but for the "Moteur & coach" column
  // instead of the board — pinned to its live top-left corner, hidden
  // whenever that column isn't actually on screen (e.g. mobile layout, or
  // the Analyse tab isn't the active view).
  function positionSideMoveGrip() {
    if (!sideMoveGrip) return;
    const analyseView = document.getElementById("view-analyse");
    const sideCol = analyseView && analyseView.classList.contains("active")
      ? document.querySelector(".analyse-side-col") : null;
    if (!sideCol || !sideCol.offsetParent) { sideMoveGrip.style.display = "none"; return; }
    sideMoveGrip.style.display = "";
    const rect = sideCol.getBoundingClientRect();
    sideMoveGrip.style.left = (rect.left - 13) + "px";
    sideMoveGrip.style.top = (rect.top - 13) + "px";
  }

  // Same idea again, for "Coups joués" — hidden not just when the Analyse
  // tab isn't active, but also whenever the move-list itself is (the
  // full-game-results 2-column mode removes it from the layout entirely).
  function positionMovelistMoveGrip() {
    if (!movelistMoveGrip) return;
    const analyseView = document.getElementById("view-analyse");
    const movelist = analyseView && analyseView.classList.contains("active")
      ? document.querySelector(".movelist-wrap") : null;
    if (!movelist || !movelist.offsetParent) { movelistMoveGrip.style.display = "none"; return; }
    movelistMoveGrip.style.display = "";
    const rect = movelist.getBoundingClientRect();
    movelistMoveGrip.style.left = (rect.left - 13) + "px";
    movelistMoveGrip.style.top = (rect.top - 13) + "px";
  }

  function positionGrips() { positionBoardGrip(); positionMoveGrip(); positionSideMoveGrip(); positionMovelistMoveGrip(); }

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
    registerLockToggle(moveGrip);
    let moveStart = null;
    moveGrip.addEventListener("pointerdown", (e) => {
      if (locked) return;
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

  // Same free-repositioning idea as the board's move grip, for "Moteur &
  // coach" instead. Its left boundary is whatever sits immediately to its
  // left (the board/move-list handle when visible, the column's own current
  // position otherwise — i.e. no leftward slack) and its right boundary is
  // the move-list column when that's showing, or the layout's own right
  // edge when it isn't (the 2-column "full-game results" mode) — covering
  // both grid layouts this column can appear in.
  if (sideMoveGrip) {
    registerLockToggle(sideMoveGrip);
    let sideMoveStart = null;
    sideMoveGrip.addEventListener("pointerdown", (e) => {
      if (locked) return;
      e.preventDefault();
      try { sideMoveGrip.setPointerCapture(e.pointerId); } catch (err) {}
      sideMoveGrip.classList.add("dragging");
      const sideCol = document.querySelector(".analyse-side-col");
      const boardCol = document.querySelector(".analyse-board-col");
      const handle = document.getElementById("sideMovelistResizeHandle");
      const movelist = document.querySelector(".movelist-wrap");
      const layout = document.querySelector(".analyse-layout");
      const sideColRect = sideCol.getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const offsetX = parseFloat(cs.getPropertyValue("--side-move-x")) || 0;
      const offsetY = parseFloat(cs.getPropertyValue("--side-move-y")) || 0;
      // The handle sits on OPPOSITE sides of the side-col depending on which
      // grid layout is active: normal mode is board | side-col | handle |
      // move-list (handle to the right), full-game-results mode is board |
      // handle | side-col (handle to the left) — using it as "the left
      // boundary" unconditionally was backwards in normal mode and threw
      // the panel clear across the screen the instant a vertical-only drag
      // read a stale boundary from the wrong side.
      const handleVisible = handle && handle.offsetParent;
      const movelistVisible = movelist && movelist.offsetParent;
      const leftBoundary = (handleVisible && !movelistVisible)
        ? handle.getBoundingClientRect().right
        : boardCol.getBoundingClientRect().right;
      const rightBoundary = (handleVisible && movelistVisible)
        ? handle.getBoundingClientRect().left
        : layout.getBoundingClientRect().right;
      sideMoveStart = { startX: e.clientX, startY: e.clientY, offsetX, offsetY, sideColRect, leftBoundary, rightBoundary };
      markDirty();
      const onPointerMove = (ev) => {
        if (!sideMoveStart) return;
        const dx = ev.clientX - sideMoveStart.startX;
        const dy = ev.clientY - sideMoveStart.startY;
        const naturalLeft = sideMoveStart.sideColRect.left - sideMoveStart.offsetX;
        const naturalRight = sideMoveStart.sideColRect.right - sideMoveStart.offsetX;
        const minX = sideMoveStart.leftBoundary - naturalLeft;
        const maxX = sideMoveStart.rightBoundary - naturalRight;
        const newX = Math.max(minX, Math.min(maxX, sideMoveStart.offsetX + dx));
        const naturalTop = sideMoveStart.sideColRect.top - sideMoveStart.offsetY;
        const naturalBottom = sideMoveStart.sideColRect.bottom - sideMoveStart.offsetY;
        const minY = 8 - naturalTop;
        const maxY = window.innerHeight - 8 - naturalBottom;
        const newY = Math.max(minY, Math.min(maxY, sideMoveStart.offsetY + dy));
        document.documentElement.style.setProperty("--side-move-x", newX + "px");
        document.documentElement.style.setProperty("--side-move-y", newY + "px");
        positionSideMoveGrip();
        markDirty();
      };
      const onPointerUp = (ev) => {
        sideMoveGrip.classList.remove("dragging");
        try { sideMoveGrip.releasePointerCapture(ev.pointerId); } catch (err) {}
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        sideMoveStart = null;
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });
  }

  // Same free-repositioning idea once more, for "Coups joués". Simpler than
  // the side-col case: the move-list only ever appears in the normal 4-track
  // layout (grid is board | side-col | handle | move-list), always the last
  // column, so its left neighbor is always the handle and there's never
  // anything to its right except the layout's own edge — no mode-switching
  // to account for.
  if (movelistMoveGrip) {
    registerLockToggle(movelistMoveGrip);
    let movelistMoveStart = null;
    movelistMoveGrip.addEventListener("pointerdown", (e) => {
      if (locked) return;
      e.preventDefault();
      try { movelistMoveGrip.setPointerCapture(e.pointerId); } catch (err) {}
      movelistMoveGrip.classList.add("dragging");
      const movelist = document.querySelector(".movelist-wrap");
      const handle = document.getElementById("sideMovelistResizeHandle");
      const layout = document.querySelector(".analyse-layout");
      const movelistRect = movelist.getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const offsetX = parseFloat(cs.getPropertyValue("--movelist-move-x")) || 0;
      const offsetY = parseFloat(cs.getPropertyValue("--movelist-move-y")) || 0;
      const leftBoundary = handle && handle.offsetParent ? handle.getBoundingClientRect().right : movelistRect.left;
      const rightBoundary = layout.getBoundingClientRect().right;
      movelistMoveStart = { startX: e.clientX, startY: e.clientY, offsetX, offsetY, movelistRect, leftBoundary, rightBoundary };
      markDirty();
      const onPointerMove = (ev) => {
        if (!movelistMoveStart) return;
        const dx = ev.clientX - movelistMoveStart.startX;
        const dy = ev.clientY - movelistMoveStart.startY;
        const naturalLeft = movelistMoveStart.movelistRect.left - movelistMoveStart.offsetX;
        const naturalRight = movelistMoveStart.movelistRect.right - movelistMoveStart.offsetX;
        const minX = movelistMoveStart.leftBoundary - naturalLeft;
        const maxX = movelistMoveStart.rightBoundary - naturalRight;
        const newX = Math.max(minX, Math.min(maxX, movelistMoveStart.offsetX + dx));
        const naturalTop = movelistMoveStart.movelistRect.top - movelistMoveStart.offsetY;
        const naturalBottom = movelistMoveStart.movelistRect.bottom - movelistMoveStart.offsetY;
        const minY = 8 - naturalTop;
        const maxY = window.innerHeight - 8 - naturalBottom;
        const newY = Math.max(minY, Math.min(maxY, movelistMoveStart.offsetY + dy));
        document.documentElement.style.setProperty("--movelist-move-x", newX + "px");
        document.documentElement.style.setProperty("--movelist-move-y", newY + "px");
        positionMovelistMoveGrip();
        markDirty();
      };
      const onPointerUp = (ev) => {
        movelistMoveGrip.classList.remove("dragging");
        try { movelistMoveGrip.releasePointerCapture(ev.pointerId); } catch (err) {}
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        movelistMoveStart = null;
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });
  }

  if (boardGrip || moveGrip || sideMoveGrip || movelistMoveGrip) {
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
    const SIDE_COL_FLOOR = 230, MOVELIST_FLOOR = 150;
    dragHandle(sideMovelistHandle, (clientX) => {
      const layout = document.querySelector(".analyse-layout");
      const sideCol = document.querySelector(".analyse-side-col");
      // Reserve the board's own rendered size, not its grid column's — the
      // column can be wider than the board actually needs (e.g. when the
      // board's automatic size is capped by the 8.5vh term rather than by
      // its column's width), and reserving that unused slack as if the
      // board needed it artificially capped how far this handle could grow
      // the side panel, well short of the space genuinely available.
      const board = activeBoard();
      const boardColW = board ? board.getBoundingClientRect().width : document.querySelector(".analyse-board-col").getBoundingClientRect().width;
      const layoutW = layout.getBoundingClientRect().width;
      const left = sideCol.getBoundingClientRect().left;
      // side-col and move-list share a fixed combined budget —
      // whatever's left of the row after the board's own (protected) width —
      // so this is a genuine two-way splitter between them, not side-col
      // alone chasing the cursor while move-list could only ever passively
      // shrink down to (and never past) its own untouched default width.
      // That asymmetry was the actual bug behind "je ne peux toujours pas
      // régler Coups joués" — dragging left past move-list's *default* 190px
      // used to do nothing at all, since nothing was pulling move-list any
      // wider than that default in the first place.
      const totalSpan = layoutW - boardColW - 16; // side-col + move-list combined, board protected
      const w = Math.max(SIDE_COL_FLOOR, Math.min(totalSpan - MOVELIST_FLOOR, clientX - left));
      document.documentElement.style.setProperty("--side-col-w", w + "px");
      document.documentElement.style.setProperty("--movelist-col-w", (totalSpan - w) + "px");
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
