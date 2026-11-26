import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { orchestrate } = require("../electron/team.cjs");
const { createStatsStore } = require("../electron/worker-stats.cjs");

const SUPER = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const plan = JSON.stringify({ goal: "g", tasks: [{ id: "t1", title: "a", instructions: "A 하기" }] });
const reply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }),
});

/** Runs the automatic lead with fake free hosts. review(model) decides each review answer. */
async function run({
  leadOrder,
  review,
}: {
  leadOrder?: string[];
  review: (model: string) => object;
}) {
  const calls: { action: string; model: string }[] = [];
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const system = String(body.messages?.[0]?.content ?? "");
    const action = system.includes("Split the user request")
      ? "plan"
      : system.includes("reviewing junior results")
        ? "review"
        : "work";
    calls.push({ action, model: body.model });
    if (action === "plan") return reply(plan);
    if (action === "review") return reply(JSON.stringify(review(body.model)));
    return reply("작업 결과입니다. ".repeat(20));
  };
  const result = await orchestrate(
    { lead: "auto-free", leadOrder, worker: SUPER, text: "할 일", context: [] },
    {
      env: { NVIDIA_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl,
      stats: createStatsStore(),
      sleep: async () => {},
    },
  );
  return { result, calls };
}

test("automatic lead: the top-ranked free model plans and reviews; a sure approval costs no extra call", async () => {
  const { result, calls } = await run({ review: () => ({ approved: true, sure: true, redo: [] }) });
  assert.equal(result.leadModel, SUPER);
  assert.equal(result.secondOpinion, null);
  const lead = calls.filter((c) => c.action !== "work");
  assert.deepEqual(
    lead.map((c) => c.action),
    ["plan", "review"],
  );
  assert.ok(lead.every((c) => c.model.endsWith(SUPER.split("/")[1])));
});

test("automatic lead: when the lead is not sure, the runner-up checks once and its verdict counts", async () => {
  const { result, calls } = await run({
    review: (model) =>
      model.includes("super")
        ? { approved: true, sure: false, redo: [] }
        : { approved: true, sure: true, redo: [] },
  });
  assert.equal(result.approved, true);
  assert.equal(result.secondOpinion?.model, ULTRA);
  assert.equal(calls.filter((c) => c.action === "review").length, 2);
});

test("automatic lead: the user's order picks the lead", async () => {
  const { result } = await run({
    leadOrder: [ULTRA],
    review: () => ({ approved: true, sure: true, redo: [] }),
  });
  assert.equal(result.leadModel, ULTRA);
});
