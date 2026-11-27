// The web version: the same bridge the desktop app gets from its main process, built in the
// browser. Calls go from this browser straight to each provider with the user's own keys; there is
// no server of ours in between. Keys are kept in this browser's storage only.
import providers from "../electron/providers.cjs";
import team from "../electron/team.cjs";
import i18n from "../electron/i18n.cjs";
import stats from "../electron/worker-stats.cjs";
import type {
  AIBridge,
  AIRequest,
  Completion,
  SecretName,
  SecretsState,
  TeamProgress,
  TeamResult,
} from "./routing";

const STORE = "pumasi.web.keys.v1";
const NAMES: SecretName[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "AURORA_OPENAI_COMPAT_KEY",
];
// NVIDIA's API refuses calls from web pages, so its key is not used here. The same Nemotron
// models come through OpenRouter.
export const WEB_BLOCKED: SecretName[] = ["NVIDIA_API_KEY"];
const SIGNUP: Record<string, string> = {
  nvidia: "https://build.nvidia.com/settings/api-keys",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

type Saved = {
  keys: Partial<Record<SecretName, { value: string; savedAt: string }>>;
  compatUrl: string;
};
function load(): Saved {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (d && typeof d === "object" && d.keys) return { keys: d.keys, compatUrl: d.compatUrl ?? "" };
  } catch {}
  return { keys: {}, compatUrl: "" };
}
function save(s: Saved) {
  localStorage.setItem(STORE, JSON.stringify(s));
}
function state(): SecretsState {
  const s = load();
  return {
    // No OS keychain in a browser; saving still works and the settings say where keys go.
    encryption: true,
    browser: true,
    unusable: WEB_BLOCKED,
    keys: Object.fromEntries(
      NAMES.map((n) => [n, { set: !!s.keys[n], savedAt: s.keys[n]?.savedAt ?? null }]),
    ) as SecretsState["keys"],
    compatUrl: s.compatUrl,
  };
}
function env(): Record<string, string> {
  const s = load();
  const out: Record<string, string> = { AURORA_OLLAMA: "0" };
  for (const n of NAMES)
    if (s.keys[n] && !WEB_BLOCKED.includes(n)) out[n] = s.keys[n]!.value;
  if (s.compatUrl) out.AURORA_OPENAI_COMPAT_URL = s.compatUrl;
  return out;
}
const tidy = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

// "Start with OpenRouter" on the web: the sign-in page sends the browser back to /app/ with a
// one-time code; this page trades it for the user's key. The verifier waits in sessionStorage.
const PKCE_STORE = "pumasi.web.openrouter.v1";
let loginResult: { saved: boolean; error?: string } | null = null;
async function finishOpenRouterLogin(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return;
  let saved: { verifier: string; state: string } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PKCE_STORE) ?? "null");
    sessionStorage.removeItem(PKCE_STORE);
  } catch {}
  // Drop the code from the address bar whatever happens next.
  history.replaceState(null, "", location.pathname);
  if (!saved || params.get("state") !== saved.state) {
    loginResult = { saved: false, error: i18n.tr("OpenRouter 로그인을 마치지 못했습니다. 다시 시도해 주세요.") };
    return;
  }
  try {
    const key = await providers.openRouterExchange(code, saved.verifier);
    const s = load();
    s.keys.OPENROUTER_API_KEY = { value: key, savedAt: new Date().toISOString() };
    save(s);
    loginResult = { saved: true };
  } catch (e) {
    loginResult = { saved: false, error: tidy(e).message };
  }
}

/** Install window.auroraAI for the browser. Does nothing inside the desktop app. */
export function installWebBridge() {
  if (window.auroraAI) return;
  const deltaListeners = new Set<(text: string) => void>();
  const teamListeners = new Set<(e: TeamProgress) => void>();
  const workerStats = stats.createStatsStore();
  // Finish a sign-in that just came back before anything reads the key state.
  const loginDone = finishOpenRouterLogin();
  const bridge: AIBridge = {
    status: async () => {
      await loginDone;
      return providers.status(env(), fetch);
    },
    setLang: async (lang) => i18n.setLang(lang),
    request: async (payload: AIRequest) => {
      try {
        return (await providers.request(payload, {
          env: env(),
          allowPaid: true,
          onDelta: (text: string) => deltaListeners.forEach((fn) => fn(text)),
        })) as Completion;
      } catch (e) {
        throw tidy(e);
      }
    },
    team: async (payload) => {
      try {
        return (await team.orchestrate(
          { ...payload, pumasi: undefined },
          {
            env: env(),
            stats: workerStats,
            onProgress: (e: TeamProgress) => teamListeners.forEach((fn) => fn(e)),
          },
        )) as TeamResult;
      } catch (e) {
        throw tidy(e);
      }
    },
    onAnswerDelta: (fn) => {
      deltaListeners.add(fn);
      return () => deltaListeners.delete(fn);
    },
    onTeamProgress: (fn) => {
      teamListeners.add(fn);
      return () => teamListeners.delete(fn);
    },
    secrets: {
      list: async () => state(),
      set: async (name, value) => {
        const v = String(value ?? "").trim();
        if (!NAMES.includes(name) || !v || v.length > 500 || /\s/.test(v))
          throw new Error(i18n.tr("키 형식이 올바르지 않습니다."));
        const s = load();
        s.keys[name] = { value: v, savedAt: new Date().toISOString() };
        save(s);
        return state();
      },
      openRouterLogin: async () => {
        const pkce = await providers.openRouterPkce();
        sessionStorage.setItem(PKCE_STORE, JSON.stringify({ verifier: pkce.verifier, state: pkce.state }));
        location.assign(
          providers.openRouterAuthUrl({
            callbackUrl: `${location.origin}/app/`,
            challenge: pkce.challenge,
            state: pkce.state,
          }),
        );
        // The page is leaving; this never settles.
        return new Promise<SecretsState>(() => {});
      },
      openRouterResult: async () => {
        await loginDone;
        const r = loginResult;
        loginResult = null;
        return r;
      },
      add: async (value) => {
        const r = await providers.addKey(value, {
          blocked: WEB_BLOCKED,
          save: async (name: SecretName, v: string) => {
            const s = load();
            s.keys[name] = { value: v, savedAt: new Date().toISOString() };
            save(s);
            return state();
          },
        });
        return r;
      },
      remove: async (name) => {
        const s = load();
        delete s.keys[name];
        save(s);
        return state();
      },
      setCompatUrl: async (url) => {
        const v = String(url ?? "").trim();
        if (v) {
          let u: URL;
          try {
            u = new URL(v);
          } catch {
            throw new Error(i18n.tr("주소 형식이 올바르지 않습니다."));
          }
          if (u.protocol !== "https:" || u.username || u.password)
            throw new Error(i18n.tr("https 주소여야 합니다."));
        }
        const s = load();
        s.compatUrl = v;
        save(s);
        return state();
      },
      openSignup: async (host) => {
        const url = SIGNUP[host];
        if (url) window.open(url, "_blank", "noopener");
      },
    },
  };
  window.auroraAI = bridge;
}
