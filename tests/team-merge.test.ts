import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { orchestrate } = require("../electron/team.cjs");
const { createStatsStore } = require("../electron/worker-stats.cjs");

const SUPER = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const tasks = [1, 2, 3].map((n) => ({ id: `t${n}`, title: `문제 ${n}`, instructions: `문제 ${n} 풀기` }));
const reply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }),
});

async function run(merge: (n: number) => string) {
  let merges = 0;
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const system = String(body.messages?.[0]?.content ?? "");
    const user = String(body.messages?.at(-1)?.content ?? "");
    if (system.includes("Split the user request")) return reply(JSON.stringify({ goal: "g", tasks }));
    if (system.includes("reviewing junior results"))
      return reply(JSON.stringify({ approved: true, sure: true, redo: [] }));
    if (system.includes("merge several junior results")) return reply(merge(++merges));
    const n = /문제 (\d)/.exec(user)?.[1];
    return reply(`문제 ${n} 풀이입니다. `.repeat(30) + `\n정답 ${n}: ${n}${n}`);
  };
  const result = await orchestrate(
    { lead: "auto-free", worker: SUPER, text: "세 문제를 풀어 주세요", context: [] },
    {
      env: { NVIDIA_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl,
      stats: createStatsStore(),
      sleep: async () => {},
    },
  );
  return { result, merges };
}

test("a merge that keeps only one result is not shown; every result is", async () => {
  const { result, merges } = await run(() => "문제 2 풀이입니다.\n정답 2: 22");
  for (const n of [1, 2, 3]) assert.match(result.text, new RegExp(`정답 ${n}: ${n}${n}`));
  assert.ok(merges >= 2, "a short merge is asked again before giving up");
});

test("a full merge is used as the answer", async () => {
  const full = [1, 2, 3].map((n) => `문제 ${n} 풀이입니다. `.repeat(20) + `\n정답 ${n}: ${n}${n}`).join("\n\n");
  const { result } = await run(() => `합친 답\n${full}`);
  assert.ok(result.text.startsWith("합친 답"));
});

test("a reasoning model that spends its budget thinking gets more room, and its placeholder is never a result", async () => {
  const budgets: number[] = [];
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const system = String(body.messages?.[0]?.content ?? "");
    if (system.includes("Split the user request"))
      return reply(JSON.stringify({ goal: "g", tasks: [tasks[0]] }));
    if (system.includes("reviewing junior results"))
      return reply(JSON.stringify({ approved: true, sure: true, redo: [] }));
    budgets.push(body.max_tokens);
    // Thinking used the whole budget: no visible text, cut at the limit.
    if (body.max_tokens < 16000)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
          usage: { prompt_tokens: 5, completion_tokens: body.max_tokens },
        }),
      };
    return reply("문제 1 풀이입니다. ".repeat(10) + "\n정답 1: 11");
  };
  const result = await orchestrate(
    { lead: "auto-free", worker: SUPER, text: "풀어 주세요", context: [] },
    { env: { NVIDIA_API_KEY: "k", AURORA_OLLAMA: "0" }, fetchImpl, stats: createStatsStore(), sleep: async () => {} },
  );
  assert.deepEqual(budgets.slice(0, 2), [4096, 8192]);
  assert.match(result.text, /정답 1: 11/);
  assert.doesNotMatch(result.text, /보이는 답변이 생성되지/);
});
