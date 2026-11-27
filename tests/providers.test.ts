import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readRouting, presets, models } from "../src/routing.ts";
const require = createRequire(import.meta.url);
const {
  request,
  status,
  validate,
  substituted,
} = require("../electron/providers.cjs");
const payload = {
  action: "execute",
  model: "gpt-6.1-sol",
  text: "테스트 질문",
  context: [],
  maxOutputTokens: 4096,
};
const json = (body: unknown) => ({ ok: true, json: async () => body });
test("role defaults are independent, validated, and provider-specific", () => {
  assert.notEqual(presets.openai.analyzer, presets.openai.executor);
  assert.equal(presets.anthropic.analyzer, "claude-haiku-5-5");
  assert.equal(readRouting("{bad").executor, "gpt-6.1-sol");
  assert.equal(
    readRouting(
      JSON.stringify({ analyzer: "bad", executor: "gpt-6.1-sol", live: true }),
    ).live,
    false,
  );
  assert.equal(models.length, 15);
});
test("missing key blocks a call before any network traffic", async () => {
  let calls = 0;
  await assert.rejects(
    request(payload, {
      env: {},
      fetchImpl: () => {
        calls++;
      },
    }),
    /OPENAI_API_KEY/,
  );
  assert.equal(calls, 0);
  const s = await status({ ANTHROPIC_API_KEY: "test" }, async () => {
    throw new Error("down");
  });
  assert.deepEqual(
    {
      openai: s.openai,
      anthropic: s.anthropic,
      gemini: s.gemini,
      ollama: s.ollama,
      compat: s.compat,
      auto: s.auto,
    },
    {
      openai: false,
      anthropic: true,
      gemini: false,
      ollama: false,
      compat: false,
      auto: false,
    },
  );
  assert.ok(Object.values(s.models).every((v) => v === false));
});
test("OpenAI adapter uses fixed endpoint, selected model, no store, usage and cap", async () => {
  let seen: any;
  const result = await request(payload, {
    env: { OPENAI_API_KEY: "unit-test-key" },
    fetchImpl: async (url: string, opts: any) => {
      seen = { url, opts, body: JSON.parse(opts.body) };
      return json({
        output: [{ content: [{ type: "output_text", text: "答え" }] }],
        usage: { input_tokens: 22, output_tokens: 33 },
        status: "completed",
      });
    },
  });
  assert.equal(seen.url, "https://api.openai.com/v1/responses");
  assert.equal(seen.opts.redirect, "error");
  assert.equal(seen.body.model, payload.model);
  assert.equal(seen.body.store, false);
  assert.equal(seen.body.max_output_tokens, 4096);
  assert.equal(result.inputTokens, 22);
  assert.equal(result.text, "答え");
});
test("Anthropic adapter maps roles, headers and incomplete output separately", async () => {
  let body: any;
  const result = await request(
    {
      ...payload,
      model: "claude-sonnet-5-5",
      context: [{ role: "user", text: "前文" }],
    },
    {
      env: { ANTHROPIC_API_KEY: "unit-test-key" },
      fetchImpl: async (url: string, opts: any) => {
        assert.equal(url, "https://api.anthropic.com/v1/messages");
        assert.equal(opts.headers["anthropic-version"], "2023-06-01");
        body = JSON.parse(opts.body);
        return json({
          content: [{ type: "text", text: "部分" }],
          usage: { input_tokens: 3, output_tokens: 7 },
          stop_reason: "max_tokens",
        });
      },
    },
  );
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.messages[0].content, "前文");
  assert.equal(result.incomplete, true);
});
test("analyzer never executes user task and validates model recommendation", async () => {
  let system = "";
  const result = await request(
    {
      ...payload,
      action: "analyze",
      model: "gpt-6-luna",
      maxOutputTokens: 2048,
    },
    {
      env: { OPENAI_API_KEY: "test" },
      fetchImpl: async (_: string, opts: any) => {
        system = JSON.parse(opts.body).instructions;
        return json({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: "작업 범위",
                    reason: "비교 이유",
                    recommendedModel: "claude-sonnet-5-5",
                  }),
                },
              ],
            },
          ],
        });
      },
    },
  );
  assert.match(system, /never execute/);
  assert.equal(result.recommendedModel, "claude-sonnet-5-5");
  await assert.rejects(
    request(
      { ...payload, action: "analyze" },
      {
        env: { OPENAI_API_KEY: "test" },
        fetchImpl: async () => json({ output: [] }),
      },
    ),
    /유효한 분석/,
  );
});
test("errors do not expose provider response body or retry calls", async () => {
  let calls = 0;
  await assert.rejects(
    request(payload, {
      env: { OPENAI_API_KEY: "secret-unit-value" },
      fetchImpl: async () => {
        calls++;
        return {
          ok: false,
          status: 401,
          text: async () => "secret-unit-value",
        };
      },
    }),
    (error) =>
      error instanceof Error &&
      error.message.includes("401") &&
      !error.message.includes("secret-unit-value"),
  );
  assert.equal(calls, 1);
  assert.throws(() => validate({ ...payload, model: "https://evil.invalid" }));
  assert.throws(() => validate({ ...payload, maxOutputTokens: 999999 }));
});
const { orchestrate, extractJSON } = require("../electron/team.cjs");
const chatReply = (text: string, finish = "stop") => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: text }, finish_reason: finish }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }),
});
const leadReply = (text: string) =>
  json({
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 4 },
  });
const twoTasks = JSON.stringify({
  goal: "목표",
  tasks: [
    { id: "t1", title: "a", instructions: "A 하기" },
    { id: "t2", title: "b", instructions: "B 하기" },
  ],
});
// leadFn(kind, body) answers the lead; workerFn(body) answers workers. Ollama is down unless stated.
function team(
  leadFn: (kind: "plan" | "review", body: any) => any,
  // Workers answer with a fixed text; the merge echoes what it was given, as a faithful merge would.
  workerFn: (body: any) => any = (body) =>
    chatReply(
      /merge several/.test(String(body?.messages?.[0]?.content ?? ""))
        ? String(body.messages.at(-1).content)
        : "결과 텍스트",
    ),
  env: any = { ANTHROPIC_API_KEY: "t", GEMINI_API_KEY: "g" },
  onUsage?: (u: any) => void,
) {
  const calls: any[] = [];
  const run = orchestrate(
    {
      lead: "claude-opus-5-5",
      worker: "gemini-flash-latest",
      text: "할 일",
      context: [{ role: "user", text: "긴 이전 대화" }],
    },
    {
      env,
      onUsage,
      sleep: async () => {},
      fetchImpl: async (url: string, opts: any) => {
        if (url.endsWith("/api/tags")) throw new Error("no ollama");
        const body = JSON.parse(opts.body);
        calls.push({ url, body });
        if (url.includes("anthropic"))
          return leadFn(
            body.system.includes("Never do the work") ? "plan" : "review",
            body,
          );
        return workerFn(body);
      },
    },
  );
  return { run, calls };
}
const workers = (calls: any[]) =>
  calls.filter((c) => !c.url.includes("anthropic"));

test("team mode: lead plans and judges, workers do the work and the merge", async () => {
  let reviews = 0;
  const { run, calls } = team((kind) =>
    leadReply(
      kind === "plan"
        ? twoTasks
        : ++reviews === 1
          ? '{"approved":false,"redo":[{"id":"t2","feedback":"B 고치기"}]}'
          : '{"approved":true,"redo":[]}',
    ),
  );
  const result = await run;
  assert.equal(result.rounds, 2);
  assert.equal(result.approved, true);
  assert.equal(result.warning, "");
  const w = workers(calls);
  assert.equal(w.length, 4); // t1, t2, t2 redo, merge
  assert.equal(w[0].body.messages.length, 2); // system + own task only, no prior conversation
  assert.match(w[2].body.messages[1].content, /B 고치기/);
  assert.match(w[3].body.messages[0].content, /merge/);
  // The lead never re-types worker output: the review prompt asks for a verdict only. The cap is
  // high because reasoning leads think first; only tokens actually produced are billed.
  const review = calls.find(
    (c) =>
      c.url.includes("anthropic") &&
      !c.body.system.includes("Never do the work"),
  );
  assert.equal(review.body.max_tokens, 12000);
  assert.equal(result.usage.lead.out, 12);
});

test("team mode tolerates prose and fences around the lead's JSON", async () => {
  assert.deepEqual(extractJSON('Here is the plan:\n{"a":{"b":"}"}}\nThanks'), {
    a: { b: "}" },
  });
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```\nLet me know.'), {
    a: 1,
  });
  const { run } = team((kind) =>
    leadReply(
      kind === "plan"
        ? "Here is the plan:\n```json\n" + twoTasks + "\n```\nLet me know."
        : 'Looks good. {"approved":true,"redo":[]}',
    ),
  );
  assert.equal((await run).approved, true);
});

test("team mode keeps worker results when the review breaks", async () => {
  const { run } = team((kind) =>
    kind === "plan"
      ? leadReply(twoTasks)
      : json({
          content: [{ type: "text", text: '{"approved":tr' }],
          stop_reason: "max_tokens",
        }),
  );
  const result = await run;
  assert.equal(result.approved, false);
  assert.match(result.warning, /검수 없이/);
  assert.match(result.text, /결과/);
});

test("team mode stops instead of re-reviewing when redo ids are unknown", async () => {
  const { run, calls } = team((kind) =>
    leadReply(
      kind === "plan"
        ? twoTasks
        : '{"approved":false,"redo":[{"id":"task-2","feedback":"x"}]}',
    ),
  );
  const result = await run;
  assert.equal(calls.filter((c) => c.url.includes("anthropic")).length, 2);
  assert.match(result.warning, /재작업 대상/);
});

test("team mode caps the review per task and skips a lossy merge", async () => {
  const big = "가".repeat(15000);
  let reviewText = "";
  const { run, calls } = team(
    (kind, body) => {
      if (kind === "review") reviewText = body.messages[0].content;
      return leadReply(
        kind === "plan" ? twoTasks : '{"approved":true,"redo":[]}',
      );
    },
    () => chatReply(big),
  );
  const result = await run;
  assert.match(reviewText, /## t2/); // the last task is still visible to the lead
  assert.match(reviewText, /생략/);
  assert.equal(workers(calls).length, 2); // no merge call
  assert.equal(result.text.length > 30000, true); // nothing lost
});

test("team mode retries a rate-limited worker, then falls back to another free model", async () => {
  let gemini = 0;
  const { run, calls } = team(
    (kind) =>
      leadReply(
        kind === "plan"
          ? JSON.stringify({
              goal: "g",
              tasks: [{ id: "t1", title: "a", instructions: "A" }],
            })
          : '{"approved":true,"redo":[]}',
      ),
    (body) => {
      if (body.model !== "gemini-flash-latest") return chatReply("로컬 결과");
      gemini++;
      return { ok: false, status: 429 };
    },
    { ANTHROPIC_API_KEY: "t", GEMINI_API_KEY: "g" },
  );
  // The Gemini key also unlocks Gemini 3.1 Flash Lite through Google's free host, so after two
  // rate-limited tries the task moves there and succeeds.
  const result = await run;
  assert.equal(gemini, 2);
  assert.equal(result.tasks[0].failed, false);
  const w = workers(calls);
  assert.equal(w.length, 3);
  assert.equal(w[2].body.model, "gemini-3.1-flash-lite");
});

test("lead and worker JSON modes are requested only where supported", async () => {
  const { run, calls } = team((kind) =>
    leadReply(kind === "plan" ? twoTasks : '{"approved":true,"redo":[]}'),
  );
  await run;
  assert.equal(workers(calls)[0].body.response_format, undefined);
});

// Compat provider tests
const compatPayload = {
  action: "execute",
  model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  text: "테스트 질문",
  context: [],
  maxOutputTokens: 4096,
};

test("compat status: various env configurations", async () => {
  // key without a URL -> false: there is no default server
  assert.equal((await status({ AURORA_OPENAI_COMPAT_KEY: "k" })).compat, false);
  // empty env -> false
  assert.equal((await status({})).compat, false);
  // evil URL -> false
  assert.equal(
    (
      await status({
        AURORA_OPENAI_COMPAT_URL: "http://evil.example/v1/chat/completions",
      })
    ).compat,
    false,
  );
  // https URL -> true
  assert.equal(
    (
      await status({
        AURORA_OPENAI_COMPAT_URL: "https://gw.example/v1/chat/completions",
      })
    ).compat,
    true,
  );
});

test("compat request with key", async () => {
  let seen: any;
  const result = await request(compatPayload, {
    env: {
      AURORA_OPENAI_COMPAT_KEY: "unit-test-key",
      AURORA_OPENAI_COMPAT_URL: "https://gateway.example/v1/chat/completions",
    },
    fetchImpl: async (url: string, opts: any) => {
      seen = { url, opts, body: JSON.parse(opts.body) };
      return json({
        model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        choices: [{ message: { content: "정답: 3" } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      });
    },
  });
  assert.equal(seen.url, "https://gateway.example/v1/chat/completions");
  assert.equal(seen.opts.headers.Authorization, "Bearer unit-test-key");
  assert.equal(seen.body.model, compatPayload.model);
  assert.equal(seen.body.messages[0].role, "system");
  assert.equal(seen.body.messages[0].content.includes("assistant"), true);
  assert.equal(seen.body.max_tokens, 4096);
  assert.equal(result.text, "정답: 3");
  assert.equal(result.inputTokens, 5);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.substituted, false);
});

test("compat request without key uses custom URL", async () => {
  const fetchUrl = "http://127.0.0.1:9999/v1/chat/completions";
  const result = await request(
    {
      ...compatPayload,
      model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    },
    {
      env: { AURORA_OPENAI_COMPAT_URL: fetchUrl },
      fetchImpl: async (url: string, opts: any) => {
        assert.equal(url, fetchUrl);
        assert.equal(opts.headers.Authorization, undefined);
        return json({
          model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      },
    },
  );
  assert.equal(result.text, "ok");
});

test("compat request rejects when neither KEY nor URL is set", async () => {
  let calls = 0;
  await assert.rejects(
    request(compatPayload, {
      env: {},
      fetchImpl: () => calls++,
    }),
    /무료 제공자 키가 없습니다/,
  );
  assert.equal(calls, 0);
});

test("compat request rejects when URL is invalid (not localhost/https)", async () => {
  let calls = 0;
  await assert.rejects(
    request(compatPayload, {
      env: { AURORA_OPENAI_COMPAT_URL: "http://evil.example/x" },
      fetchImpl: () => calls++,
    }),
    /무료 제공자 키가 없습니다/,
  );
  assert.equal(calls, 0);
});

test("compat substituted: served model matches request without routing prefix", async () => {
  const result = await request(compatPayload, {
    env: {
      AURORA_OPENAI_COMPAT_KEY: "k",
      AURORA_OPENAI_COMPAT_URL: "https://gateway.example/v1/chat/completions",
    },
    fetchImpl: async () => {
      return json({
        model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  });
  assert.equal(result.substituted, false);
});

test("compat substituted: served model is different (other/model-x)", async () => {
  const result = await request(compatPayload, {
    env: {
      AURORA_OPENAI_COMPAT_KEY: "k",
      AURORA_OPENAI_COMPAT_URL: "https://gateway.example/v1/chat/completions",
    },
    fetchImpl: async () => {
      return json({
        model: "other/model-x",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  });
  assert.equal(result.substituted, true);
});

test("substituted helper: various routed model scenarios", () => {
  // When got = last segment of want, should NOT be substituted
  assert.equal(
    substituted(
      "nvidia/nemotron-3.5-super-vl-120b-a12b",
      "nemotron-3.5-super-vl-120b-a12b",
    ),
    false,
  );
  // When got starts with lastSegment + "-"
  assert.equal(substituted("nvidia/model", "model-v2"), false);
  // When want.endsWith("/" + got)
  assert.equal(substituted("nvidia/model", "model"), false);
  // When completely different
  assert.equal(substituted("nvidia/model-x", "other/model-y"), true);
  // When no routing prefix (no "/" in want)
  assert.equal(substituted("model-x", "model-y"), true);
});
test("a finished response reports token counts and input length, never text", async () => {
  const seen: any[] = [];
  await request(
    { ...payload, context: [{ role: "user", text: "이전 질문" }] },
    {
      env: { OPENAI_API_KEY: "unit-test-key" },
      onUsage: (u: any) => seen.push(u),
      fetchImpl: async () =>
        json({
          output: [{ content: [{ type: "output_text", text: "답" }] }],
          usage: { input_tokens: 22, output_tokens: 33 },
        }),
    },
  );
  assert.deepEqual(seen, [
    {
      model: "gpt-6.1-sol",
      kind: "execute",
      inputChars: payload.text.length + "이전 질문".length,
      inputTokens: 22,
      outputTokens: 33,
    },
  ]);
  // A provider that reports no usage leaves nothing to learn from.
  await request(payload, {
    env: { OPENAI_API_KEY: "unit-test-key" },
    onUsage: (u: any) => seen.push(u),
    fetchImpl: async () =>
      json({ output: [{ content: [{ type: "output_text", text: "답" }] }] }),
  });
  assert.equal(seen.length, 1);
});
test("team mode reports each stage's usage under its own kind and model", async () => {
  const seen: any[] = [];
  const { run } = team(
    (kind) =>
      leadReply(kind === "plan" ? twoTasks : '{"approved":true,"redo":[]}'),
    undefined,
    undefined,
    (u: any) => seen.push(u),
  );
  await run;
  assert.deepEqual(
    seen.map((u) => `${u.kind}:${u.model}`),
    [
      "plan:claude-opus-5-5",
      "work:gemini-flash-latest",
      "work:gemini-flash-latest",
      "review:claude-opus-5-5",
      "merge:gemini-flash-latest",
    ],
  );
  assert.ok(seen.every((u) => !("text" in u)));
});
