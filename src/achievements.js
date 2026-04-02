// achievements.js v1.0.0 | lifecycle: active | 2026-04
// Achievement/unlock system for Clawd on Desk.
// Checks milestones against activity data, persists unlocked achievements,
// triggers Electron notifications on first unlock.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ACHIEVEMENTS_PATH = path.join(os.homedir(), ".clawd", "achievements.json");

// Achievement definitions: id, name, description, condition(activity) => boolean
const DEFINITIONS = [
  { id: "first-session", name: "Hello Clawd!", desc: "Erste Session gestartet", check: (a) => a.sessions >= 1 },
  { id: "tool-100", name: "Werkzeugmeister", desc: "100 Tool-Calls an einem Tag", check: (a) => a.toolCalls >= 100 },
  { id: "tool-500", name: "Poweruser", desc: "500 Tool-Calls an einem Tag", check: (a) => a.toolCalls >= 500 },
  { id: "marathon", name: "Marathon-Coder", desc: "5+ Stunden Session-Zeit an einem Tag", check: (a) => a.totalMinutes >= 300 },
  { id: "error-free", name: "Fehlerfrei!", desc: "Ein ganzer Tag ohne Errors", check: (a) => a.sessions >= 3 && a.errors === 0 },
  { id: "streak-3", name: "3-Tage-Streak", desc: "3 Tage in Folge aktiv", check: (a) => (a.streak || 0) >= 3 },
  { id: "streak-7", name: "Wochen-Streak", desc: "7 Tage in Folge aktiv", check: (a) => (a.streak || 0) >= 7 },
  { id: "streak-30", name: "Monats-Streak", desc: "30 Tage in Folge aktiv", check: (a) => (a.streak || 0) >= 30 },
  { id: "multitask", name: "Multitasker", desc: "5+ gleichzeitige Sessions", check: (a) => a.sessions >= 5 },
  { id: "attention-10", name: "Produktiv!", desc: "10 Tasks an einem Tag abgeschlossen", check: (a) => a.attentions >= 10 },
];

module.exports = function initAchievements(ctx) {
  let unlocked = loadUnlocked();

  function loadUnlocked() {
    try {
      const raw = JSON.parse(fs.readFileSync(ACHIEVEMENTS_PATH, "utf8"));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function save() {
    try {
      const dir = path.dirname(ACHIEVEMENTS_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ACHIEVEMENTS_PATH, JSON.stringify(unlocked, null, 2));
    } catch {}
  }

  function check(activity) {
    if (!activity) return;
    const newlyUnlocked = [];

    for (const def of DEFINITIONS) {
      if (unlocked[def.id]) continue;
      try {
        if (def.check(activity)) {
          unlocked[def.id] = { unlockedAt: new Date().toISOString(), name: def.name };
          newlyUnlocked.push(def);
        }
      } catch {}
    }

    if (newlyUnlocked.length > 0) {
      save();
      for (const def of newlyUnlocked) {
        if (ctx.showNotification) {
          ctx.showNotification(`Achievement: ${def.name}`, def.desc);
        }
      }
    }
  }

  function getAll() {
    return DEFINITIONS.map((def) => ({
      id: def.id,
      name: def.name,
      desc: def.desc,
      unlocked: !!unlocked[def.id],
      unlockedAt: unlocked[def.id]?.unlockedAt || null,
    }));
  }

  function getStats() {
    const total = DEFINITIONS.length;
    const done = Object.keys(unlocked).length;
    return { total, unlocked: done, percent: Math.round((done / total) * 100) };
  }

  return { check, getAll, getStats };
};
