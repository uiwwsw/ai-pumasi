// Run every bench item on every free model through local OmniRoute and record raw answers.
// Usage: node bench/run_models.mjs <out.json> [model ...]
// The OmniRoute key is read from ~/.omniroute/claude-code.key at runtime and never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const out = process.argv[2];
const models = process.argv.slice(3);
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const items = [
  ...JSON.parse(readFileSync(here + "items/qa.json", "utf8")),
  ...JSON.parse(readFileSync(here + "items/tasks.json", "utf8")),
];
const SYSTEM = {
  qa: "너는 AI를 처음 써 보는 사람을 돕는 비서다. 한국어로, 쉽게, 정확하게 답한다. 모르거나 사실이 아닌 전제는 분명히 말한다. 필요한 만큼만 길게 쓴다.",
  task: "지시를 정확히 따른다. 요구한 형식 외의 말은 붙이지 않는다.",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model, item) {
  const messages = [
    { role: "system", content: item.kind === "qa" ? SYSTEM.qa : SYSTEM.task },
    { role: "user", content: item.prompt },
  ];
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 6000 }),
        signal: AbortSignal.timeout(180000),
      });
      const d = await r.json().catch(() => ({}));
      const text = d.choices?.[0]?.message?.content ?? "";
      const ms = Date.now() - t0;
      if (r.ok && text.trim())
        return {
          text,
          servedBy: d.model ?? "",
          ms,
          attempts: attempt + 1,
          finish: d.choices?.[0]?.finish_reason ?? "",
          usage: d.usage ?? null,
        };
      last = `HTTP ${r.status}${text.trim() ? "" : " empty"}`;
      if (r.status === 429) await sleep(20000 * (attempt + 1));
      else await sleep(4000);
    } catch (e) {
      last = e.name === "TimeoutError" ? "timeout" : "network";
      await sleep(4000);
    }
  }
  return { text: "", error: last };
}

const results = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const save = () => writeFileSync(out, JSON.stringify(results, null, 1));
await Promise.all(
  models.map(async (model) => {
    results[model] ??= {};
    for (const item of items) {
      if (results[model][item.id]?.text) continue; // resume
      results[model][item.id] = await call(model, item);
      save();
      const r = results[model][item.id];
      console.log(`${model} ${item.id} ${r.text ? r.ms + "ms" : r.error}`);
    }
  }),
);
save();
console.log("done");
