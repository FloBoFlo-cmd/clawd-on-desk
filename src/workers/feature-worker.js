// feature-worker.js v1.0.0 | lifecycle: active | 2026-04
// Feature Management Worker for Clawd on Desk.
// Scans ~/.clawd/features/ for feature manifests, manages lifecycle.
// Provides API for feature toggle, status, and configuration.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const FEATURES_DIR = path.join(os.homedir(), ".clawd", "features");

// Built-in feature registry (custom features with toggle support)
const BUILTIN_FEATURES = [
  { id: "confetti", name: "Confetti-Partikel", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "context-shake", name: "Context-Aware Shake", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "activity-tracker", name: "Activity Tracker", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "app-detect", name: "Active App Detection", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "achievements", name: "Achievement System", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "learner", name: "Lern-Feature", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "telegram-notify", name: "Telegram Notifications", version: "1.0.0", configKey: "telegramNotify" },
  { id: "sound-effects", name: "Sound Effects", version: "1.0.0", configKey: "soundEnabled" },
  { id: "ambient-sound", name: "Ambient Sound", version: "1.0.0", configKey: "ambientEnabled" },
  { id: "speech-bubbles", name: "Speech Bubbles", version: "1.0.0", configKey: "speechEnabled" },
  { id: "pomodoro", name: "Pomodoro Timer", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "drag-physics", name: "Drag Physics", version: "1.0.0", configKey: null, alwaysOn: true },
  { id: "statusline", name: "StatusLine v2.0", version: "2.0.0", configKey: null, alwaysOn: true },
];

module.exports = function initFeatureWorker(ctx) {
  let externalFeatures = [];

  function scanExternalFeatures() {
    externalFeatures = [];
    try {
      if (!fs.existsSync(FEATURES_DIR)) return;
      const files = fs.readdirSync(FEATURES_DIR).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(FEATURES_DIR, f), "utf8"));
          if (manifest.id && manifest.name) {
            externalFeatures.push({
              id: manifest.id,
              name: manifest.name,
              version: manifest.version || "0.0.0",
              enabled: manifest.enabled !== false,
              config: manifest.config || {},
              source: "external",
              file: f,
            });
          }
        } catch {}
      }
    } catch {}
  }

  function getAllFeatures() {
    scanExternalFeatures();
    const builtins = BUILTIN_FEATURES.map((f) => ({
      id: f.id,
      name: f.name,
      version: f.version,
      enabled: f.alwaysOn ? true : (ctx.getPrefs ? !!ctx.getPrefs(f.configKey) : true),
      source: "builtin",
      configKey: f.configKey,
    }));
    return [...builtins, ...externalFeatures];
  }

  function toggleFeature(featureId, enabled) {
    // Built-in features with configKey
    const builtin = BUILTIN_FEATURES.find((f) => f.id === featureId);
    if (builtin && builtin.configKey && ctx.setPrefs) {
      ctx.setPrefs(builtin.configKey, enabled);
      return { ok: true, id: featureId, enabled };
    }
    // External features
    const ext = externalFeatures.find((f) => f.id === featureId);
    if (ext) {
      try {
        const filePath = path.join(FEATURES_DIR, ext.file);
        const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
        manifest.enabled = enabled;
        fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
        return { ok: true, id: featureId, enabled };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    return { ok: false, error: "feature not found" };
  }

  function getStats() {
    const all = getAllFeatures();
    return {
      total: all.length,
      enabled: all.filter((f) => f.enabled).length,
      builtin: all.filter((f) => f.source === "builtin").length,
      external: all.filter((f) => f.source === "external").length,
    };
  }

  return { getAllFeatures, toggleFeature, getStats, scanExternalFeatures };
};
