// telegram-bridge.js v1.0.0 | lifecycle: active | 2026-04
// Telegram bridge for Clawd on Desk — superset of notify.js.
// State history ring buffer, enriched notifications, status aggregation.
// Zero external dependencies — uses Node.js built-in https module.

"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const TOKEN_PATH = path.join(os.homedir(), ".telegram_token");
const COOLDOWN_MS = 60000; // 1 notification per event type per 60s
const NOTIFY_STATES = new Set(["error", "attention"]);
const HISTORY_MAX = 20;

module.exports = function initTelegramBridge(ctx) {
  let token = null;
  const lastSent = new Map(); // state → timestamp
  const stateHistory = []; // ring buffer, max HISTORY_MAX
  const startTime = Date.now();

  // ── loadToken ──────────────────────────────────────────────────────
  function loadToken() {
    try {
      token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    } catch {
      token = null;
    }
  }

  loadToken();

  // ── send ───────────────────────────────────────────────────────────
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
      console.warn("Clawd bridge: Telegram send failed:", err.message);
    });
    req.end(payload);
  }

  // ── onStateChange (enriched) ───────────────────────────────────────
  function onStateChange(state, sessionId) {
    const now = Date.now();

    // Always record to ring buffer
    const entry = { state, sessionId, ts: now };
    if (stateHistory.length >= HISTORY_MAX) stateHistory.shift();
    stateHistory.push(entry);

    // Notifications only for error/attention with cooldown
    if (!ctx.telegramNotify || !NOTIFY_STATES.has(state)) return;

    const last = lastSent.get(state) || 0;
    if (now - last < COOLDOWN_MS) return;
    lastSent.set(state, now);

    // Enrich message
    const session = ctx.sessions ? ctx.sessions.get(sessionId) : null;
    const folder = session && session.cwd ? path.basename(session.cwd) : "unknown";
    const agentId = session && session.agentId ? session.agentId : "claude-code";
    const sessionCount = ctx.sessions ? ctx.sessions.size : 0;

    // Duration since session start (if available)
    let duration = "";
    if (session && session.startedAt) {
      const secs = Math.floor((now - session.startedAt) / 1000);
      if (secs >= 3600) {
        duration = ` | ${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
      } else if (secs >= 60) {
        duration = ` | ${Math.floor(secs / 60)}m${secs % 60}s`;
      } else {
        duration = ` | ${secs}s`;
      }
    }

    const sessionInfo = sessionCount > 1 ? ` (${sessionCount} Sessions)` : "";

    if (state === "error") {
      send(`Clawd: Fehler in "${folder}" [${agentId}]${duration}${sessionInfo}`);
    } else if (state === "attention") {
      send(`Clawd: Task abgeschlossen in "${folder}" [${agentId}]${duration}${sessionInfo}`);
    }
  }

  // ── notifyPermissionTimeout ────────────────────────────────────────
  function notifyPermissionTimeout(toolName, sessionId) {
    if (!ctx.telegramNotify) return;
    const now = Date.now();
    const last = lastSent.get("permission") || 0;
    if (now - last < COOLDOWN_MS) return;
    lastSent.set("permission", now);
    send(`Clawd: Permission wartet auf Antwort (${toolName})`);
  }

  // ── getStateHistory ────────────────────────────────────────────────
  function getStateHistory() {
    return stateHistory.slice(); // shallow copy
  }

  // ── getCurrentStatus ───────────────────────────────────────────────
  function getCurrentStatus() {
    const sessions = [];
    if (ctx.sessions) {
      for (const [sid, s] of ctx.sessions) {
        sessions.push({
          id: sid,
          state: s.state || "unknown",
          agentId: s.agentId || "claude-code",
          folder: s.cwd ? path.basename(s.cwd) : null,
          editor: s.editor || null,
          headless: s.headless || false,
        });
      }
    }

    const pomodoroStatus = ctx.getPomodoroStatus ? ctx.getPomodoroStatus() : null;
    const activity = ctx.getActivity ? ctx.getActivity() : null;

    return {
      state: ctx.currentState || "idle",
      sessions,
      sessionCount: sessions.length,
      dnd: ctx.doNotDisturb || false,
      miniMode: ctx.miniMode || false,
      pomodoro: pomodoroStatus,
      activity,
      telegramNotify: ctx.telegramNotify || false,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      historySize: stateHistory.length,
    };
  }

  return { onStateChange, notifyPermissionTimeout, loadToken, getStateHistory, getCurrentStatus };
};
