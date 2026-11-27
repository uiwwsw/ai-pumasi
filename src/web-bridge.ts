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

/** Install window.auroraAI for the browser. Does nothing inside the desktop app. */
export function installWebBridge() {
  if (window.auroraAI) return;
  const deltaListeners = new Set<(text: string) => void>();
  const teamListeners = new Set<(e: TeamProgress) => void>();
  const workerStats = stats.createStatsStore();
  const bridge: AIBridge = {
    status: () => providers.status(env(), fetch),
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
