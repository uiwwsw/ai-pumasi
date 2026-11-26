const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("auroraAI", {
  status: () => ipcRenderer.invoke("aurora:ai-status"),
  request: (payload) => ipcRenderer.invoke("aurora:ai-request", payload),
  team: (payload) => ipcRenderer.invoke("aurora:team-run", payload),
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
