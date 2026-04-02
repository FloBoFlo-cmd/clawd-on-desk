// health-worker.js v1.0.0 | lifecycle: active | 2026-04
// Autonomous System Health Monitor for Clawd on Desk.
// Checks: HTTP server, hook registration, memory, zombie sessions.
// Runs every 60s, triggers auto-recovery on failures.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CHECK_INTERVAL_MS = 60000;
const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_MARKER = "clawd-hook.js";

module.exports = function initHealthWorker(ctx) {
  let timer = null;
  let lastCheck = null;
  let status = { ok: true, checks: {}, lastRun: null, recoveries: 0 };

  function checkServer() {
    return new Promise((resolve) => {
      const port = ctx.getPort ? ctx.getPort() : 23333;
      const req = http.get(`http://127.0.0.1:${port}/state`, { timeout: 2000 }, (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve({ ok: data.ok === true, port });
          } catch { resolve({ ok: false, error: "invalid response" }); }
        });
      });
      req.on("error", () => resolve({ ok: false, error: "connection refused" }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    });
  }

  function checkHooks() {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
      const hasHooks = raw.includes(HOOK_MARKER);
      return { ok: hasHooks, registered: hasHooks };
    } catch {
      return { ok: false, error: "settings.json not readable" };
    }
  }

  function checkMemory() {
    const used = process.memoryUsage();
    const heapMB = Math.round(used.heapUsed / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);
    return { ok: heapMB < 500, heapMB, rssMB };
  }

  function checkSessions() {
    if (!ctx.sessions) return { ok: true, count: 0, zombies: 0 };
    let zombies = 0;
    const now = Date.now();
    for (const [, s] of ctx.sessions) {
      if (now - s.updatedAt > 600000 && !s.pidReachable) zombies++;
    }
    return { ok: zombies === 0, count: ctx.sessions.size, zombies };
  }

  async function runChecks() {
    const server = await checkServer();
    const hooks = checkHooks();
    const memory = checkMemory();
    const sessions = checkSessions();

    status = {
      ok: server.ok && hooks.ok && memory.ok && sessions.ok,
      checks: { server, hooks, memory, sessions },
      lastRun: new Date().toISOString(),
      recoveries: status.recoveries,
    };

    // Auto-recovery: re-register hooks if missing
    if (!hooks.ok && ctx.syncHooks) {
      try {
        ctx.syncHooks();
        status.recoveries++;
        status.checks.hooks = { ok: true, recovered: true };
      } catch {}
    }

    lastCheck = status;
    return status;
  }

  function start() {
    if (timer) return;
    runChecks();
    timer = setInterval(() => runChecks(), CHECK_INTERVAL_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function getStatus() { return status; }

  return { start, stop, getStatus, runChecks };
};
