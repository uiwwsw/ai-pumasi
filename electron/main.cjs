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
const { tr } = require("./i18n.cjs");
app.setName("Pumasi Agent");
app.setAppUserModelId("com.uiwwsw.aurora");
// The app was called Aurora until 0.1.8 and AI Pumasi in 0.1.9. Keep using the older folder so
// conversations, settings and saved keys carry over; new installs get a folder under the new name.
const legacyData = ["Aurora", "AI Pumasi"]
  .map((name) => path.join(app.getPath("appData"), name))
  .find((dir) => fs.existsSync(dir));
if (!process.env.AURORA_QA_DATA && legacyData) {
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
    title: "Pumasi Agent",
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
  // Links in an answer open in the user's browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadURL("aurora://app/index.html");
}
// pumasi-agent:// links open this app; the OpenRouter sign-in comes back through one.
const LINK_SCHEME = require("./openrouter-login.cjs").SCHEME;
if (app.isPackaged) app.setAsDefaultProtocolClient(LINK_SCHEME);
else if (process.argv[1])
  app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
let orLogin = null;
const takeLink = (link) => orLogin?.receive(link);
// macOS hands the link to the running app; Windows starts a second copy with the link in argv.
app.on("open-url", (event, link) => {
  event.preventDefault();
  takeLink(link);
});
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else
  app.whenReady().then(() => {
    // Dialogs before the window loads follow the system language; the window then sets its choice.
    require("./i18n.cjs").setLang(/^ko\b/i.test(app.getLocale()) ? "ko" : "en");
    app.on("second-instance", (_event, argv) => {
      const link = argv.find((a) => a.startsWith(`${LINK_SCHEME}://`));
      if (link) takeLink(link);
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
    const forbiddenError = () => new Error(tr("Forbidden"));
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
      if (!authorized(event)) throw forbiddenError();
      return secrets.list();
    });
    ipcMain.handle("aurora:secrets-set", (event, name, value) => {
      if (!authorized(event)) throw forbiddenError();
      try {
        return secrets.set(name, value);
      } catch (error) {
        throw new Error(
          redact(error?.message ?? tr("저장하지 못했습니다."), {
            [name]: value,
          }),
        );
      }
    });
    // "Start with OpenRouter": sign in on openrouter.ai and keep the key it gives back.
    ipcMain.handle("aurora:openrouter-login", async (event) => {
      if (!authorized(event)) throw forbiddenError();
      orLogin?.cancel();
      const login = require("./openrouter-login.cjs").startLogin({
        open: (url) => shell.openExternal(url),
      });
      orLogin = login;
      try {
        const key = await login.promise;
        BrowserWindow.fromWebContents(event.sender)?.focus();
        return secrets.set("OPENROUTER_API_KEY", key);
      } catch (error) {
        throw new Error(redact(error?.message ?? String(error), secrets.env()));
      } finally {
        // A newer sign-in may have replaced this one; leave that one in place.
        if (orLogin === login) orLogin = null;
      }
    });
    ipcMain.handle("aurora:openrouter-cancel", (event) => {
      if (!authorized(event)) throw forbiddenError();
      orLogin?.cancel();
    });
    // One paste box: work out the provider, check the key with it, then save it.
    ipcMain.handle("aurora:secrets-add", async (event, value) => {
      if (!authorized(event)) throw forbiddenError();
      try {
        const r = await providers.addKey(value, { save: async (name, v) => secrets.set(name, v) });
        return { name: r.name, provider: r.provider, check: r.check, state: r.state };
      } catch (error) {
        throw new Error(redact(error?.message ?? tr("저장하지 못했습니다."), {
            [providers.detectKey(value) ?? "OPENAI_API_KEY"]: String(value ?? ""),
          }));
      }
    });
    ipcMain.handle("aurora:secrets-remove", (event, name) => {
      if (!authorized(event)) throw forbiddenError();
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
      if (!authorized(event)) throw forbiddenError();
      if (!Object.hasOwn(SIGNUP, host))
        throw new Error(tr("알 수 없는 제공자입니다."));
      return shell.openExternal(SIGNUP[host]);
    });
    ipcMain.handle("aurora:secrets-compat-url", (event, url) => {
      if (!authorized(event)) throw forbiddenError();
      return secrets.setCompatUrl(url);
    });
    // Pumasi. Task and result text stays in this process: the window only gets states and counts.
    let pumasiParts;
    const pumasi = () => {
      if (!pumasiParts) {
        const mod = require("./pumasi.cjs");
        const settings = mod.createSettings(
          path.join(app.getPath("userData"), "pumasi.json"),
        );
        const identity = mod.loadIdentity(
          path.join(app.getPath("userData"), "pumasi-identity.json"),
          safeStorage,
        );
        pumasiParts = { mod, settings, identity };
      }
      const { mod, settings, identity } = pumasiParts;
      const api = mod.createClient({ server: settings.get().server, identity });
      return { mod, settings, api };
    };
    const pumasiState = async () => {
      const { mod, settings, api } = pumasi();
      const s = settings.get();
      const env = secrets.env();
      const keys = Object.fromEntries(
        Object.entries(mod.DONATABLE).map(([h, name]) => [h, !!env[name]]),
      );
      const out = {
        server: s.server,
        joined: s.joined,
        donate: s.donate,
        dailyCap: s.dailyCap,
        usedToday: s.usedToday,
        keys,
      };
      if (!s.joined) return out;
      try {
        return { ...out, me: await api("GET", "/v1/me") };
      } catch (error) {
        return { ...out, error: error.message };
      }
    };
    // Code mode: one folder the user picked in the system dialog. The window never names a folder itself.
    const workspace = require("./workspace.cjs").createWorkspace();
    const codeCall = (name, fn) =>
      ipcMain.handle(name, (event, ...args) => {
        if (!authorized(event)) throw forbiddenError();
        return fn(event, ...args);
      });
    codeCall("aurora:code-open", async (event) => {
      savedEdits.clear();
      // Automated UI checks cannot click the system dialog; they name a folder instead.
      if (process.env.AURORA_QA_DATA && process.env.AURORA_QA_FOLDER)
        return workspace.allow(process.env.AURORA_QA_FOLDER);
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return workspace.allow(r.filePaths[0]);
    });
    codeCall("aurora:code-current", () => workspace.current());
    codeCall("aurora:code-list", (_e, rel) => workspace.list(String(rel ?? "")));
    codeCall("aurora:code-read", (_e, rel) => workspace.read(String(rel ?? "")));
    // The agent works in that folder. Saving and running commands wait for the user's answer.
    const pendingAsks = new Map(); // id -> {kind, resolve(boolean)}
    let agentStop = false;
    let agentBusy = false;
    // "Save all" for the rest of one request: later file changes in it are saved without asking.
    let saveAllEdits = false;
    // Saved changes the user may undo: id -> {path, before, after, existed}. Cleared with the folder.
    const savedEdits = new Map();
    const runCommand = (command) =>
      new Promise((resolve) => {
        const root = workspace.current()?.root;
        if (!root) return resolve({ code: null, output: tr("먼저 폴더를 열어 주세요.") });
        const child = require("node:child_process").spawn(command, {
          cwd: root,
          shell: true,
          env: process.env,
          windowsHide: true,
        });
        let output = "";
        const take = (d) => {
          if (output.length < 200000) output += d.toString();
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        const timer = setTimeout(() => {
          output += `\n${tr("2분이 지나 멈췄습니다.")}`;
          child.kill("SIGTERM");
        }, 120000);
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({ code: null, output: output + error.message });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      });
    codeCall("aurora:agent-run", async (event, payload) => {
      if (agentBusy) throw new Error(tr("이미 요청을 처리 중입니다."));
      const text = String(payload?.text ?? "").slice(0, 20000);
      if (!text.trim()) throw new Error(tr("요청 형식 또는 출력 한도가 올바르지 않습니다."));
      const history = (Array.isArray(payload?.history) ? payload.history : [])
        .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.text === "string")
        .map((m) => ({ role: m.role, text: m.text.slice(0, 20000) }));
      const model = typeof payload?.model === "string" ? payload.model : "auto-free";
      const autoOrder = Array.isArray(payload?.autoOrder) ? payload.autoOrder : null;
      agentBusy = true;
      agentStop = false;
      saveAllEdits = false;
      const env = secrets.env();
      try {
        return await guarded(env, () =>
          require("./agent.cjs").runAgent(
            { text, history, model, autoOrder },
            {
              workspace,
              exec: runCommand,
              stopped: () => agentStop,
              request: ({ autoOrder: order, ...req }, extra = {}) =>
                providers.request(req, {
                  env,
                  autoOrder: order,
                  timeoutMs: 300000,
                  allowPaid: true,
                  onDelta: extra.onDelta,
                }),
              saved: (e) => savedEdits.set(e.id, e),
              emit: (e) => {
                if (!event.sender.isDestroyed())
                  event.sender.send("aurora:agent-event", scrub(e, env));
              },
              ask: ({ id, kind }) =>
                new Promise((resolve) => {
                  if (agentStop) return resolve(false);
                  if (kind === "edit" && saveAllEdits) return resolve(true);
                  pendingAsks.set(id, { kind, resolve });
                }),
            },
          ),
        );
      } finally {
        agentBusy = false;
        saveAllEdits = false;
        for (const a of pendingAsks.values()) a.resolve(false);
        pendingAsks.clear();
      }
    });
    codeCall("aurora:agent-answer", (_e, id, allow, all) => {
      const a = pendingAsks.get(id);
      pendingAsks.delete(id);
      // "Save all" covers file changes only, never commands.
      if (allow === true && all === true && a?.kind === "edit") saveAllEdits = true;
      a?.resolve(allow === true);
    });
    codeCall("aurora:agent-stop", () => {
      agentStop = true;
      for (const a of pendingAsks.values()) a.resolve(false);
      pendingAsks.clear();
    });
    // Undo one saved change, only if the file still holds exactly what was saved.
    codeCall("aurora:code-undo", (_e, id) => {
      const e = savedEdits.get(id);
      if (!e) throw new Error(tr("되돌릴 변경을 찾지 못했습니다."));
      let now = null;
      try {
        now = workspace.read(e.path).text;
      } catch {}
      if (now !== e.after)
        throw new Error(tr("저장한 뒤 파일이 바뀌어 되돌리지 않았습니다."));
      if (e.existed) workspace.write(e.path, e.before);
      else workspace.remove(e.path);
      savedEdits.delete(id);
      return true;
    });
    // What git sees as changed in the folder. Read-only, fixed arguments, no shell.
    const git = (args) =>
      new Promise((resolve) => {
        const root = workspace.current()?.root;
        if (!root) return resolve({ ok: false, output: tr("먼저 폴더를 열어 주세요.") });
        require("node:child_process").execFile(
          "git",
          ["-c", "core.quotepath=off", ...args],
          { cwd: root, timeout: 15000, maxBuffer: 4_000_000, windowsHide: true },
          (error, stdout) =>
            resolve(error && !stdout ? { ok: false, output: "" } : { ok: true, output: stdout }),
        );
      });
    codeCall("aurora:code-git-status", async () => {
      const r = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
      if (!r.ok) return null; // not a git repository, or git is missing
      return r.output
        .split("\n")
        .filter(Boolean)
        .slice(0, 500)
        .map((line) => ({ state: line.slice(0, 2), path: line.slice(3).replace(/^.* -> /, "") }));
    });
    codeCall("aurora:code-git-diff", async (_e, rel) => {
      const file = String(rel ?? "");
      if (!file || file.startsWith("-")) return "";
      const r = await git(["diff", "--no-color", "HEAD", "--", file]);
      return r.ok ? r.output.slice(0, 400000) : "";
    });
    ipcMain.handle("aurora:pumasi-state", (event) => {
      if (!authorized(event)) throw forbiddenError();
      return pumasiState();
    });
    ipcMain.handle("aurora:pumasi-update", (event, patch) => {
      if (!authorized(event)) throw forbiddenError();
      const clean = {};
      if (patch && typeof patch === "object") {
        if (typeof patch.server === "string") clean.server = patch.server;
        if (patch.donate && typeof patch.donate === "object")
          clean.donate = patch.donate;
        if (patch.dailyCap !== undefined) clean.dailyCap = patch.dailyCap;
      }
      pumasi().settings.update(clean);
      return pumasiState();
    });
    ipcMain.handle("aurora:pumasi-join", async (event, invite) => {
      if (!authorized(event)) throw forbiddenError();
      const { api, settings } = pumasi();
      await api("POST", "/v1/join", {
        invite: String(invite ?? "").trim().slice(0, 200),
      });
      settings.update({ joined: true });
      return pumasiState();
    });
    ipcMain.handle("aurora:pumasi-open", async (event) => {
      if (!authorized(event)) throw forbiddenError();
      return (await pumasi().api("GET", "/v1/open")).slots;
    });
    let helping = false;
    ipcMain.handle("aurora:pumasi-help", async (event, slotId) => {
      if (!authorized(event)) throw forbiddenError();
      if (typeof slotId !== "string" || !/^[\w-]{1,64}$/.test(slotId))
        throw new Error(tr("알 수 없는 작업입니다."));
      if (helping) throw new Error(tr("한 번에 하나씩만 도울 수 있습니다."));
      helping = true;
      const env = secrets.env();
      try {
        const { mod, settings, api } = pumasi();
        return await guarded(env, () =>
          mod.help(slotId, {
            api,
            env,
            settings,
            request: providers.request,
            // The helper's whole app answers, with the donated free keys and no paid fallback.
            solve: async (text, { env: donated }) => {
              const r = await require("./smart.cjs").run(
                { text, context: [], model: "auto-free" },
                // The relay drops a task after ten minutes; stop a little before that.
                {
                  env: donated,
                  stats: stats(),
                  allowPaid: false,
                  signal: AbortSignal.timeout(540_000),
                  runCode: runCodeIn(event.sender),
                },
              );
              const u = r.usage;
              return {
                text: r.text,
                inputTokens: u.route.in + u.work.in + u.check.in,
                outputTokens: u.route.out + u.work.out + u.check.out,
              };
            },
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            onProgress: (e) =>
              event.sender.send("aurora:pumasi-progress", {
                slotId: e.slotId,
                state: e.state,
                tokens: e.tokens,
              }),
          }),
        );
      } finally {
        helping = false;
      }
    });
    // "Ask for help": share one question with other users and wait for one of their apps to
    // answer. The answer is for this user, so unlike a helper's task text it goes to the window.
    let asking = null;
    ipcMain.handle("aurora:pumasi-ask", async (event, text) => {
      if (!authorized(event)) throw forbiddenError();
      if (asking) throw new Error(tr("이미 도움을 요청하는 중입니다."));
      const { mod, settings, api } = pumasi();
      if (!settings.get().joined) throw new Error(tr("먼저 Pitch in에 가입하세요."));
      asking = new AbortController();
      const env = secrets.env();
      try {
        const r = await mod.ask(text, {
          api,
          signal: asking.signal,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          onProgress: (e) =>
            event.sender.isDestroyed() ||
            event.sender.send("aurora:pumasi-ask-progress", {
              open: e.open,
              working: e.working,
              done: e.done,
            }),
        });
        return { text: scrub(r.text, env) };
      } catch (error) {
        throw new Error(redact(error?.message ?? String(error), env));
      } finally {
        asking = null;
      }
    });
    ipcMain.handle("aurora:pumasi-ask-cancel", (event) => {
      if (!authorized(event)) throw forbiddenError();
      asking?.abort();
    });
    let workerStats;
    // Per-model success and latency only: model ids and numbers, never keys or prompts.
    const stats = () =>
      (workerStats ??= require("./worker-stats.cjs").createStatsStore({
        file: path.join(app.getPath("userData"), "worker-stats.json"),
      }));
    ipcMain.handle("aurora:set-lang", (event, lang) => {
      if (!authorized(event)) throw forbiddenError();
      require("./i18n.cjs").setLang(lang);
    });
    ipcMain.handle("aurora:ai-status", (event) => {
      if (!authorized(event)) throw forbiddenError();
      return providers.status(secrets.env());
    });
    ipcMain.handle("aurora:ai-request", async (event, payload) => {
      if (!authorized(event)) throw forbiddenError();
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error(tr("이미 요청을 처리 중입니다."));
      inFlight.add(id);
      try {
        const env = secrets.env();
        // Send the answer so far to the window as it streams, at most ~15 times a second.
        // Keys are masked the same way as in the final answer.
        let last = 0;
        let timer = null;
        let latest = "";
        const push = () => {
          timer = null;
          last = Date.now();
          if (!event.sender.isDestroyed())
            event.sender.send("aurora:ai-delta", scrub(latest, env));
        };
        const onDelta = (text) => {
          latest = text;
          if (timer) return;
          const wait = Math.max(0, 66 - (Date.now() - last));
          timer = setTimeout(push, wait);
        };
        try {
          return await guarded(env, () =>
            providers.request(payload, {
              env,
              allowPaid: true,
              onDelta,
            }),
          );
        } finally {
          if (timer) clearTimeout(timer);
        }
      } finally {
        inFlight.delete(id);
      }
    });
    // Programs written by a model run in the asking window's sandboxed frame (public/sandbox.html):
    // its own origin, no network, no way back into the app. This process never runs them.
    const codeRuns = new Map();
    ipcMain.on("aurora:code-ran", (event, id, result) => {
      const waiting = codeRuns.get(id);
      if (!waiting || waiting.sender !== event.sender || !authorized(event)) return;
      waiting.done({
        ok: result?.ok === true,
        out: String(result?.out ?? "").slice(0, 8000),
        ...(result?.error ? { error: String(result.error).slice(0, 500) } : {}),
      });
    });
    const runCodeIn = (sender) => (code) =>
      new Promise((resolve) => {
        if (sender.isDestroyed()) return resolve({ ok: false, out: "", error: "no window" });
        const id = require("node:crypto").randomUUID();
        const done = (result) => {
          clearTimeout(timer);
          codeRuns.delete(id);
          resolve(result);
        };
        const timer = setTimeout(() => done({ ok: false, out: "", error: "timeout" }), 25000);
        codeRuns.set(id, { sender, done });
        sender.send("aurora:run-code", id, String(code).slice(0, 100000));
      });
    // Ask: the app decides how to work on the question (direct or split, computing by program).
    let askControl = null;
    ipcMain.handle("aurora:ask", async (event, payload) => {
      if (!authorized(event)) throw forbiddenError();
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error(tr("이미 요청을 처리 중입니다."));
      inFlight.add(id);
      const smart = require("./smart.cjs");
      const control = (askControl = smart.createControl());
      const env = secrets.env();
      // The answer so far goes to the window at most ~15 times a second, keys masked.
      let last = 0;
      let timer = null;
      let latest = "";
      const push = () => {
        timer = null;
        last = Date.now();
        if (!event.sender.isDestroyed())
          event.sender.send("aurora:ai-delta", scrub(latest, env));
      };
      try {
        return await guarded(env, () =>
          smart.run(
            {
              text: String(payload?.text ?? ""),
              context: Array.isArray(payload?.context) ? payload.context : [],
              model: typeof payload?.model === "string" ? payload.model : "auto-free",
              autoOrder: Array.isArray(payload?.autoOrder) ? payload.autoOrder : undefined,
              depth: ["light", "deep"].includes(payload?.depth) ? payload.depth : "auto",
            },
            {
              env,
              stats: stats(),
              allowPaid: true,
              signal: control.signal,
              runCode: runCodeIn(event.sender),
              signalFor: control.signalFor,
              skipped: control.skipped,
              onProgress: (e) => {
                if (!event.sender.isDestroyed())
                  event.sender.send("aurora:ask-progress", scrub(e, env));
              },
              onDelta: (text) => {
                latest = text;
                if (timer) return;
                timer = setTimeout(push, Math.max(0, 66 - (Date.now() - last)));
              },
            },
          ),
        );
      } finally {
        if (timer) clearTimeout(timer);
        if (askControl === control) askControl = null;
        inFlight.delete(id);
      }
    });
    ipcMain.handle("aurora:ask-control", (event, action, partId) => {
      if (!authorized(event)) throw forbiddenError();
      if (action === "stop") askControl?.stop();
      else if (action === "finish") askControl?.finish();
      else if (action === "skip" && typeof partId === "string") askControl?.skip(partId);
    });
    ipcMain.handle("aurora:team-run", async (event, payload) => {
      if (!authorized(event)) throw forbiddenError();
      const id = event.sender.id;
      if (inFlight.has(id)) throw new Error(tr("이미 요청을 처리 중입니다."));
      inFlight.add(id);
      try {
        const env = secrets.env();
        const copies = [1, 2, 3].includes(payload?.pumasi?.copies)
          ? payload.pumasi.copies
          : 0;
        const remote = copies
          ? (prompts) => {
              const { mod, api } = pumasi();
              return mod.runRemote(prompts, {
                api,
                copies,
                sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                onProgress: (e) =>
                  event.sender.send("aurora:team-progress", e),
              });
            }
          : undefined;
        const result = await guarded(env, () =>
          require("./team.cjs").orchestrate(payload, {
            env,
            remote,
            onProgress: (e) =>
              event.sender.send("aurora:team-progress", scrub(e, env)),
            stats: stats(),
          }),
        );
        return result;
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
      channelStore: {
        read: () =>
          fs.readFileSync(path.join(app.getPath("userData"), "update-channel"), "utf8").trim(),
        write: (c) =>
          fs.writeFileSync(path.join(app.getPath("userData"), "update-channel"), c),
      },
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
