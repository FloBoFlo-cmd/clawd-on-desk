// sounds.js v1.1.0 | lifecycle: active | 2026-04
// Sound effect manager for Clawd on Desk.
// Triggers synthesized sounds via IPC to the renderer's Web Audio API.
// No external audio files needed — all sounds are programmatically generated.

"use strict";

// State → sound definition mapping
// Each sound: { freq, duration, type, ramp? }
const SOUND_MAP = {
  thinking:     { freq: 880, duration: 0.15, type: "sine" },
  error:        { freq: 220, duration: 0.30, type: "sawtooth" },
  attention:    { freq: 1047, freq2: 1319, duration: 0.20, type: "sine" },
  notification: { freq: 660, duration: 0.20, type: "triangle" },
  sleeping:     { freq: 330, duration: 0.40, type: "sine", volume: 0.15 },
};

// States that should NOT trigger sounds (too frequent / transitions)
const SILENT_STATES = new Set(["idle", "working", "dozing", "collapsing", "waking", "yawning"]);

module.exports = function initSounds(ctx) {

  let ambientActive = false;

  function playForState(state) {
    if (!ctx.soundEnabled) return;
    if (SILENT_STATES.has(state)) return;
    if (state.startsWith("mini-")) return;

    const sound = SOUND_MAP[state];
    if (!sound) return;

    ctx.sendToRenderer("play-sound", sound);
  }

  function ambientForState(state) {
    const shouldPlay = state === "working" && ctx.ambientEnabled && !ctx.doNotDisturb;
    if (shouldPlay && !ambientActive) {
      ambientActive = true;
      ctx.sendToRenderer("start-ambient");
    } else if (!shouldPlay && ambientActive) {
      ambientActive = false;
      ctx.sendToRenderer("stop-ambient");
    }
  }

  function stopAmbient() {
    if (ambientActive) {
      ambientActive = false;
      ctx.sendToRenderer("stop-ambient");
    }
  }

  return { playForState, ambientForState, stopAmbient, SOUND_MAP };
};
