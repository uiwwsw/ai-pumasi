const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("auroraAI", {
  status: () => ipcRenderer.invoke("aurora:ai-status"),
  // The UI language, so main-process messages and dialogs match the window.
  setLang: (lang) => ipcRenderer.invoke("aurora:set-lang", lang),
  request: (payload) => ipcRenderer.invoke("aurora:ai-request", payload),
  team: (payload) => ipcRenderer.invoke("aurora:team-run", payload),
  ensemble: (payload) => ipcRenderer.invoke("aurora:ensemble-run", payload),
  // Write-only: the window can save, replace or remove a key and see whether one is set.
  // There is deliberately no way to read a saved key back.
  secrets: {
    list: () => ipcRenderer.invoke("aurora:secrets-list"),
    set: (name, value) => ipcRenderer.invoke("aurora:secrets-set", name, value),
    remove: (name) => ipcRenderer.invoke("aurora:secrets-remove", name),
    setCompatUrl: (url) => ipcRenderer.invoke("aurora:secrets-compat-url", url),
    openSignup: (host) => ipcRenderer.invoke("aurora:open-signup", host),
  },
  usage: {
    get: () => ipcRenderer.invoke("aurora:usage-get"),
    setEnabled: (enabled) => ipcRenderer.invoke("aurora:usage-set", enabled),
    clear: () => ipcRenderer.invoke("aurora:usage-clear"),
  },
  // Pumasi: states and token counts only. Task and result text never comes to the window.
  pumasi: {
    state: () => ipcRenderer.invoke("aurora:pumasi-state"),
    update: (patch) => ipcRenderer.invoke("aurora:pumasi-update", patch),
    join: (invite) => ipcRenderer.invoke("aurora:pumasi-join", invite),
    open: () => ipcRenderer.invoke("aurora:pumasi-open"),
    help: (slotId) => ipcRenderer.invoke("aurora:pumasi-help", slotId),
    onProgress: (fn) => {
      const h = (_e, data) => fn(data);
      ipcRenderer.on("aurora:pumasi-progress", h);
      return () => ipcRenderer.removeListener("aurora:pumasi-progress", h);
    },
  },
  onTeamProgress: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on("aurora:team-progress", h);
    return () => ipcRenderer.removeListener("aurora:team-progress", h);
  },
});
