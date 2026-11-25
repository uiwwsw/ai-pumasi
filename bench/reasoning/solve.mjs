// Solve the reasoning exam with free models and a majority vote (Aurora bundle).
// Usage: node solve.mjs <exam_dir> [model,model,...]   -> <exam_dir>/free-answers.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const dir = process.argv[2];
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const questions = JSON.parse(readFileSync(dir + "/questions.json", "utf8"));
// Order matters: vote ties go to the earlier model.
const MODELS = (process.argv[3] ?? [
  "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
  "groq/openai/gpt-oss-120b",
  "gemini/gemini-3.1-flash-lite",
  "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b",
].join(",")).split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const extract = (t) => {
  const m = [...String(t ?? "").matchAll(/정답\s*[:：]\s*`?([^`\n]+)`?/g)].pop();
  return m ? m[1].trim().replace(/[*.\s]+$/g, "").replace(/^\*+/, "") : "";
};
export const norm = (s) => String(s).replace(/[\s*`]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/명$|시간$|원$/, "");

async function ask(model, prompt) {
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 30000 }),
        signal: AbortSignal.timeout(600000),
      });
      const d = await r.json().catch(() => ({}));
      const text = d.choices?.[0]?.message?.content ?? "";
      const served = d.model ?? "";
      const same = !served || model.endsWith(served) || served.includes(model.split("/").pop());
      if (r.ok && text.trim() && same) return { text, answer: extract(text), ms: Date.now() - t0 };
      if (r.ok && !same) return { text: "", answer: "", error: "fallback " + served };
      await sleep(r.status === 429 || r.status === 503 ? 45000 * (i + 1) : 5000);
    } catch {
      await sleep(5000);
    }
  }
  return { text: "", answer: "", error: "failed" };
}

const outPath = dir + "/free-answers.json";
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const queue = questions.filter((q) => !out[q.id]);
async function worker() {
  while (queue.length) {
    const q = queue.shift();
    const t0 = Date.now();
    const runs = await Promise.all(MODELS.map((m) => ask(m, q.prompt)));
    // Majority vote on normalized answers; ties go to the earlier (stronger) model.
    const tally = new Map();
    runs.forEach((r, i) => {
      if (!r.answer) return;
      const k = norm(r.answer);
      const e = tally.get(k) ?? { n: 0, first: i, raw: r.answer };
      e.n++;
      tally.set(k, e);
    });
    const best = [...tally.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0];
    out[q.id] = { vote: best?.raw ?? "", votes: best?.n ?? 0, ms: Date.now() - t0, models: Object.fromEntries(MODELS.map((m, i) => [m, { answer: runs[i].answer, error: runs[i].error, ms: runs[i].ms }])) };
    writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log(q.no, q.id, "vote:", out[q.id].vote, `(${out[q.id].votes}/${MODELS.length})`, runs.map((r) => r.answer || r.error || "-").join(" | ").slice(0, 160));
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log("done");
