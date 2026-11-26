import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runEnsemble, checkModels } = require("../electron/ensemble.cjs");
const { createStatsStore } = require("../electron/worker-stats.cjs");

const env = {
  ANTHROPIC_API_KEY: "unit-a",
  GEMINI_API_KEY: "unit-g",
  OPENAI_API_KEY: "unit-o",
};
const status = { openai: true, anthropic: true, gemini: true, ollama: true };

/** Which catalog model a provider request is for. */
function modelOf(url: string, body: any) {
  if (url.includes("11434")) return "ollama-local";
  return body.model;
}
/** A provider-shaped reply for the given model. */
function reply(model: string, text: string, status = 200) {
  if (status !== 200) return { ok: false, status, json: async () => ({}) };
  if (model === "claude-haiku-5-5")
    return {
      ok: true,
      json: async () => ({
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    };
  if (model === "gpt-6-luna")
    return {
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
    };
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
  };
}

type Answer = (
  model: string,
  body: any,
  n: number,
) =>
  | { text: string; status?: number }
  | Promise<{ text: string; status?: number }>;

function run(
  models: string[],
  answer: Answer,
  weights: Record<string, number> = {},
  stats = createStatsStore(),
) {
  const calls: { model: string; body: any }[] = [];
  const events: any[] = [];
  const counts: Record<string, number> = {};
  const fetchImpl = async (url: string, init: any) => {
    if (url.endsWith("/api/tags")) return { ok: true };
    const body = JSON.parse(init.body);
    const model = modelOf(url, body);
    calls.push({ model, body });
    counts[model] = (counts[model] ?? 0) + 1;
    const a = await answer(model, body, counts[model]);
    return reply(model, a.text, a.status);
  };
  const result = runEnsemble(
    { models, text: "3 곱하기 4는?", context: [] },
    {
      env,
      fetchImpl,
      stats,
      sleep: async () => {},
      onProgress: (e: any) => events.push(e),
      weight: (id: string) => weights[id] ?? 0.1,
    },
  );
  return { result, calls, events, stats };
}
const systemOf = (body: any) =>
  body.system ?? body.instructions ?? body.messages?.[0]?.content ?? "";

test("every model is asked at the same time, not one after another", async () => {
  let open = 0;
  let peak = 0;
  const { result } = run(
    ["claude-haiku-5-5", "gemini-flash-latest", "ollama-local"],
    async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 20));
      open--;
      return { text: "풀이\n정답: 12" };
    },
  );
  const out = await result;
  assert.equal(peak, 3);
  assert.equal(out.kind, "vote");
  assert.equal(out.agree, 3);
  assert.equal(out.voters, 3);
});

test("the weighted vote follows the stronger model over a weak majority", async () => {
  const { result, calls } = run(
    ["gemini-flash-latest", "ollama-local", "claude-haiku-5-5"],
    (model) => ({
      text: model === "claude-haiku-5-5" ? "근거\n정답: 13" : "정답: 12개",
    }),
    { "claude-haiku-5-5": 3, "gemini-flash-latest": 0.5, "ollama-local": 0.5 },
  );
  const out = await result;
  assert.equal(out.answer, "13");
  assert.equal(out.agree, 1);
  assert.equal(out.writer, "claude-haiku-5-5");
  assert.equal(out.text, "근거\n정답: 13");
  assert.deepEqual(
    out.models.map((m: any) => [m.model, m.answer, m.agreed]),
    [
      ["gemini-flash-latest", "12개", false],
      ["ollama-local", "12개", false],
      ["claude-haiku-5-5", "13", true],
    ],
  );
  // Every model got the bundle instruction that asks for a final "정답:" line.
  assert.ok(calls.every((c) => /정답: <answer>/.test(systemOf(c.body))));
});

test("equal weights fall back to the plain majority, answers normalized", async () => {
  const { result } = run(
    ["claude-haiku-5-5", "gemini-flash-latest", "gpt-6-luna"],
    (model) => ({
      text: model === "claude-haiku-5-5" ? "정답: 1,000원" : "정답: **1000**",
    }),
  );
  const out = await result;
  assert.equal(out.agree, 3);
  assert.equal(out.writer, "claude-haiku-5-5");
});

test("a failed model drops out of the vote and is recorded", async () => {
  const stats = createStatsStore();
  const { result } = run(
    ["claude-haiku-5-5", "gemini-flash-latest", "ollama-local"],
    (model) =>
      model === "gemini-flash-latest"
        ? { text: "", status: 401 }
        : { text: "정답: 12" },
    {},
    stats,
  );
  const out = await result;
  assert.equal(out.voters, 2);
  assert.equal(out.agree, 2);
  assert.equal(out.asked, 3);
  const g = out.models.find((m: any) => m.model === "gemini-flash-latest");
  assert.equal(g.ok, false);
  assert.equal(g.reason, "error");
  assert.equal(stats.snapshot()["gemini-flash-latest"].fail, 1);
});

test("an empty reply is asked again before the model counts", async () => {
  const { result, calls } = run(
    ["claude-haiku-5-5", "ollama-local"],
    (model, _b, n) =>
      model === "ollama-local" && n === 1 ? { text: "" } : { text: "정답: 12" },
  );
  const out = await result;
  assert.equal(calls.filter((c) => c.model === "ollama-local").length, 2);
  assert.equal(out.voters, 2);
});

test("a rate-limited model is retried once, then left out", async () => {
  const { result, calls } = run(
    ["claude-haiku-5-5", "gemini-flash-latest", "ollama-local"],
    (model) =>
      model === "gemini-flash-latest"
        ? { text: "", status: 429 }
        : { text: "정답: 12" },
  );
  const out = await result;
  assert.equal(
    calls.filter((c) => c.model === "gemini-flash-latest").length,
    2,
  );
  assert.equal(
    out.models.find((m: any) => m.model === "gemini-flash-latest").reason,
    "rate-limit",
  );
  assert.equal(out.voters, 2);
});

test("open-ended answers are merged by the highest-weighted model", async () => {
  const long = (who: string) => `${who}의 설명입니다. `.repeat(20) + "\n끝.";
  const { result, calls, events } = run(
    ["gemini-flash-latest", "claude-haiku-5-5", "ollama-local"],
    (model, body) =>
      /Several models/.test(systemOf(body))
        ? { text: "합친 최종 답입니다. ".repeat(30) }
        : { text: long(model) },
    { "claude-haiku-5-5": 2, "gemini-flash-latest": 1 },
  );
  const out = await result;
  assert.equal(out.kind, "merge");
  assert.equal(out.writer, "claude-haiku-5-5");
  assert.match(out.text, /^합친 최종 답/);
  const synth = calls.filter((c) => /Several models/.test(systemOf(c.body)));
  assert.equal(synth.length, 1);
  assert.equal(synth[0].model, "claude-haiku-5-5");
  const prompt = synth[0].body.messages.at(-1).content;
  assert.match(prompt, /Gemini Flash/);
  assert.match(prompt, /Ollama/);
  assert.ok(events.some((e) => e.stage === "merge"));
  assert.equal(events.filter((e) => e.taskId === "merge").at(-1).state, "done");
  // Usage adds up every call, the merge included.
  assert.deepEqual(out.usage.byModel["claude-haiku-5-5"], { in: 20, out: 6 });
  assert.deepEqual(out.usage.total, { in: 30, out: 10 });
});

test("a failed merge shows the writer's own answer with a warning", async () => {
  const { result } = run(
    ["gemini-flash-latest", "claude-haiku-5-5"],
    (model, body) =>
      /Several models/.test(systemOf(body))
        ? { text: "", status: 400 }
        : { text: `${model} 설명. `.repeat(30) },
    { "gemini-flash-latest": 2 },
  );
  const out = await result;
  assert.equal(out.kind, "merge");
  assert.match(out.text, /^gemini-flash-latest 설명/);
  assert.match(out.warning, /합치지 못해/);
});

test("one surviving model is shown with a warning, none is an error", async () => {
  const one = run(["claude-haiku-5-5", "gemini-flash-latest"], (model) =>
    model === "gemini-flash-latest"
      ? { text: "", status: 403 }
      : { text: "정답: 12" },
  );
  const out = await one.result;
  assert.equal(out.kind, "single");
  assert.equal(out.writer, "claude-haiku-5-5");
  assert.match(out.warning, /만 답해/);
  const none = run(["claude-haiku-5-5", "gemini-flash-latest"], () => ({
    text: "",
    status: 403,
  }));
  await assert.rejects(none.result, /모두 답하지 못했습니다/);
});

test("the bundle takes 2-5 distinct free or light models that can run", () => {
  assert.throws(() => checkModels(["claude-haiku-5-5"], status), /2~5개/);
  assert.throws(
    () => checkModels(["claude-haiku-5-5", "claude-haiku-5-5"], status),
    /2~5개/,
  );
  assert.throws(
    () => checkModels(["claude-haiku-5-5", "claude-opus-5-5"], status),
    /무료·경량/,
  );
  assert.throws(
    () =>
      checkModels(["claude-haiku-5-5", "gemini-flash-latest"], {
        ...status,
        gemini: false,
      }),
    /키가 설정되지/,
  );
  assert.throws(
    () =>
      checkModels(["claude-haiku-5-5", "ollama-local"], {
        ...status,
        ollama: false,
      }),
    /Ollama/,
  );
  checkModels(
    ["gpt-6-luna", "claude-haiku-5-5", "gemini-flash-latest", "ollama-local"],
    status,
  );
});

test("measured free models on an OpenAI-compatible server vote with their measured weights", async () => {
  const ids = [
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "google/gemini-3.1-flash-lite",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
  ];
  const urls: string[] = [];
  const out = await runEnsemble(
    { models: ids, text: "3 곱하기 4는?", context: [] },
    {
      env: {
        AURORA_OPENAI_COMPAT_KEY: "unit-c",
        AURORA_OPENAI_COMPAT_URL: "https://gateway.example/v1/chat/completions",
      },
      sleep: async () => {},
      stats: createStatsStore(),
      fetchImpl: async (url: string, init: any) => {
        if (url.endsWith("/api/tags")) return { ok: false };
        urls.push(url);
        const body = JSON.parse(init.body);
        // The strongest model stands alone against a two-model majority.
        const text =
          body.model === ids[0] ? "풀이\n정답: 13" : "풀이\n정답: 12";
        return {
          ok: true,
          json: async () => ({
            model: body.model.split("/").slice(1).join("/"),
            choices: [{ message: { content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          }),
        };
      },
    },
  );
  assert.deepEqual(urls, [
    "https://gateway.example/v1/chat/completions",
    "https://gateway.example/v1/chat/completions",
    "https://gateway.example/v1/chat/completions",
  ]);
  assert.deepEqual(
    out.models.map((m: any) => [m.model, m.weight]),
    [
      [ids[0], 3.434],
      [ids[1], 1.745],
      [ids[2], 0.981],
    ],
  );
  assert.equal(out.answer, "13");
  assert.deepEqual(out.substitutions, []);
});
