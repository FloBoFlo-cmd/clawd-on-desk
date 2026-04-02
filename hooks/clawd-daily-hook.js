#!/usr/bin/env node
// clawd-daily-hook.js v1.0.0 | lifecycle: active | 2026-04
// Daily learning hook — runs on SessionStart, analyzes yesterday's activity,
// updates knowledge store, generates tip of the day.
// Registered as SessionStart hook (runs once per session start).

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const CLAWD_DIR = path.join(os.homedir(), ".clawd");
const ACTIVITY_PATH = path.join(CLAWD_DIR, "activity.json");
const MARKER_PATH = path.join(CLAWD_DIR, "daily-analyzed.marker");

// Only run once per day
const today = new Date().toISOString().split("T")[0];
try {
  const marker = fs.readFileSync(MARKER_PATH, "utf8").trim();
  if (marker === today) process.exit(0); // already ran today
} catch {}

// Read activity data
let activity;
try {
  activity = JSON.parse(fs.readFileSync(ACTIVITY_PATH, "utf8"));
} catch {
  process.exit(0); // no activity data yet
}

// Initialize learner and analyze
try {
  const initLearner = require("../src/learner");
  const learner = initLearner();
  const report = learner.analyzeDay(activity);

  if (report) {
    // Write marker to prevent re-running today
    fs.mkdirSync(CLAWD_DIR, { recursive: true });
    fs.writeFileSync(MARKER_PATH, today);

    // Log tip of the day to stderr (visible in hook output if debug)
    const tip = learner.getTipOfTheDay();
    if (tip) {
      process.stderr.write(`[clawd-daily] Tip: ${tip.text}\n`);
    }
  }
} catch (e) {
  process.stderr.write(`[clawd-daily] Error: ${e.message}\n`);
}

process.exit(0);
