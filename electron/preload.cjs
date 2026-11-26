const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("auroraAI", {
  status: () => ipcRenderer.invoke("aurora:ai-status"),
  request: (payload) => ipcRenderer.invoke("aurora:ai-request", payload),
  team: (payload) => ipcRenderer.invoke("aurora:team-run", payload),
  ensemble: (payload) => ipcRenderer.invoke("aurora:ensemble-run", payload),
  onTeamProgress: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on("aurora:team-progress", h);
    return () => ipcRenderer.removeListener("aurora:team-progress", h);
  },
});
