// preload-dashboard.js v1.0.0 | lifecycle: active | 2026-04
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashboardAPI", {
  onUpdate: (cb) => ipcRenderer.on("dashboard-update", (_, data) => cb(data)),
  close: () => ipcRenderer.send("dashboard-close"),
});
