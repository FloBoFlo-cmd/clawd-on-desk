// --- Input window: pointer capture, drag, click detection ---
// This is the "controller" — all input decisions happen here.
// Render window is pure "view" — receives reaction commands via IPC relay.

const area = document.getElementById("hit-area");

// --- State synced from main ---
let currentSvg = null;
let miniMode = false;
let dndEnabled = false;

window.hitAPI.onStateSync((data) => {
  if (data.currentSvg !== undefined) currentSvg = data.currentSvg;
  if (data.miniMode !== undefined) {
    miniMode = data.miniMode;
    area.style.cursor = miniMode ? "default" : "";
  }
  if (data.dndEnabled !== undefined) dndEnabled = data.dndEnabled;
});

// --- Drag state ---
let isDragging = false;
let didDrag = false;
let lastScreenX, lastScreenY;
let mouseDownX, mouseDownY;
let pendingDx = 0, pendingDy = 0;
let dragRAF = null;
const DRAG_THRESHOLD = 3;

// --- Velocity tracking for momentum physics ---
const VELOCITY_SAMPLES = 3;
let dragSamples = [];  // { x, y, t } — last N screen positions with timestamps

// --- Reaction state (tracked here to gate input) ---
let isReacting = false;
let isDragReacting = false;

// Cancel signal from main (e.g. state change)
window.hitAPI.onCancelReaction(() => {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; clickCount = 0; firstClickDir = null; }
  isReacting = false;
  isDragReacting = false;
});

// --- Pointer handlers ---
area.addEventListener("pointerdown", (e) => {
  if (e.button === 0) {
    if (miniMode) { didDrag = false; return; }
    area.setPointerCapture(e.pointerId);
    isDragging = true;
    didDrag = false;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    pendingDx = 0;
    pendingDy = 0;
    dragSamples = [{ x: e.screenX, y: e.screenY, t: performance.now() }];
    window.hitAPI.dragLock(true);
    area.classList.add("dragging");
  }
});

document.addEventListener("pointermove", (e) => {
  if (isDragging) {
    pendingDx += e.screenX - lastScreenX;
    pendingDy += e.screenY - lastScreenY;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;

    // Record position sample for velocity calculation
    dragSamples.push({ x: e.screenX, y: e.screenY, t: performance.now() });
    if (dragSamples.length > VELOCITY_SAMPLES) dragSamples.shift();

    if (!didDrag) {
      const totalDx = e.clientX - mouseDownX;
      const totalDy = e.clientY - mouseDownY;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        didDrag = true;
        startDragReaction();
      }
    }

    if (!dragRAF) {
      dragRAF = setTimeout(() => {
        window.hitAPI.moveWindowBy(pendingDx, pendingDy);
        pendingDx = 0;
        pendingDy = 0;
        dragRAF = null;
      }, 0);
    }
  }
});

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  area.classList.remove("dragging");
  if (pendingDx !== 0 || pendingDy !== 0) {
    if (dragRAF) { clearTimeout(dragRAF); dragRAF = null; }
    window.hitAPI.moveWindowBy(pendingDx, pendingDy);
    pendingDx = 0; pendingDy = 0;
  }
  if (didDrag) {
    // Calculate velocity from recent samples
    const now = performance.now();
    dragSamples.push({ x: lastScreenX, y: lastScreenY, t: now });
    if (dragSamples.length >= 2) {
      const oldest = dragSamples[0];
      const newest = dragSamples[dragSamples.length - 1];
      const dt = newest.t - oldest.t;
      if (dt > 0 && dt < 200) {  // Only if samples are recent enough (<200ms)
        const FRAME_MS = 16;
        let vx = ((newest.x - oldest.x) / dt) * FRAME_MS;
        let vy = ((newest.y - oldest.y) / dt) * FRAME_MS;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 1.5) {  // Minimum velocity threshold to trigger momentum
          // Keep dragLock active — physics loop in main.js will unlock
          window.hitAPI.sendDragEndVelocity({ vx, vy });
          window.hitAPI.dragEnd();
          endDragReaction();
          return;
        }
      }
    }
    // No significant velocity — normal drag end
    window.hitAPI.dragLock(false);
    window.hitAPI.dragEnd();
  } else {
    window.hitAPI.dragLock(false);
  }
  endDragReaction();
}

document.addEventListener("pointerup", (e) => {
  if (e.button === 0) {
    const wasDrag = didDrag;
    stopDrag();
    if (!wasDrag) {
      if (e.ctrlKey || e.metaKey) {
        window.hitAPI.showSessionMenu();
      } else {
        handleClick(e.clientX);
      }
    }
  }
});

area.addEventListener("pointercancel", () => stopDrag());
area.addEventListener("lostpointercapture", () => { if (isDragging) stopDrag(); });
window.addEventListener("blur", stopDrag);

// --- Click reaction logic (2-click = poke, 4-click = flail) ---
const CLICK_WINDOW_MS = 400;
const REACT_LEFT_SVG = "clawd-react-left.svg";
const REACT_RIGHT_SVG = "clawd-react-right.svg";
const REACT_ANNOYED_SVG = "clawd-react-annoyed.svg";
const REACT_DOUBLE_SVGS = ["clawd-react-double.svg", "clawd-react-double-jump.svg"];
const REACT_SINGLE_DURATION = 2500;
const REACT_ANNOYED_DURATION = 3500;
const REACT_DOUBLE_DURATION = 3500;

let clickCount = 0;
let clickTimer = null;
let firstClickDir = null;

function handleClick(clientX) {
  if (miniMode) {
    window.hitAPI.exitMiniMode();
    return;
  }
  if (isReacting || isDragReacting) return;

  // Non-idle: focus terminal, no reaction
  if (currentSvg !== "clawd-idle-follow.svg" && currentSvg !== "clawd-idle-living.svg") {
    window.hitAPI.focusTerminal();
    return;
  }

  clickCount++;
  if (clickCount === 1) {
    firstClickDir = clientX < area.offsetWidth / 2 ? "left" : "right";
    window.hitAPI.focusTerminal();
  }

  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }

  if (clickCount >= 4) {
    clickCount = 0;
    firstClickDir = null;
    const doubleSvg = REACT_DOUBLE_SVGS[Math.floor(Math.random() * REACT_DOUBLE_SVGS.length)];
    playReaction(doubleSvg, REACT_DOUBLE_DURATION);
  } else if (clickCount >= 2) {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      clickCount = 0;
      if (Math.random() < 0.5) {
        firstClickDir = null;
        playReaction(REACT_ANNOYED_SVG, REACT_ANNOYED_DURATION);
      } else {
        const svg = firstClickDir === "left" ? REACT_LEFT_SVG : REACT_RIGHT_SVG;
        firstClickDir = null;
        playReaction(svg, REACT_SINGLE_DURATION);
      }
    }, CLICK_WINDOW_MS);
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      clickCount = 0;
      firstClickDir = null;
    }, CLICK_WINDOW_MS);
  }
}

function playReaction(svg, duration) {
  isReacting = true;
  window.hitAPI.playClickReaction(svg, duration);
  // Local timer to ungate input after duration
  setTimeout(() => { isReacting = false; }, duration);
}

// --- Drag reaction ---
function startDragReaction() {
  if (isDragReacting) return;
  if (dndEnabled) return;

  if (isReacting) {
    isReacting = false;
  }

  isDragReacting = true;
  window.hitAPI.startDragReaction();
}

function endDragReaction() {
  if (!isDragReacting) return;
  isDragReacting = false;
  window.hitAPI.endDragReaction();
}

// --- Right-click context menu ---
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.hitAPI.showContextMenu();
});
