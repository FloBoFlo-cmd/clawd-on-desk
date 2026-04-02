// activity.js v1.0.0 | lifecycle: active | 2026-04
// Activity tracker — counts events per day, persists to ~/.clawd/activity.json

const fs = require("fs");
const path = require("path");
const os = require("os");

const ACTIVITY_PATH = path.join(os.homedir(), ".clawd", "activity.json");

module.exports = function initActivity() {
  let data = loadActivity();

  function loadActivity() {
    try {
      const raw = JSON.parse(fs.readFileSync(ACTIVITY_PATH, "utf8"));
      if (raw.date === today()) return raw;
      return newDay(raw);
    } catch {
      return newDay(null);
    }
  }

  function today() {
    return new Date().toISOString().split("T")[0];
  }

  function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }

  function newDay(prev) {
    return {
      date: today(),
      toolCalls: 0,
      sessions: 0,
      errors: 0,
      attentions: 0,
      sessionStartTime: null,
      totalMinutes: 0,
      streak: prev && prev.date === yesterday() ? (prev.streak || 0) + 1 : 1,
      history: prev
        ? [
            ...(prev.history || []).slice(-6),
            {
              date: prev.date,
              toolCalls: prev.toolCalls,
              errors: prev.errors,
              totalMinutes: prev.totalMinutes,
            },
          ]
        : [],
    };
  }

  function track(event, state) {
    if (data.date !== today()) data = newDay(data);

    if (event === "PreToolUse" || event === "PostToolUse") data.toolCalls++;
    if (event === "SessionStart") {
      data.sessions++;
      data.sessionStartTime = Date.now();
    }
    if (state === "error") data.errors++;
    if (state === "attention") data.attentions++;
    if (event === "SessionEnd" && data.sessionStartTime) {
      data.totalMinutes += Math.round(
        (Date.now() - data.sessionStartTime) / 60000
      );
      data.sessionStartTime = null;
    }

    save();
  }

  function save() {
    try {
      const dir = path.dirname(ACTIVITY_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(data, null, 2));
    } catch {}
  }

  function getActivity() {
    return { ...data };
  }

  return { track, getActivity };
};
