// pomodoro.js v1.0.0 | lifecycle: active | 2026-04
"use strict";

const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;

module.exports = function initPomodoro(ctx) {
  let timer = null;
  let phase = "idle"; // idle, focus, break
  let startedAt = null;
  let pomodoroCount = 0;

  function start() {
    if (phase !== "idle") return;
    phase = "focus";
    startedAt = Date.now();
    if (ctx.onPomodoroChange) ctx.onPomodoroChange(phase, FOCUS_MS);
    timer = setTimeout(() => startBreak(), FOCUS_MS);
  }

  function startBreak() {
    phase = "break";
    startedAt = Date.now();
    pomodoroCount++;
    if (ctx.enableDND) ctx.enableDND();
    if (ctx.onPomodoroChange) ctx.onPomodoroChange(phase, BREAK_MS);
    timer = setTimeout(() => endBreak(), BREAK_MS);
  }

  function endBreak() {
    phase = "idle";
    startedAt = null;
    if (ctx.disableDND) ctx.disableDND();
    if (ctx.onPomodoroChange) ctx.onPomodoroChange(phase, 0);
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (phase === "break" && ctx.disableDND) ctx.disableDND();
    phase = "idle";
    startedAt = null;
    if (ctx.onPomodoroChange) ctx.onPomodoroChange(phase, 0);
  }

  function getStatus() {
    if (phase === "idle") return { phase, remaining: 0, count: pomodoroCount };
    const elapsed = Date.now() - startedAt;
    const total = phase === "focus" ? FOCUS_MS : BREAK_MS;
    const remaining = Math.max(0, total - elapsed);
    return { phase, remaining, count: pomodoroCount };
  }

  return { start, stop, getStatus };
};
