const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // State sync from main
  onStateChange: (callback) => ipcRenderer.on("state-change", (_, state, svg) => callback(state, svg)),
  onEyeMove: (callback) => ipcRenderer.on("eye-move", (_, dx, dy) => callback(dx, dy)),
  onWakeFromDoze: (callback) => ipcRenderer.on("wake-from-doze", () => callback()),
  onDndChange: (callback) => ipcRenderer.on("dnd-change", (_, enabled) => callback(enabled)),
  onMiniModeChange: (cb) => ipcRenderer.on("mini-mode-change", (_, enabled, edge) => cb(enabled, edge)),
  // Sound effects
  onPlaySound: (cb) => ipcRenderer.on("play-sound", (_, sound) => cb(sound)),
  // Ambient sound
  onStartAmbient: (cb) => ipcRenderer.on("start-ambient", () => cb()),
  onStopAmbient: (cb) => ipcRenderer.on("stop-ambient", () => cb()),
  // Confetti effect
  onPlayConfetti: (cb) => ipcRenderer.on("play-confetti", () => cb()),
  // Context shake
  onContextShake: (cb) => ipcRenderer.on("context-shake", (_, level) => cb(level)),
  // Reaction control (from main, relayed from hit window)
  onStartDragReaction: (cb) => ipcRenderer.on("start-drag-reaction", () => cb()),
  onEndDragReaction: (cb) => ipcRenderer.on("end-drag-reaction", () => cb()),
  onPlayClickReaction: (cb) => ipcRenderer.on("play-click-reaction", (_, svg, duration) => cb(svg, duration)),
  // Render window → main (cursor polling control during reactions)
  pauseCursorPolling: () => ipcRenderer.send("pause-cursor-polling"),
  resumeFromReaction: () => ipcRenderer.send("resume-from-reaction"),
});
