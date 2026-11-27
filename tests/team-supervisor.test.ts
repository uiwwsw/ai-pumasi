import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  orchestrate,
  workerTimeout,
  minReplyChars,
  judgeReply,
} = require("../electron/team.cjs");
const { substituted } = require("../electron/providers.cjs");
const { createStatsStore } = require("../electron/worker-stats.cjs");

const KEY = "secret-unit-gemini-key";
const chat = (text: string, finish = "stop", model?: string) => ({
  ok: true,
  json: async () => ({
    ...(model ? { model } : {}),
    choices: [{ message: { content: text }, finish_reason: finish }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }),
});
const lead = (text: string) => ({
  ok: true,
  json: async () => ({
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 4 },
  }),
});
const oneTask = (instructions = "A 하기") =>
  JSON.stringify({
    goal: "g",
    tasks: [{ id: "t1", title: "첫 작업", instructions }],
  });

/** workerFn answers every worker call; it sees which model was asked and the request body. */
function run(
  workerFn: (model: string, body: any, n: number) => any,
  {
    worker = "gemini-flash-latest",
    ollama = true,
    plan = oneTask(),
    stats = createStatsStore(),
  }: { worker?: string; ollama?: boolean; plan?: string; stats?: any } = {},
) {
  const events: any[] = [];
  const workerCalls: any[] = [];
  const sleeps: number[] = [];
  let clock = 1000;
  const result = orchestrate(
    {
      lead: "claude-opus-5-5",
      worker,
      text: "할 일",
      context: [],
    },
    {
      env: {
        ANTHROPIC_API_KEY: "t",
        GEMINI_API_KEY: KEY,
        OLLAMA_MODEL: "qwen3",
      },
      stats,
      now: () => (clock += 500),
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      onProgress: (e: any) => events.push(e),
      fetchImpl: async (url: string, opts: any) => {
        if (url.endsWith("/api/tags")) {
          if (!ollama) throw new Error("down");
          return { ok: true };
        }
        const body = JSON.parse(opts.body);
        if (url.includes("anthropic"))
          return lead(
            body.system.includes("Never do the work")
              ? plan
              : '{"approved":true,"redo":[]}',
          );
        const model = url.includes("11434") ? "ollama-local" : body.model;
        workerCalls.push({ model, body });
        return workerFn(model, body, workerCalls.length);
      },
    },
  );
  return { result, events, workerCalls, sleeps, stats };
}
const states = (events: any[]) =>
  events.filter((e) => e.stage === "worker").map((e) => e.state);

test("an empty reply is asked again from the same model", async () => {
  const r = run((_m, _b, n) => (n === 1 ? chat("   ") : chat("완성된 결과")));
  const out = await r.result;
  assert.equal(out.text, "완성된 결과");
  assert.deepEqual(
    r.workerCalls.map((c) => c.model),
    ["gemini-flash-latest", "gemini-flash-latest"],
  );
  const retry = r.events.find((e) => e.state === "retry");
  assert.equal(retry.reason, "empty");
  assert.equal(r.stats.snapshot()["gemini-flash-latest"].empty, 1);
});

test("a cut-off reply is retried with more room, then handed to the next free model", async () => {
  const r = run((model) =>
    model === "gemini-flash-latest"
      ? chat("잘린 답", "length")
      : chat("로컬 결과"),
  );
  const out = await r.result;
  assert.equal(out.text, "로컬 결과");
  assert.deepEqual(
    r.workerCalls.map((c) => c.model),
    [
      "gemini-flash-latest",
      "gemini-flash-latest",
      "gemini-flash-latest",
      "gemini-flash-latest",
      "ollama-local",
    ],
  );
  // The budget doubles up to 32000 before the next model takes over.
  assert.deepEqual(
    r.workerCalls.slice(0, 4).map((c) => c.body.max_tokens),
    [4096, 8192, 16384, 32000],
  );
  const sw = r.events.find((e) => e.state === "switch");
  assert.equal(sw.from, "gemini-flash-latest");
  assert.equal(sw.model, "ollama-local");
  assert.deepEqual(out.workersUsed, ["ollama-local"]);
  assert.equal(out.tasks[0].incomplete, false);
});

test("when every model cuts off, the longest partial is kept and marked incomplete", async () => {
  const r = run((model) =>
    chat(
      model === "ollama-local" ? "더 긴 잘린 답입니다" : "짧게 잘림",
      "length",
    ),
  );
  const out = await r.result;
  // Gemini Flash, Gemini 3.1 Flash Lite (Google host, same key) and Ollama: the budget grows
  // 4096 → 8192 → 16384 → 32000 on each.
  assert.equal(r.workerCalls.length, 12);
  assert.equal(out.text, "더 긴 잘린 답입니다");
  assert.equal(out.tasks[0].failed, false);
  assert.equal(out.tasks[0].incomplete, true);
});

test("a one-word answer to a long instruction counts as dropped work", async () => {
  const long = "다음 요구사항을 모두 반영한 함수를 작성하세요. ".repeat(20);
  assert.equal(minReplyChars(long.length), 40);
  assert.equal(judgeReply({ text: "네" }, 40), "short");
  assert.equal(judgeReply({ text: "x".repeat(50) }, 40), "");
  assert.equal(
    judgeReply({ text: "x".repeat(50), incomplete: true }, 40),
    "truncated",
  );
  const r = run(
    (_m, _b, n) => (n === 1 ? chat("네") : chat("구현 결과: ".repeat(10))),
    { plan: oneTask(long) },
  );
  await r.result;
  assert.equal(r.workerCalls.length, 2);
  assert.equal(r.events.find((e) => e.state === "retry").reason, "short");
});

test("a timeout is transient: wait, retry the same model, and size the limit to the job", async () => {
  assert.ok(workerTimeout(18000, 4096) > workerTimeout(100, 4096));
  assert.ok(workerTimeout(100, 8192) > workerTimeout(100, 4096));
  assert.equal(workerTimeout(0, 128), 45000);
  assert.equal(workerTimeout(20000, 16000), 480000);
  assert.equal(workerTimeout(40000, 32000), 900000);
  const r = run((_m, _b, n) => {
    if (n === 1) {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    }
    return chat("결과");
  });
  const out = await r.result;
  assert.equal(out.text, "결과");
  assert.equal(r.sleeps.length, 1);
  const retry = r.events.find((e) => e.state === "retry");
  assert.equal(retry.reason, "timeout");
  assert.equal(r.stats.snapshot()["gemini-flash-latest"].timeout, 1);
  const running = r.events.find((e) => e.state === "running");
  assert.equal(running.timeoutMs, workerTimeout("A 하기".length, 4096));
});

test("a dropped connection is retried once, then the next model takes over", async () => {
  const r = run((model) => {
    if (model === "gemini-flash-latest") throw new Error("ECONNRESET");
    return chat("로컬 결과");
  });
  const out = await r.result;
  assert.equal(out.text, "로컬 결과");
  assert.equal(r.workerCalls.length, 3);
  assert.equal(r.sleeps.length, 1);
});

test("a key or permission error skips the retry and moves on", async () => {
  const r = run((model) =>
    model === "gemini-flash-latest"
      ? { ok: false, status: 403 }
      : chat("로컬 결과"),
  );
  await r.result;
  assert.deepEqual(
    r.workerCalls.map((c) => c.model),
    ["gemini-flash-latest", "ollama-local"],
  );
  assert.equal(r.sleeps.length, 0);
});

test("local track record moves a failing model to the back, without storing keys", async () => {
  const stats = createStatsStore();
  for (let i = 0; i < 6; i++)
    stats.record("gemini-flash-latest", {
      ok: false,
      ms: 120000,
      reason: "timeout",
    });
  for (let i = 0; i < 6; i++)
    stats.record("ollama-local", { ok: true, ms: 3000 });
  const r = run(() => chat("결과"), { stats });
  const out = await r.result;
  assert.equal(r.workerCalls[0].model, "ollama-local");
  assert.deepEqual(out.workersUsed, ["ollama-local"]);
  assert.equal(stats.snapshot()["ollama-local"].ok, 7);
  assert.equal(JSON.stringify(stats.snapshot()).includes(KEY), false);
});

test("a silent model swap is recorded, reported and returned", async () => {
  assert.equal(substituted("qwen3", "qwen3:latest"), false);
  assert.equal(substituted("gpt-6.1-sol", "gpt-6.1-sol-2026-09-01"), false);
  assert.equal(substituted("gemini-flash-latest", "gemini-3-flash"), false);
  assert.equal(substituted("qwen3", "llama3:8b"), true);
  assert.equal(substituted("qwen3", null), false);
  const r = run(() => chat("결과", "stop", "llama3:8b"), {
    worker: "ollama-local",
    ollama: true,
  });
  const out = await r.result;
  assert.deepEqual(out.substitutions, [
    { requested: "ollama-local", servedBy: "llama3:8b" },
  ]);
  const ev = r.events.find((e) => e.state === "substituted");
  assert.equal(ev.servedBy, "llama3:8b");
  const s = r.stats.snapshot()["ollama-local"];
  assert.equal(s.substituted, 1);
  assert.equal(s.lastServedBy, "llama3:8b");
});

test("progress shows each junior waiting, running with a start time, and done", async () => {
  const two = JSON.stringify({
    goal: "g",
    tasks: [
      { id: "t1", title: "가", instructions: "A" },
      { id: "t2", title: "나", instructions: "B" },
    ],
  });
  const r = run(() => chat("하나로 합친 결과입니다. ".repeat(3)), {
    plan: two,
  });
  await r.result;
  const w = r.events.filter((e) => e.stage === "worker");
  assert.deepEqual(
    w.slice(0, 2).map((e) => [e.taskId, e.state]),
    [
      ["t1", "waiting"],
      ["t2", "waiting"],
    ],
  );
  const running = w.find((e) => e.taskId === "t1" && e.state === "running");
  assert.equal(typeof running.startedAt, "number");
  assert.equal(running.model, "gemini-flash-latest");
  const done = w.find((e) => e.taskId === "t1" && e.state === "done");
  assert.ok(done.elapsedMs > 0);
  assert.ok(states(r.events).includes("done"));
  assert.ok(w.some((e) => e.taskId === "merge"));
});
