// app-detect.js v1.0.0 | lifecycle: active | 2026-04
// Detects the currently focused application on macOS.
// Polls every 5 seconds (not every tick — too expensive).

"use strict";
const { execFile } = require("child_process");

const APP_CATEGORIES = {
  "Terminal": "terminal",
  "iTerm": "terminal",
  "Warp": "terminal",
  "Alacritty": "terminal",
  "Code": "editor",
  "Cursor": "editor",
  "Xcode": "editor",
  "IntelliJ": "editor",
  "Safari": "browser",
  "Chrome": "browser",
  "Firefox": "browser",
  "Arc": "browser",
  "Finder": "files",
  "Slack": "chat",
  "Discord": "chat",
  "Telegram": "chat",
  "Notion": "notes",
  "Obsidian": "notes",
};

module.exports = function initAppDetect() {
  let currentApp = "";
  let currentCategory = "unknown";
  let pollTimer = null;

  function detect() {
    if (process.platform !== "darwin") return;
    execFile("osascript", [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ], { timeout: 2000 }, (err, stdout) => {
      if (err) return;
      const app = stdout.trim();
      if (app && app !== currentApp) {
        currentApp = app;
        currentCategory = "unknown";
        for (const [pattern, cat] of Object.entries(APP_CATEGORIES)) {
          if (app.includes(pattern)) { currentCategory = cat; break; }
        }
      }
    });
  }

  function start() {
    if (pollTimer) return;
    detect();
    pollTimer = setInterval(detect, 5000);
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function getActiveApp() {
    return { app: currentApp, category: currentCategory };
  }

  return { start, stop, getActiveApp };
};
