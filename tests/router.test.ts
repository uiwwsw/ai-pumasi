import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { request, status, router } = require("../electron/providers.cjs");
const { createRouter } = require("../electron/router.cjs");

const SUPER = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const payload = (model: string) => ({
  action: "execute",
  model,
  text: "2+2는?",
  context: [],
  maxOutputTokens: 256,
});
const ok = (text: string, model: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      model,
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
    { status: 200 },
  );
const fail = (status: number, headers: Record<string, string> = {}) =>
  new Response("{}", { status, headers });
const host = (url: string) => new URL(url).hostname;
const env = {
  NVIDIA_API_KEY: "nv-unit-key-1234",
  OPENROUTER_API_KEY: "or-unit-key-1234",
};

test("each free host gets its own key and its own model name", async () => {
  router.reset();
  const seen: any[] = [];
  const r = await request(payload(SUPER), {
    env,
    fetchImpl: async (url: string, init: any) => {
      seen.push({
        host: host(url),
        auth: init.headers.Authorization,
        body: JSON.parse(init.body),
      });
      return ok("4", SUPER);
    },
  });
  assert.equal(r.text, "4");
  assert.equal(r.host, "NVIDIA");
  assert.deepEqual(
    seen.map((s) => s.host),
    ["integrate.api.nvidia.com"],
  );
  assert.equal(seen[0].auth, "Bearer nv-unit-key-1234");
  assert.equal(seen[0].body.model, SUPER);
});

test("a rate-limited host rests and the same request moves to the next host", async () => {
  router.reset();
  const seen: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    const h = host(url);
    seen.push({
      h,
      auth: init.headers.Authorization,
      model: JSON.parse(init.body).model,
    });
    return h === "integrate.api.nvidia.com"
      ? fail(429, { "retry-after": "30" })
      : ok("4", "x");
  };
  const r = await request(payload(SUPER), { env, fetchImpl });
  assert.equal(r.host, "OpenRouter");
  assert.deepEqual(
    seen.map((s) => s.h),
    ["integrate.api.nvidia.com", "openrouter.ai"],
  );
  // OpenRouter never sees the NVIDIA key, and gets its own free model name.
  assert.equal(seen[1].auth, "Bearer or-unit-key-1234");
  assert.equal(seen[1].model, "nvidia/nemotron-3.5-super-vl:free");
  // Next call goes to OpenRouter first while NVIDIA rests.
  seen.length = 0;
  await request(payload(SUPER), { env, fetchImpl });
  assert.deepEqual(
    seen.map((s) => s.h),
    ["openrouter.ai"],
  );
});

test("a bad request is not retried on another host", async () => {
  router.reset();
  let calls = 0;
  await assert.rejects(
    request(payload(SUPER), {
      env,
      fetchImpl: async () => {
        calls++;
        return fail(400);
      },
    }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test("rest times follow the failure kind and Retry-After", () => {
  let t = 1000;
  const r = createRouter({ now: () => t });
  const e = { NVIDIA_API_KEY: "a", OPENROUTER_API_KEY: "b" };
  const [nv] = r.routes(SUPER, e);
  assert.equal(r.fail(nv, { status: 429, retryAfter: 5 }), true);
  assert.equal(r.routes(SUPER, e)[0].host, "openrouter");
  t += 6000;
  assert.equal(r.routes(SUPER, e)[0].host, "nvidia");
  assert.equal(r.fail(nv, { status: 401 }), true);
  t += 600000;
  assert.equal(
    r.routes(SUPER, e)[0].host,
    "openrouter",
    "a rejected key stays back",
  );
  assert.equal(r.fail(nv, { status: 400 }), false);
  r.succeed(nv);
  assert.equal(r.routes(SUPER, e)[0].host, "nvidia");
});

test("status says which free models can run, without keys", async () => {
  router.reset();
  const s = await status({
    GROQ_API_KEY: "g-unit-key-1234",
    AURORA_OLLAMA: "0",
  });
  assert.equal(s.models["openai/gpt-oss-120b"], true);
  assert.equal(s.models[SUPER], false);
  assert.equal(s.compat, true);
  assert.equal(s.auto, true);
  assert.equal(s.hosts.groq, true);
  assert.ok(!JSON.stringify(s).includes("g-unit-key-1234"));
});

test("automatic choice uses the strongest free model, then the next when it is out", async () => {
  router.reset();
  const asked: string[] = [];
  const r = await request(payload("auto-free"), {
    env: { NVIDIA_API_KEY: "nv-unit-key-1234" },
    fetchImpl: async (_url: string, init: any) => {
      const m = JSON.parse(init.body).model;
      asked.push(m);
      return m === SUPER ? fail(503) : ok("4", m);
    },
  });
  assert.equal(asked[0], SUPER, "measured strongest first");
  assert.equal(asked[1], ULTRA, "then the next strongest");
  assert.equal(r.model, ULTRA);
  assert.equal(r.auto, true);
});

test("automatic choice explains what to do when no free key is set", async () => {
  router.reset();
  await assert.rejects(
    request(payload("auto-free"), {
      env: {},
      fetchImpl: async () => ok("x", "x"),
    }),
    /설정 → API 키/,
  );
});
