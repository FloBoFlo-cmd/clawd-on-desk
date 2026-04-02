// chat.js v1.0.0 | lifecycle: active | 2026-04
// Interactive chat bubble system for Clawd on Desk.
// Shows contextual questions with clickable answer buttons.
// Answers can trigger actions (focus terminal, start pomodoro, enable DND).

"use strict";

const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
const WIN_TOPMOST_LEVEL = "pop-up-menu";
const LINUX_WINDOW_TYPE = "toolbar";

const BUBBLE_WIDTH = 260;
const BUBBLE_HEIGHT = 110;
const AUTO_DISMISS_MS = 15000;

// Chat triggers: key → question + buttons + cooldown
const CHAT_TRIGGERS = {
  error: {
    text: "Fehler erkannt! Was tun?",
    buttons: [
      { label: "Terminal oeffnen", action: "focus-terminal" },
      { label: "Ignorieren", action: "dismiss" },
    ],
    cooldownMs: 120000, // 2 min
  },
  attention: {
    text: "Task abgeschlossen! Naechster Schritt?",
    buttons: [
      { label: "Weiter arbeiten", action: "dismiss" },
      { label: "Pause (Pomodoro)", action: "start-pomodoro" },
    ],
    cooldownMs: 60000, // 1 min
  },
  longSession: {
    text: "Schon 60min aktiv. Pause machen?",
    buttons: [
      { label: "Ja, Pause!", action: "start-pomodoro" },
      { label: "Spaeter", action: "dismiss" },
    ],
    cooldownMs: 1800000, // 30 min
  },
};

// States that trigger interactive chat (subset of all states)
const CHAT_STATES = new Set(["error", "attention"]);

function buildBubbleHtml(trigger) {
  const escaped = trigger.text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const btns = trigger.buttons
    .map(
      (b) =>
        `<button onclick="choose('${b.action}')">${b.label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</button>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;height:100%;width:100%;-webkit-app-region:no-drag}
body{display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px}
.chat{
  background:rgba(30,30,30,0.94);
  color:#fff;
  padding:12px 16px;
  border-radius:14px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:13px;
  max-width:${BUBBLE_WIDTH - 20}px;
  text-align:center;
  box-shadow:0 2px 12px rgba(0,0,0,0.4);
  animation:fadeIn 0.25s ease-out;
  position:relative;
  line-height:1.35;
}
.chat::after{
  content:"";
  position:absolute;
  bottom:-6px;
  left:50%;
  transform:translateX(-50%);
  width:0;height:0;
  border-left:6px solid transparent;
  border-right:6px solid transparent;
  border-top:6px solid rgba(30,30,30,0.94);
}
.text{margin-bottom:10px;font-weight:500}
.btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
button{
  background:rgba(255,255,255,0.12);
  color:#fff;
  border:1px solid rgba(255,255,255,0.2);
  border-radius:8px;
  padding:6px 14px;
  font-size:12px;
  font-family:inherit;
  cursor:pointer;
  transition:background 0.15s,border-color 0.15s;
  white-space:nowrap;
}
button:hover{background:rgba(255,255,255,0.22);border-color:rgba(255,255,255,0.35)}
button:active{background:rgba(255,255,255,0.30)}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeOut{from{opacity:1}to{opacity:0;transform:translateY(4px)}}
.chat.fade-out{animation:fadeOut 0.2s ease-in forwards}
</style></head><body>
<div class="chat" id="bubble">
  <div class="text">${escaped}</div>
  <div class="btns">${btns}</div>
</div>
<script>
  function choose(action) {
    // Communicate via query param on navigation (no preload needed)
    document.getElementById("bubble").classList.add("fade-out");
    setTimeout(() => {
      window.location.href = "about:blank#action=" + encodeURIComponent(action);
    }, 180);
  }
</script>
</body></html>`;
}

module.exports = function initChat(ctx) {
  let chatWin = null;
  let hideTimer = null;
  let lastTriggerTime = {}; // key → timestamp
  let sessionTimer = null;
  let sessionStartTime = 0;

  const LONG_SESSION_CHECK_MS = 60000; // check every 60s
  const LONG_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 60 min

  function show(triggerKey, trigger) {
    if (!ctx.chatEnabled || ctx.doNotDisturb) return;

    // Cooldown check
    const now = Date.now();
    const last = lastTriggerTime[triggerKey] || 0;
    if (trigger.cooldownMs && now - last < trigger.cooldownMs) return;
    lastTriggerTime[triggerKey] = now;

    hide(); // close existing chat bubble

    const winBounds = ctx.getWinBounds();
    if (!winBounds) return;

    const x = Math.round(winBounds.x + winBounds.width / 2 - BUBBLE_WIDTH / 2);
    const y = Math.round(winBounds.y - BUBBLE_HEIGHT - 8);

    chatWin = new BrowserWindow({
      x,
      y,
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true, // needs focus for button clicks
      resizable: false,
      hasShadow: false,
      ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
      ...(isMac ? { type: "panel", roundedCorners: false } : {}),
      webPreferences: { contextIsolation: true },
    });

    if (isWin) {
      chatWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }

    const html = buildBubbleHtml(trigger);
    chatWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    chatWin.showInactive();
    if (isLinux) chatWin.setSkipTaskbar(true);
    ctx.reapplyMacVisibility(chatWin);
    if (ctx.guardAlwaysOnTop) ctx.guardAlwaysOnTop(chatWin);

    // Listen for navigation-based action signal from buttons
    chatWin.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      const hash = url.split("#")[1] || "";
      const match = hash.match(/^action=(.+)$/);
      if (match) {
        const action = decodeURIComponent(match[1]);
        handleAction(action);
      }
    });

    // Also listen for did-navigate-in-page for hash changes
    chatWin.webContents.on("did-navigate-in-page", (event, url) => {
      const hash = url.split("#")[1] || "";
      const match = hash.match(/^action=(.+)$/);
      if (match) {
        const action = decodeURIComponent(match[1]);
        handleAction(action);
      }
    });

    chatWin.on("closed", () => {
      chatWin = null;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });

    // Auto-dismiss after timeout
    hideTimer = setTimeout(() => hide(), AUTO_DISMISS_MS);
  }

  function showForState(state) {
    if (!ctx.chatEnabled || ctx.doNotDisturb) return;
    if (!CHAT_STATES.has(state)) return;
    const trigger = CHAT_TRIGGERS[state];
    if (trigger) show(state, trigger);
  }

  function handleAction(action) {
    hide();
    switch (action) {
      case "focus-terminal":
        if (ctx.focusTerminal) ctx.focusTerminal();
        break;
      case "start-pomodoro":
        if (ctx.startPomodoro) ctx.startPomodoro();
        break;
      case "enable-dnd":
        if (ctx.enableDND) ctx.enableDND();
        break;
      case "dismiss":
        // Already hidden above
        break;
    }
  }

  function hide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.destroy();
    }
    chatWin = null;
  }

  // Long session detection: start timer when first working state arrives
  function startSessionTimer() {
    if (sessionTimer) return; // already running
    sessionStartTime = Date.now();
    sessionTimer = setInterval(() => {
      if (!ctx.chatEnabled || ctx.doNotDisturb) return;
      const elapsed = Date.now() - sessionStartTime;
      if (elapsed >= LONG_SESSION_THRESHOLD_MS) {
        const trigger = CHAT_TRIGGERS.longSession;
        if (trigger) show("longSession", trigger);
      }
    }, LONG_SESSION_CHECK_MS);
  }

  function resetSessionTimer() {
    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
    sessionStartTime = 0;
  }

  // Called from state machine when sessions change
  function onSessionActivity(activeSessions) {
    if (activeSessions > 0) {
      startSessionTimer();
    } else {
      resetSessionTimer();
    }
  }

  function cleanup() {
    hide();
    resetSessionTimer();
  }

  return { show, showForState, hide, cleanup, onSessionActivity, resetSessionTimer };
};
