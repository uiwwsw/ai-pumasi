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
  onTeamProgress: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on("aurora:team-progress", h);
    return () => ipcRenderer.removeListener("aurora:team-progress", h);
  },
});
