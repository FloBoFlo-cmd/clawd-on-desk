// --- Render window: pure view (SVG rendering + eye tracking) ---
// All input (pointer/drag/click) is handled by the hit window (hit-renderer.js).
// Reactions are triggered via IPC from main (relayed from hit window).

const container = document.getElementById("pet-container");

// --- Reaction state (visual side) ---
const REACT_DRAG_SVG = "clawd-react-drag.svg";
let isReacting = false;
let isDragReacting = false;
let reactTimer = null;
let currentIdleSvg = null;    // tracks which SVG is currently showing
let dndEnabled = false;
let miniLeftFlip = false;

window.electronAPI.onDndChange((enabled) => { dndEnabled = enabled; });

// --- Sound effects (Web Audio API synthesis) ---
let audioCtx = null;
window.electronAPI.onPlaySound((sound) => {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = sound.type || "sine";
    osc.frequency.setValueAtTime(sound.freq, audioCtx.currentTime);
    if (sound.freq2) {
      osc.frequency.linearRampToValueAtTime(sound.freq2, audioCtx.currentTime + (sound.duration || 0.2));
    }
    gain.gain.setValueAtTime(sound.volume || 0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (sound.duration || 0.2));
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (sound.duration || 0.2) + 0.05);
  } catch (e) {
    // Silently ignore audio errors (e.g. autoplay policy)
  }
});

// --- Ambient noise generator (white noise → lowpass for soft "rain" sound) ---
let ambientSource = null;
let ambientGain = null;
let ambientFadeTimer = null;

window.electronAPI.onStartAmbient(() => {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (ambientSource) return; // already running
    if (ambientFadeTimer) { clearTimeout(ambientFadeTimer); ambientFadeTimer = null; }

    // Generate 2 seconds of white noise buffer (looped)
    const sampleRate = audioCtx.sampleRate;
    const bufferSize = sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Lowpass filter for soft rain-like sound
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, audioCtx.currentTime);
    filter.Q.setValueAtTime(0.7, audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    // Fade in over 300ms
    gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.3);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    source.start();

    ambientSource = source;
    ambientGain = gain;
  } catch (e) {
    // Silently ignore audio errors
  }
});

window.electronAPI.onStopAmbient(() => {
  try {
    if (!ambientSource || !ambientGain || !audioCtx) return;
    if (ambientFadeTimer) { clearTimeout(ambientFadeTimer); ambientFadeTimer = null; }

    const src = ambientSource;
    const gn = ambientGain;

    // Fade out over 500ms then stop
    gn.gain.cancelScheduledValues(audioCtx.currentTime);
    gn.gain.setValueAtTime(gn.gain.value, audioCtx.currentTime);
    gn.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

    ambientSource = null;
    ambientGain = null;

    ambientFadeTimer = setTimeout(() => {
      ambientFadeTimer = null;
      try { src.stop(); } catch (e) {}
    }, 550);
  } catch (e) {
    // Silently ignore audio errors
  }
});

window.electronAPI.onMiniModeChange((enabled, edge) => {
  miniLeftFlip = enabled && edge === "left";
  container.classList.toggle("mini-left", miniLeftFlip);
  if (miniLeftFlip) {
    applyGlyphFlipCompensation(clawdEl);
  } else {
    removeGlyphFlipCompensation(clawdEl);
  }
});

// Counter-flip asymmetric pixel-art glyphs (Zzz) inside SVG defs so they
// render correctly when the container has scaleX(-1). Only the glyph shape
// is flipped — CSS animation transforms (float direction) are unaffected.
const GLYPH_FLIP_DEFS = { "pixel-z": 4, "pixel-z-small": 3 };

function applyGlyphFlipCompensation(objectEl) {
  if (!objectEl) return;
  try {
    const doc = objectEl.contentDocument;
    if (!doc) return;
    for (const [id, w] of Object.entries(GLYPH_FLIP_DEFS)) {
      const el = doc.getElementById(id);
      if (el) el.setAttribute("transform", `translate(${w}, 0) scale(-1, 1)`);
    }
  } catch {}
}

function removeGlyphFlipCompensation(objectEl) {
  if (!objectEl) return;
  try {
    const doc = objectEl.contentDocument;
    if (!doc) return;
    for (const id of Object.keys(GLYPH_FLIP_DEFS)) {
      const el = doc.getElementById(id);
      if (el) el.removeAttribute("transform");
    }
  } catch {}
}

function getObjectSvgName(objectEl) {
  if (!objectEl) return null;
  const data = objectEl.getAttribute("data") || objectEl.data || "";
  if (!data) return null;
  const clean = data.split(/[?#]/)[0];
  const parts = clean.split("/");
  return parts[parts.length - 1] || null;
}

const SVG_IDLE_FOLLOW = "clawd-idle-follow.svg";

function shouldTrackEyes(state, svg) {
  return (state === "idle" && svg === SVG_IDLE_FOLLOW) || state === "mini-idle";
}

// --- IPC-triggered reactions (from hit window via main relay) ---
window.electronAPI.onStartDragReaction(() => startDragReaction());
window.electronAPI.onEndDragReaction(() => endDragReaction());
window.electronAPI.onPlayClickReaction((svg, duration) => playReaction(svg, duration));

function playReaction(svgFile, durationMs) {
  isReacting = true;
  detachEyeTracking();
  window.electronAPI.pauseCursorPolling();

  // Reuse existing swap pattern
  if (pendingNext) {
    pendingNext.remove();
    pendingNext = null;
  }

  const next = document.createElement("object");
  next.type = "image/svg+xml";
  next.id = "clawd";
  next.style.opacity = "0";

  const swap = () => {
    if (pendingNext !== next) return;
    next.style.transition = "none";
    next.style.opacity = "1";
    for (const child of [...container.querySelectorAll("object")]) {
      if (child !== next) child.remove();
    }
    pendingNext = null;
    clawdEl = next;
    currentDisplayedSvg = svgFile;
  };

  next.addEventListener("load", swap, { once: true });
  next.data = `../assets/svg/${svgFile}`;
  container.appendChild(next);
  pendingNext = next;
  setTimeout(() => {
    if (pendingNext !== next) return;
    // If SVG failed to load, abandon swap and keep current display
    try { if (!next.contentDocument) { next.remove(); pendingNext = null; return; } } catch {}
    swap();
  }, 3000);

  reactTimer = setTimeout(() => endReaction(), durationMs);
}

function endReaction() {
  if (!isReacting) return;
  isReacting = false;
  reactTimer = null;
  window.electronAPI.resumeFromReaction();
}

function cancelReaction() {
  // Click timers are now in hit-renderer.js — only clear local reaction state
  if (isReacting) {
    if (reactTimer) { clearTimeout(reactTimer); reactTimer = null; }
    isReacting = false;
  }
  if (isDragReacting) {
    isDragReacting = false;
  }
}

// --- Drag reaction (loops while dragging, idle-follow only) ---
function swapToSvg(svgFile) {
  if (pendingNext) { pendingNext.remove(); pendingNext = null; }
  const next = document.createElement("object");
  next.type = "image/svg+xml";
  next.id = "clawd";
  next.style.opacity = "0";
  const swap = () => {
    if (pendingNext !== next) return;
    next.style.transition = "none";
    next.style.opacity = "1";
    for (const child of [...container.querySelectorAll("object")]) {
      if (child !== next) child.remove();
    }
    pendingNext = null;
    clawdEl = next;
    currentDisplayedSvg = svgFile;
  };
  next.addEventListener("load", swap, { once: true });
  next.data = `../assets/svg/${svgFile}`;
  container.appendChild(next);
  pendingNext = next;
  setTimeout(() => {
    if (pendingNext !== next) return;
    try { if (!next.contentDocument) { next.remove(); pendingNext = null; return; } } catch {}
    swap();
  }, 3000);
}

function startDragReaction() {
  if (isDragReacting) return;
  if (dndEnabled) return;  // DND: just move the window, no reaction animation

  // Drag interrupts click reaction if active
  if (isReacting) {
    if (reactTimer) { clearTimeout(reactTimer); reactTimer = null; }
    isReacting = false;
  }

  isDragReacting = true;
  detachEyeTracking();
  window.electronAPI.pauseCursorPolling();
  swapToSvg(REACT_DRAG_SVG);
}

function endDragReaction() {
  if (!isDragReacting) return;
  isDragReacting = false;
  window.electronAPI.resumeFromReaction();
}

// --- State change → switch SVG animation (preload + instant swap) ---
let clawdEl = document.getElementById("clawd");
let pendingNext = null;
let currentDisplayedSvg = getObjectSvgName(clawdEl);
currentIdleSvg = currentDisplayedSvg;

window.electronAPI.onStateChange((state, svg) => {
  // Main process state change → cancel any active click reaction
  cancelReaction();

  if (pendingNext) {
    pendingNext.remove();
    pendingNext = null;
  }
  if (clawdEl && clawdEl.isConnected && currentDisplayedSvg === svg) {
    if (shouldTrackEyes(state, svg) && !eyeTarget) {
      attachEyeTracking(clawdEl);
    } else if (!shouldTrackEyes(state, svg)) {
      detachEyeTracking();
    }
    currentIdleSvg = svg;
    return;
  }
  detachEyeTracking();

  const next = document.createElement("object");
  next.type = "image/svg+xml";
  next.id = "clawd";
  next.style.opacity = "0";

  const swap = () => {
    if (pendingNext !== next) return;
    next.style.transition = "none";
    next.style.opacity = "1";
    for (const child of [...container.querySelectorAll("object")]) {
      if (child !== next) child.remove();
    }
    pendingNext = null;
    clawdEl = next;
    currentDisplayedSvg = svg;

    if (shouldTrackEyes(state, svg)) {
      attachEyeTracking(next);
    }
    if (miniLeftFlip) applyGlyphFlipCompensation(next);

    // Track current SVG for click reaction gating
    currentIdleSvg = svg;
  };

  next.addEventListener("load", swap, { once: true });
  next.data = `../assets/svg/${svg}`;
  container.appendChild(next);
  pendingNext = next;
  setTimeout(() => {
    if (pendingNext !== next) return;
    try { if (!next.contentDocument) { next.remove(); pendingNext = null; return; } } catch {}
    swap();
  }, 3000);
});

// --- Eye tracking (idle state only) ---
let eyeTarget = null;
let bodyTarget = null;
let shadowTarget = null;
let lastEyeDx = 0;
let lastEyeDy = 0;
let eyeAttachToken = 0;

function applyEyeMove(dx, dy) {
  if (eyeTarget) {
    eyeTarget.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  if (bodyTarget || shadowTarget) {
    const bdx = Math.round(dx * 0.33 * 2) / 2;
    const bdy = Math.round(dy * 0.33 * 2) / 2;
    if (bodyTarget) bodyTarget.style.transform = `translate(${bdx}px, ${bdy}px)`;
    if (shadowTarget) {
      // Shadow stretches toward lean direction (feet stay anchored)
      const absDx = Math.abs(bdx);
      const scaleX = 1 + absDx * 0.15;
      const shiftX = Math.round(bdx * 0.3 * 2) / 2;
      shadowTarget.style.transform = `translate(${shiftX}px, 0) scaleX(${scaleX})`;
    }
  }
}

function attachEyeTracking(objectEl) {
  const token = ++eyeAttachToken;
  eyeTarget = null;
  bodyTarget = null;
  shadowTarget = null;

  const tryAttach = (attempt) => {
    if (token !== eyeAttachToken) return;
    if (!objectEl || !objectEl.isConnected) return;

    try {
      const svgDoc = objectEl.contentDocument;
      const eyes = svgDoc && svgDoc.getElementById("eyes-js");
      if (eyes) {
        eyeTarget = eyes;
        bodyTarget = svgDoc.getElementById("body-js");
        shadowTarget = svgDoc.getElementById("shadow-js");
        applyEyeMove(lastEyeDx, lastEyeDy);
        return;
      }
    } catch (e) {
      console.warn("Cannot access SVG contentDocument for eye tracking:", e.message);
      return;
    }

    if (attempt >= 60) {
      console.warn("Timed out waiting for SVG eye targets");
      return;
    }
    // setTimeout fallback — rAF may be throttled in unfocused windows
    setTimeout(() => tryAttach(attempt + 1), 16);
  };

  tryAttach(0);
}

function detachEyeTracking() {
  eyeAttachToken++;
  eyeTarget = null;
  bodyTarget = null;
  shadowTarget = null;
}

window.electronAPI.onEyeMove((dx, dy) => {
  const effectiveDx = miniLeftFlip ? -dx : dx;
  lastEyeDx = effectiveDx;
  lastEyeDy = dy;
  // Detect stale eye targets (e.g. after DWM z-order recovery invalidates contentDocument)
  if (eyeTarget && !eyeTarget.ownerDocument?.defaultView) {
    eyeTarget = null;
    bodyTarget = null;
    shadowTarget = null;
    if (clawdEl && clawdEl.isConnected) attachEyeTracking(clawdEl);
    return;
  }
  applyEyeMove(effectiveDx, dy);
});

// --- Confetti particle system (attention state celebration) ---
const CONFETTI_COLORS = [
  "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#FF6FB5",
  "#C490E4", "#FF9F45", "#72EFDD", "#F8F9FA", "#FFE66D",
];
const CONFETTI_COUNT = 40;
const CONFETTI_DURATION = 2000;
const CONFETTI_GRAVITY = 0.12;
const CONFETTI_SHAPES = ["rect", "circle"];

let confettiCanvas = null;
let confettiAnimId = null;

function spawnConfetti() {
  // Clean up any running animation
  if (confettiAnimId) { cancelAnimationFrame(confettiAnimId); confettiAnimId = null; }
  if (confettiCanvas) { confettiCanvas.remove(); confettiCanvas = null; }

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  canvas.width = container.offsetWidth || 256;
  canvas.height = container.offsetHeight || 256;
  container.appendChild(canvas);
  confettiCanvas = canvas;

  const ctx2d = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.45;

  // Create particles with random explosion vectors
  const particles = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 2 + Math.random() * 4,
      shape: CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      opacity: 1,
    });
  }

  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    if (elapsed >= CONFETTI_DURATION) {
      cancelAnimationFrame(confettiAnimId);
      confettiAnimId = null;
      canvas.remove();
      confettiCanvas = null;
      return;
    }

    const progress = elapsed / CONFETTI_DURATION;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.vy += CONFETTI_GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;
      // Fade out in the last 40% of duration
      p.opacity = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1;

      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rotation);
      ctx2d.globalAlpha = Math.max(0, p.opacity);
      ctx2d.fillStyle = p.color;

      if (p.shape === "rect") {
        ctx2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx2d.beginPath();
        ctx2d.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();
    }

    confettiAnimId = requestAnimationFrame(animate);
  }

  confettiAnimId = requestAnimationFrame(animate);
}

window.electronAPI.onPlayConfetti(() => spawnConfetti());

// --- Context-aware shake effect (high context usage) ---
let shakeTimer = null;
window.electronAPI.onContextShake((level) => {
  if (shakeTimer) { clearTimeout(shakeTimer); shakeTimer = null; }
  if (!container) return;
  if (level === "CRITICAL") {
    container.style.animation = "ctx-shake-hard 0.4s ease-in-out 3";
  } else if (level === "WARNING") {
    container.style.animation = "ctx-shake-soft 0.5s ease-in-out 2";
  } else {
    container.style.animation = "";
    return;
  }
  shakeTimer = setTimeout(() => { container.style.animation = ""; shakeTimer = null; }, 2000);
});

// Inject shake keyframes into document
(function injectShakeCSS() {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ctx-shake-soft {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-2px); }
      75% { transform: translateX(2px); }
    }
    @keyframes ctx-shake-hard {
      0%, 100% { transform: translateX(0); }
      10% { transform: translateX(-3px) rotate(-1deg); }
      30% { transform: translateX(3px) rotate(1deg); }
      50% { transform: translateX(-3px) rotate(-1deg); }
      70% { transform: translateX(3px) rotate(1deg); }
      90% { transform: translateX(-2px); }
    }
  `;
  document.head.appendChild(style);
})();

// --- Wake from doze (smooth eye opening) ---
window.electronAPI.onWakeFromDoze(() => {
  if (clawdEl && clawdEl.contentDocument) {
    try {
      const eyes = clawdEl.contentDocument.getElementById("eyes-doze");
      if (eyes) eyes.style.transform = "scaleY(1)";
    } catch (e) {}
  }
});

