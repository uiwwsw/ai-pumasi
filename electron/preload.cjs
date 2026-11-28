const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("auroraAI", {
  status: () => ipcRenderer.invoke("aurora:ai-status"),
  // The UI language, so main-process messages and dialogs match the window.
  setLang: (lang) => ipcRenderer.invoke("aurora:set-lang", lang),
  request: (payload) => ipcRenderer.invoke("aurora:ai-request", payload),
  team: (payload) => ipcRenderer.invoke("aurora:team-run", payload),
  // Write-only: the window can save, replace or remove a key and see whether one is set.
  // There is deliberately no way to read a saved key back.
  secrets: {
    list: () => ipcRenderer.invoke("aurora:secrets-list"),
    set: (name, value) => ipcRenderer.invoke("aurora:secrets-set", name, value),
    add: (value) => ipcRenderer.invoke("aurora:secrets-add", value),
    openRouterLogin: () => ipcRenderer.invoke("aurora:openrouter-login"),
    openRouterCancel: () => ipcRenderer.invoke("aurora:openrouter-cancel"),
    remove: (name) => ipcRenderer.invoke("aurora:secrets-remove", name),
    setCompatUrl: (url) => ipcRenderer.invoke("aurora:secrets-compat-url", url),
    openSignup: (host) => ipcRenderer.invoke("aurora:open-signup", host),
  },
  // Pumasi: states and token counts only. Task and result text never comes to the window.
  pumasi: {
    state: () => ipcRenderer.invoke("aurora:pumasi-state"),
    update: (patch) => ipcRenderer.invoke("aurora:pumasi-update", patch),
    join: (invite) => ipcRenderer.invoke("aurora:pumasi-join", invite),
    open: () => ipcRenderer.invoke("aurora:pumasi-open"),
    help: (slotId) => ipcRenderer.invoke("aurora:pumasi-help", slotId),
    // Share one question with other users; the answer comes back to the asker.
    ask: (text) => ipcRenderer.invoke("aurora:pumasi-ask", text),
    askCancel: () => ipcRenderer.invoke("aurora:pumasi-ask-cancel"),
    onAskProgress: (fn) => {
      const h = (_e, data) => fn(data);
      ipcRenderer.on("aurora:pumasi-ask-progress", h);
      return () => ipcRenderer.removeListener("aurora:pumasi-ask-progress", h);
    },
    onProgress: (fn) => {
      const h = (_e, data) => fn(data);
      ipcRenderer.on("aurora:pumasi-progress", h);
      return () => ipcRenderer.removeListener("aurora:pumasi-progress", h);
    },
  },
  // Code mode: files inside the one folder picked in the system dialog.
  code: {
    open: () => ipcRenderer.invoke("aurora:code-open"),
    current: () => ipcRenderer.invoke("aurora:code-current"),
    list: (rel) => ipcRenderer.invoke("aurora:code-list", rel),
    read: (rel) => ipcRenderer.invoke("aurora:code-read", rel),
    // The window cannot write files itself: the agent saves a change only after the user approves it.
    run: (payload) => ipcRenderer.invoke("aurora:agent-run", payload),
    answer: (id, allow, all) => ipcRenderer.invoke("aurora:agent-answer", id, allow, all),
    // Undo a change the agent saved; the main process restores what it kept, the window sends only the id.
    undo: (id) => ipcRenderer.invoke("aurora:code-undo", id),
    gitStatus: () => ipcRenderer.invoke("aurora:code-git-status"),
    gitDiff: (rel) => ipcRenderer.invoke("aurora:code-git-diff", rel),
    stop: () => ipcRenderer.invoke("aurora:agent-stop"),
    onEvent: (fn) => {
      const h = (_e, data) => fn(data);
      ipcRenderer.on("aurora:agent-event", h);
      return () => ipcRenderer.removeListener("aurora:agent-event", h);
    },
  },
  // The answer so far while it streams in (plain answers only).
  // The app decides how to work on a question; progress says what is actually happening.
  ask: (payload) => ipcRenderer.invoke("aurora:ask", payload),
  // A program a model wrote is run in the window's sandboxed frame; the result goes back.
  onRunCode: (fn) => {
    const h = async (_e, id, code) => {
      let result;
      try {
        result = await fn(code);
      } catch (error) {
        result = { ok: false, out: "", error: String(error?.message ?? error) };
      }
      ipcRenderer.send("aurora:code-ran", id, result);
    };
    ipcRenderer.on("aurora:run-code", h);
    return () => ipcRenderer.removeListener("aurora:run-code", h);
  },
  askControl: (action, partId) => ipcRenderer.invoke("aurora:ask-control", action, partId),
  onAskProgress: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on("aurora:ask-progress", h);
    return () => ipcRenderer.removeListener("aurora:ask-progress", h);
  },
  onAnswerDelta: (fn) => {
    const h = (_e, text) => fn(text);
    ipcRenderer.on("aurora:ai-delta", h);
    return () => ipcRenderer.removeListener("aurora:ai-delta", h);
  },
  onTeamProgress: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on("aurora:team-progress", h);
    return () => ipcRenderer.removeListener("aurora:team-progress", h);
  },
});
