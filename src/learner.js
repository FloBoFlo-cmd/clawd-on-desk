// learner.js v1.0.0 | lifecycle: active | 2026-04
// Learning feature for Clawd on Desk.
// Analyzes daily activity patterns and builds persistent knowledge store.
// Generates daily insights and "tip of the day" suggestions.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const KNOWLEDGE_PATH = path.join(os.homedir(), ".clawd", "knowledge.json");
const CLAWD_DIR = path.join(os.homedir(), ".clawd");

const DEFAULT_KNOWLEDGE = {
  version: 1,
  patterns: {
    peakHours: [],
    avgSessionMinutes: 0,
    commonErrors: [],
    toolPreferences: {},
    avgToolCallsPerDay: 0,
    streakRecord: 0,
  },
  tips: [],
  dailyReports: [],
  lastAnalyzed: null,
};

// Tip definitions based on patterns
const TIP_GENERATORS = [
  {
    id: "break-reminder",
    condition: (k) => k.patterns.avgSessionMinutes > 60,
    text: (k) => `Deine Sessions dauern im Schnitt ${k.patterns.avgSessionMinutes}min. Eine Pause alle 45min steigert die Produktivitaet.`,
  },
  {
    id: "peak-hours",
    condition: (k) => k.patterns.peakHours.length >= 2,
    text: (k) => `Deine produktivsten Stunden: ${k.patterns.peakHours.slice(0, 3).join(", ")} Uhr. Plane komplexe Tasks fuer diese Zeit.`,
  },
  {
    id: "error-pattern",
    condition: (k) => k.patterns.commonErrors.length > 0,
    text: (k) => `Haeufigster Fehlertyp: "${k.patterns.commonErrors[0]}". Vielleicht ein Muster das sich vermeiden laesst?`,
  },
  {
    id: "streak-motivation",
    condition: (k) => k.patterns.streakRecord >= 5,
    text: (k) => `Dein Streak-Rekord: ${k.patterns.streakRecord} Tage! Weiter so.`,
  },
  {
    id: "tool-insight",
    condition: (k) => Object.keys(k.patterns.toolPreferences).length >= 3,
    text: (k) => {
      const sorted = Object.entries(k.patterns.toolPreferences).sort((a, b) => b[1] - a[1]);
      return `Dein meistgenutztes Tool: ${sorted[0][0]} (${sorted[0][1]}x). Gibt es Shortcuts dafuer?`;
    },
  },
];

module.exports = function initLearner() {
  let knowledge = loadKnowledge();

  function loadKnowledge() {
    try {
      const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf8"));
      return raw && raw.version ? raw : { ...DEFAULT_KNOWLEDGE };
    } catch {
      return { ...DEFAULT_KNOWLEDGE };
    }
  }

  function save() {
    try {
      fs.mkdirSync(CLAWD_DIR, { recursive: true });
      fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(knowledge, null, 2));
    } catch {}
  }

  function analyzeDay(activity) {
    if (!activity || !activity.date) return null;

    const today = new Date().toISOString().split("T")[0];
    if (knowledge.lastAnalyzed === today) return null; // already analyzed today

    // Build daily report
    const report = {
      date: activity.date,
      sessions: activity.sessions || 0,
      toolCalls: activity.toolCalls || 0,
      errors: activity.errors || 0,
      totalMinutes: activity.totalMinutes || 0,
      attentions: activity.attentions || 0,
    };

    // Update patterns
    const p = knowledge.patterns;

    // Average session minutes (rolling average over last 7 days)
    const recentReports = [...knowledge.dailyReports.slice(-6), report];
    const totalMin = recentReports.reduce((s, r) => s + (r.totalMinutes || 0), 0);
    p.avgSessionMinutes = Math.round(totalMin / recentReports.length);

    // Average tool calls per day
    const totalCalls = recentReports.reduce((s, r) => s + (r.toolCalls || 0), 0);
    p.avgToolCallsPerDay = Math.round(totalCalls / recentReports.length);

    // Peak hours (detect from session start pattern — approximate from current hour)
    const hour = new Date().getHours();
    if (!p.peakHours.includes(hour) && report.toolCalls > 10) {
      p.peakHours.push(hour);
      p.peakHours.sort((a, b) => a - b);
      if (p.peakHours.length > 5) p.peakHours = p.peakHours.slice(0, 5);
    }

    // Streak record
    if (activity.streak && activity.streak > p.streakRecord) {
      p.streakRecord = activity.streak;
    }

    // Store daily report (keep last 30)
    knowledge.dailyReports.push(report);
    if (knowledge.dailyReports.length > 30) {
      knowledge.dailyReports = knowledge.dailyReports.slice(-30);
    }

    knowledge.lastAnalyzed = today;
    save();

    return report;
  }

  function trackToolUse(toolName) {
    if (!toolName) return;
    const p = knowledge.patterns;
    p.toolPreferences[toolName] = (p.toolPreferences[toolName] || 0) + 1;
    // Keep only top 10 tools
    const sorted = Object.entries(p.toolPreferences).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 10) {
      p.toolPreferences = Object.fromEntries(sorted.slice(0, 10));
    }
  }

  function trackError(errorType) {
    if (!errorType) return;
    const p = knowledge.patterns;
    if (!p.commonErrors.includes(errorType)) {
      p.commonErrors.push(errorType);
      if (p.commonErrors.length > 5) p.commonErrors = p.commonErrors.slice(-5);
    }
  }

  function getTipOfTheDay() {
    const today = new Date().toISOString().split("T")[0];
    for (const gen of TIP_GENERATORS) {
      // Check if already shown today
      const existing = knowledge.tips.find((t) => t.id === gen.id);
      if (existing && existing.lastShown === today) continue;
      try {
        if (gen.condition(knowledge)) {
          const tip = { id: gen.id, text: gen.text(knowledge), lastShown: today };
          // Update or add tip record
          const idx = knowledge.tips.findIndex((t) => t.id === gen.id);
          if (idx >= 0) {
            knowledge.tips[idx].lastShown = today;
            knowledge.tips[idx].shown = (knowledge.tips[idx].shown || 0) + 1;
          } else {
            knowledge.tips.push({ id: gen.id, shown: 1, lastShown: today, useful: 0 });
          }
          save();
          return tip;
        }
      } catch {}
    }
    return null;
  }

  function getKnowledge() {
    return { ...knowledge, tipOfTheDay: getTipOfTheDay() };
  }

  return { analyzeDay, trackToolUse, trackError, getTipOfTheDay, getKnowledge, save };
};
