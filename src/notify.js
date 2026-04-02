// notify.js v1.0.0 | lifecycle: active | 2026-04
// Telegram notification bridge for Clawd on Desk.
// Sends alerts for important state changes (error, attention, permission timeout).
// Zero external dependencies — uses Node.js built-in https module.

"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const TOKEN_PATH = path.join(os.homedir(), ".telegram_token");
const COOLDOWN_MS = 60000; // 1 notification per event type per 60s
const NOTIFY_STATES = new Set(["error", "attention"]);

module.exports = function initNotify(ctx) {
  let token = null;
  const lastSent = new Map(); // state → timestamp

  function loadToken() {
    try {
      token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    } catch {
      token = null;
    }
  }

  loadToken();

  function send(text) {
    if (!token || !ctx.telegramChatId || !ctx.telegramNotify) return;
    const payload = JSON.stringify({
      chat_id: ctx.telegramChatId,
      text,
      disable_notification: false,
    });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    });
    req.on("error", (err) => {
      console.warn("Clawd notify: Telegram send failed:", err.message);
    });
    req.end(payload);
  }

  function onStateChange(state, sessionId) {
    if (!ctx.telegramNotify || !NOTIFY_STATES.has(state)) return;

    const now = Date.now();
    const last = lastSent.get(state) || 0;
    if (now - last < COOLDOWN_MS) return;
    lastSent.set(state, now);

    const session = ctx.sessions ? ctx.sessions.get(sessionId) : null;
    const folder = session && session.cwd ? path.basename(session.cwd) : sessionId || "unknown";

    if (state === "error") {
      send(`Clawd: Fehler in Session "${folder}"`);
    } else if (state === "attention") {
      send(`Clawd: Task abgeschlossen in "${folder}"`);
    }
  }

  function notifyPermissionTimeout(toolName, sessionId) {
    if (!ctx.telegramNotify) return;
    const now = Date.now();
    const last = lastSent.get("permission") || 0;
    if (now - last < COOLDOWN_MS) return;
    lastSent.set("permission", now);
    send(`Clawd: Permission wartet auf Antwort (${toolName})`);
  }

  return { onStateChange, notifyPermissionTimeout, loadToken };
};
