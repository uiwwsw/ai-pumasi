// Free model router. One model (say Nemotron Super) is often served by several free hosts
// (NVIDIA, OpenRouter, or a server the user added). This picks the hosts the user has a key for,
// tries them in order, and rests a host that hit its rate limit or failed so the next call goes
// elsewhere first. Keys are read from the env passed in (main process only) and never returned.
const catalog = require("../src/catalog.json");

const HOSTS = {
  nvidia: {
    name: "NVIDIA",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: "NVIDIA_API_KEY",
  },
  groq: {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: "GROQ_API_KEY",
  },
  openrouter: {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: "OPENROUTER_API_KEY",
  },
  google: {
    name: "Google AI Studio",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: "GEMINI_API_KEY",
  },
};

/** The user's own OpenAI-compatible server: https anywhere, plain http only on this machine. */
function customEndpoint(env) {
  try {
    const url = new URL(env.AURORA_OPENAI_COMPAT_URL || "");
    if (url.protocol === "https:") return url.href;
    if (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
    )
      return url.href;
  } catch {}
  return null;
}

// How long a host rests after a failure, by kind. A 401/403/404 means this host will not serve
// this model with this key, so it stays out of the way for the rest of the session's hour.
const REST_MS = { rate: 60000, server: 15000, auth: 3600000, missing: 3600000 };

function createRouter({ now = Date.now } = {}) {
  const resting = new Map(); // `${host}|${wire}` -> until (ms)

  /** Every host that could serve this catalog model right now, best first. */
  function routes(modelId, env) {
    const model = catalog.find((m) => m.id === modelId);
    if (!model || model.provider !== "compat") return [];
    const list = [];
    for (const [host, wire] of Object.entries(model.hosts ?? {})) {
      const h = HOSTS[host];
      const key = h && env[h.key];
      if (key) list.push({ host, name: h.name, url: h.url, key, wire });
    }
    const custom = customEndpoint(env);
    if (
      custom &&
      (env.AURORA_OPENAI_COMPAT_KEY || env.AURORA_OPENAI_COMPAT_URL)
    )
      list.push({
        host: "custom",
        name: "직접 넣은 서버",
        url: custom,
        key: env.AURORA_OPENAI_COMPAT_KEY || "",
        wire: model.id,
      });
    const t = now();
    const until = (r) => resting.get(`${r.host}|${r.wire}`) ?? 0;
    // Hosts that are not resting keep their order; resting ones go last, soonest back first.
    return list
      .map((r, i) => ({ r, i, u: until(r) > t ? until(r) : 0 }))
      .sort((a, b) => a.u - b.u || a.i - b.i)
      .map(({ r }) => r);
  }

  /** True when at least one host can serve the model. */
  function available(modelId, env) {
    return routes(modelId, env).length > 0;
  }

  /**
   * Record a failed call. Returns true when another host is worth trying for the same request
   * (rate limit, server error, timeout, wrong key or model missing on this host).
   */
  function fail(route, error) {
    const s = error?.status;
    let kind = null;
    if (s === 429) kind = "rate";
    else if (s === 401 || s === 403) kind = "auth";
    else if (s === 404) kind = "missing";
    else if (error?.transient || (s >= 500 && s < 600)) kind = "server";
    if (!kind) return false;
    let ms = REST_MS[kind];
    const retryAfter = Number(error?.retryAfter);
    if (kind === "rate" && Number.isFinite(retryAfter) && retryAfter > 0)
      ms = Math.min(retryAfter * 1000, 15 * 60000);
    resting.set(`${route.host}|${route.wire}`, now() + ms);
    return true;
  }

  function succeed(route) {
    resting.delete(`${route.host}|${route.wire}`);
  }

  return { routes, available, fail, succeed, reset: () => resting.clear() };
}

/** Names of the hosts with a key, for status. Never the keys. */
function hostStatus(env) {
  const out = {};
  for (const [id, h] of Object.entries(HOSTS)) out[id] = !!env[h.key];
  out.custom = !!customEndpoint(env);
  return out;
}

module.exports = { HOSTS, createRouter, customEndpoint, hostStatus };
