// speech.js v1.0.0 | lifecycle: active | 2026-04
"use strict";

const { BrowserWindow } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
const WIN_TOPMOST_LEVEL = "pop-up-menu";
const LINUX_WINDOW_TYPE = "toolbar";

const STATE_MESSAGES = {
  thinking: "Hmm, lass mich nachdenken...",
  working: "Arbeite...",
  error: "Oops! Fehler!",
  attention: "Fertig!",
  notification: "Neue Nachricht!",
  sweeping: "Aufraeumen...",
  carrying: "Neuer Worktree!",
  sleeping: "Zzz...",
};

const BUBBLE_DURATION = 3000;
const BUBBLE_WIDTH = 200;
const BUBBLE_HEIGHT = 54;

// States that trigger a speech bubble on every transition
const SPEECH_STATES = new Set(["attention", "error", "notification", "sweeping", "carrying"]);
// States that only trigger on the first transition (not repeated hooks)
const FIRST_ONLY_STATES = new Set(["working", "thinking"]);

module.exports = function initSpeech(ctx) {
  let bubble = null;
  let hideTimer = null;
  let lastFirstOnlyState = null;

  function show(text) {
    if (!ctx.speechEnabled || ctx.doNotDisturb) return;
    hide(); // close existing

    const winBounds = ctx.getWinBounds();
    if (!winBounds) return;

    const x = Math.round(winBounds.x + winBounds.width / 2 - BUBBLE_WIDTH / 2);
    const y = Math.round(winBounds.y - BUBBLE_HEIGHT - 5);

    bubble = new BrowserWindow({
      x,
      y,
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
      ...(isMac ? { type: "panel", roundedCorners: false } : {}),
      webPreferences: { contextIsolation: true },
    });

    if (isWin) {
      bubble.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }

    const escaped = text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;height:100%;width:100%;-webkit-app-region:no-drag}
body{display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px}
.bubble{
  background:rgba(30,30,30,0.92);
  color:#fff;
  padding:8px 14px;
  border-radius:12px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:13px;
  max-width:${BUBBLE_WIDTH - 16}px;
  text-align:center;
  box-shadow:0 2px 10px rgba(0,0,0,0.35);
  animation:fadeIn 0.2s ease-out;
  position:relative;
  line-height:1.3;
}
.bubble::after{
  content:"";
  position:absolute;
  bottom:-6px;
  left:50%;
  transform:translateX(-50%);
  width:0;height:0;
  border-left:6px solid transparent;
  border-right:6px solid transparent;
  border-top:6px solid rgba(30,30,30,0.92);
}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
</style></head><body><div class="bubble">${escaped}</div></body></html>`;

    bubble.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    bubble.showInactive();
    if (isLinux) bubble.setSkipTaskbar(true);
    ctx.reapplyMacVisibility(bubble);

    if (ctx.guardAlwaysOnTop) ctx.guardAlwaysOnTop(bubble);

    hideTimer = setTimeout(() => hide(), BUBBLE_DURATION);
  }

  function showForState(state, sessionId) {
    if (!ctx.speechEnabled || ctx.doNotDisturb) return;

    // Only show for designated states
    const isSpeechState = SPEECH_STATES.has(state);
    const isFirstOnly = FIRST_ONLY_STATES.has(state);

    if (!isSpeechState && !isFirstOnly) {
      // Transitioning away from a first-only state resets tracking
      if (lastFirstOnlyState && state !== lastFirstOnlyState) {
        lastFirstOnlyState = null;
      }
      return;
    }

    // For first-only states: skip if we already showed for this state
    if (isFirstOnly) {
      if (lastFirstOnlyState === state) return;
      lastFirstOnlyState = state;
    } else {
      lastFirstOnlyState = null;
    }

    // Build contextual message — find the most recently updated session for context
    let session = null;
    if (ctx.sessions) {
      if (sessionId) {
        session = ctx.sessions.get(sessionId);
      } else {
        // Pick the most recently updated non-headless session
        let bestAt = -1;
        for (const [, s] of ctx.sessions) {
          if (s.headless) continue;
          if (s.updatedAt > bestAt) { bestAt = s.updatedAt; session = s; }
        }
      }
    }
    const folder = session && session.cwd ? path.basename(session.cwd) : "";

    let text = STATE_MESSAGES[state];
    if (!text) return;

    if (state === "working" && folder) text = `Arbeite an ${folder}...`;
    if (state === "error" && folder) text = `Fehler in ${folder}!`;
    if (state === "attention" && folder) text = `${folder} fertig!`;

    show(text);
  }

  function hide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (bubble && !bubble.isDestroyed()) {
      bubble.destroy();
    }
    bubble = null;
  }

  function cleanup() {
    hide();
  }

  return { show, showForState, hide, cleanup };
};
