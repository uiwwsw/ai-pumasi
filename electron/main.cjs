const {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  ipcMain,
  dialog,
  Menu,
  safeStorage,
  shell,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const providers = require("./providers.cjs");
const { createSecretStore, redact } = require("./secrets.cjs");
app.setName("AI Pumasi");
app.setAppUserModelId("com.uiwwsw.aurora");
// The app was called Aurora until 0.1.8. Keep using that folder so conversations, settings and
// saved keys carry over; new installs get a folder under the new name.
const legacyData = path.join(app.getPath("appData"), "Aurora");
if (!process.env.AURORA_QA_DATA && fs.existsSync(legacyData)) {
  app.setPath("userData", legacyData);
  app.setPath("sessionData", legacyData);
}
const envFile = app.isPackaged
  ? path.join(app.getPath("userData"), ".env")
  : path.join(__dirname, "../.env");
if (!process.env.AURORA_DISABLE_ENV_FILE && fs.existsSync(envFile))
  process.loadEnvFile(envFile);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "aurora",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
// QA data and caches stay on the external build volume. Normal app data uses the OS app directory.
if (process.env.AURORA_QA_DATA) {
  app.setPath("userData", process.env.AURORA_QA_DATA);
  app.setPath("sessionData", path.join(process.env.AURORA_QA_DATA, "session"));
}
function createWindow() {
  const win = new BrowserWindow({
    title: "AI Pumasi",
    width: 1440,
    height: 940,
    minWidth: 800,
    minHeight: 620,
    backgroundColor: "#faf9f6",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 22 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadURL("aurora://app/index.html");
}
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else
  app.whenReady().then(() => {
    app.on("second-instance", () => {
      const current = BrowserWindow.getAllWindows()[0];
      if (current) {
        if (current.isMinimized()) current.restore();
        current.show();
        current.focus();
      } else createWindow();
    });
    const authorized = (event) =>
      event.senderFrame?.url === "aurora://app/index.html" &&
      BrowserWindow.fromWebContents(event.sender);
    const inFlight = new Set();
    // Keys saved in Settings, encrypted by the OS keychain. Decrypted here only, per call.
    const secrets = createSecretStore({
      file: path.join(app.getPath("userData"), "secrets.json"),
      safeStorage,
    });
    // Exact saved values never leave the main process, even inside an error or a model result.
    const scrub = (value, env) => {
      if (typeof value === "string")
        return redact(value, env, { patterns: false });
      if (Array.isArray(value)) return value.map((v) => scrub(v, env));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, scrub(v, env)]),
        );
      return value;
    };
    const guarded = async (env, fn) => {
      try {
        return scrub(await fn(), env);
      } catch (error) {
        throw new Error(redact(error?.message ?? String(error), env));
      }
    };
    ipcMain.handle("aurora:secrets-list", (event) => {
      if (!authorized(event)) throw new Error("Forbidden");
      return secrets.list();
    });
    ipcMain.handle("aurora:secrets-set", (event, name, value) => {
      if (!authorized(event)) throw new Error("Forbidden");
      try {
        return secrets.set(name, value);
      } catch (error) {
        throw new Error(
          redact(error?.message ?? "저장하지 못했습니다.", { [name]: value }),
        );
      }
    });
    ipcMain.handle("aurora:secrets-remove", (event, name) => {
      if (!authorized(event)) throw new Error("Forbidden");
      return secrets.remove(name);
    });
    // Where each provider hands out keys. The window names a provider; it never passes a URL.
    const SIGNUP = {
      nvidia: "https://build.nvidia.com/settings/api-keys",
      groq: "https://console.groq.com/keys",
      openrouter: "https://openrouter.ai/settings/keys",
      gemini: "https://aistudio.google.com/apikey",
      openai: "https://platform.openai.com/api-keys",
      anthropic: "https://console.anthropic.com/settings/keys",
    };
    ipcMain.handle("aurora:open-signup", (event, host) => {
      if (!authorized(event)) throw new Error("Forbidden");
      if (!Object.hasOwn(SIGNUP, host))
        throw new Error("알 수 없는 제공자입니다.");
      return shell.openExternal(SIGNUP[host]);
    });
    ipcMain.handle("aurora:secrets-compat-url", (event, url) => {
      if (!authorized(event)) throw new Error("Forbidden");
      return secrets.setCompatUrl(url);
    });
    let workerStats;
    // Per-model success and latency only: model ids and numbers, never keys or prompts.
    const stats = () =>
      (workerStats ??= require("./worker-stats.cjs").createStatsStore({
        file: path.join(app.getPath("userData"), "worker-stats.json"),
      }));
    let usageLog;
    // Real token counts per model and request kind, for the next estimate. No text, no keys.
    const usage = () =>
      (usageLog ??= require("./usage-log.cjs").createUsageLog({
        file: path.join(app.getPath("userData"), "usage-log.json"),
      }));
    ipcMain.handle("aurora:usage-get", (event) => {
      if (!authorized(event)) throw new Error("Forbidden");
      return usage().snapshot();
    });
    ipcMain.handle("aurora:usage-set", (event, enabled) => {
      if (!authorized(event)) throw new Error("Forbidden");
      usage().setEnabled(enabled === true);
      return usage().snapshot();
    });
    ipcMain.handle("aurora:usage-clear", (event) => {
      if (!authorized(event)) throw new Error("Forbidden");
      usage().clear();
      return usage().snapshot();
    });
    ipcMain.handle("aurora:set-lang", (event, lang) => {
      if (!authorized(event)) throw new Error("Forbidden");
      require("./i18n.cjs").setLang(lang);
    });
    ipcMain.handle("aurora:ai-status", (event) => {
      if (!authorized(event)) throw new Error("Forbidden");
      return providers.status(secrets.env());
    });
    ipcMain.handle("aurora:ai-request", async (event, payload) => {
      if (!authorized(event)) throw new Error("Forbidden");
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error("이미 요청을 처리 중입니다.");
      inFlight.add(id);
      try {
        const env = secrets.env();
        return await guarded(env, () =>
          providers.request(payload, {
            env,
            onUsage: (u) => usage().record(u),
          }),
        );
      } finally {
        inFlight.delete(id);
      }
    });
    ipcMain.handle("aurora:team-run", async (event, payload) => {
      if (!authorized(event)) throw new Error("Forbidden");
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error("이미 요청을 처리 중입니다.");
      inFlight.add(id);
      try {
        // Count calls per stage so the next team estimate knows how many of each to expect.
        const calls = { plan: 0, work: 0, review: 0, merge: 0 };
        const env = secrets.env();
        const result = await guarded(env, () =>
          require("./team.cjs").orchestrate(payload, {
            env,
            onProgress: (e) =>
              event.sender.send("aurora:team-progress", scrub(e, env)),
            stats: stats(),
            onUsage: (u) => {
              if (u.kind in calls) calls[u.kind] += 1;
              usage().record(u);
            },
          }),
        );
        usage().recordRun({
          lead: payload.lead,
          worker: payload.worker,
          ...calls,
        });
        return result;
      } finally {
        inFlight.delete(id);
      }
    });
    ipcMain.handle("aurora:ensemble-run", async (event, payload) => {
      if (!authorized(event)) throw new Error("Forbidden");
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error("이미 요청을 처리 중입니다.");
      inFlight.add(id);
      try {
        const env = secrets.env();
        return await guarded(env, () =>
          require("./ensemble.cjs").runEnsemble(payload, {
            env,
            onProgress: (e) =>
              event.sender.send("aurora:team-progress", scrub(e, env)),
            stats: stats(),
            onUsage: (u) => usage().record(u),
          }),
        );
      } finally {
        inFlight.delete(id);
      }
    });
    const root = path.resolve(__dirname, "../dist");
    protocol.handle("aurora", (request) => {
      const url = new URL(request.url);
      if (url.host !== "app") return new Response("Forbidden", { status: 403 });
      let target;
      try {
        target = path.resolve(root, "." + decodeURIComponent(url.pathname));
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      if (
        !target.startsWith(root + path.sep) ||
        !fs.existsSync(target) ||
        !fs.statSync(target).isFile()
      ) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(target).toString());
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    createWindow();
    require("./updates.cjs").setupUpdates({
      app,
      dialog,
      Menu,
      autoUpdater: require("electron-updater").autoUpdater,
      macSigned:
        require("../package.json").auroraAutoUpdate?.macSigned === true,
      disabled: !!process.env.AURORA_QA_DATA,
      storeDistribution:
        process.windowsStore === true ||
        require("../package.json").auroraDistribution === "store",
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
