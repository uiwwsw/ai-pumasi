// Auto-grade code/doc tasks and build blinded judge packets.
// Usage: node bench/grade.mjs auto     -> results/auto-scores.json
//        node bench/grade.mjs packets  -> judge/packet-*.json + results/judge-key.json
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkD1, checkD2, checkD4 } from "./checks/doc_checks.mjs";

const here = new URL(".", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(here + p, "utf8"));
const raw = read("results/raw-free.json");
const cgNew = read("results/chatgpt-new.json");
const cgOld = read("results/chatgpt-v0.json");
const qa = read("items/qa.json");
const tasks = read("items/tasks.json");

// Every answer source: free models plus ChatGPT free as the baseline.
const sources = { ...raw, "chatgpt-free": {} };
for (const q of qa) {
  const n = Number(q.id.slice(1));
  sources["chatgpt-free"][q.id] = n <= 20 ? { text: cgOld[String(n)] } : cgNew[q.id];
}
for (const t of tasks) sources["chatgpt-free"][t.id] = cgNew[t.id];

const servedOk = (model, r) =>
  model === "chatgpt-free" || !r?.servedBy || model.endsWith(r.servedBy) || r.servedBy.includes(model.split("/").pop());

function pythonCode(text) {
  const blocks = [...String(text ?? "").matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0];
  return String(text ?? "");
}

if (process.argv[2] === "auto") {
  const out = {};
  for (const [model, res] of Object.entries(sources)) {
    out[model] = {};
    for (const t of tasks) {
      const r = res[t.id];
      if (!r?.text && !r?.code) {
        out[model][t.id] = { score: null, notes: [r?.error ?? "no answer"] };
        continue;
      }
      if (!servedOk(model, r)) {
        out[model][t.id] = { score: null, notes: ["served by " + r.servedBy] };
        continue;
      }
      const text = r.code || r.text;
      if (t.kind === "code") {
        const dir = mkdtempSync("/Volumes/DevBuild/tmp/bench-sol.");
        writeFileSync(dir + "/s.py", pythonCode(r.code ? "```python\n" + r.code + "\n```" : text));
        let res2;
        try {
          res2 = JSON.parse(execFileSync(here + "checks/run_code.sh", [t.id, dir + "/s.py"], { encoding: "utf8" }));
        } catch {
          res2 = { passed: 0, total: 1, fails: ["runner error"] };
        }
        rmSync(dir, { recursive: true, force: true });
        out[model][t.id] = { score: res2.passed / res2.total, notes: res2.fails.slice(0, 6) };
      } else if (t.id === "d1") out[model][t.id] = checkD1(text);
      else if (t.id === "d2") out[model][t.id] = checkD2(text);
      else if (t.id === "d4") out[model][t.id] = checkD4(text);
    }
    console.log(model, Object.entries(out[model]).map(([k, v]) => `${k}:${v.score === null ? "-" : v.score.toFixed(2)}`).join(" "));
  }
  writeFileSync(here + "results/auto-scores.json", JSON.stringify(out, null, 1));
}

if (process.argv[2] === "packets") {
  const judged = [...qa, tasks.find((t) => t.id === "d3")];
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let seed = 20261125;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const key = {};
  const packets = [];
  for (const item of judged) {
    const models = Object.keys(sources).filter((m) => sources[m][item.id]?.text && servedOk(m, sources[m][item.id]));
    for (let i = models.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [models[i], models[j]] = [models[j], models[i]];
    }
    key[item.id] = {};
    const answers = {};
    models.forEach((m, i) => {
      key[item.id][labels[i]] = m;
      answers[labels[i]] = String(sources[m][item.id].text).slice(0, 3500);
    });
    packets.push({ id: item.id, question: item.prompt, answers });
  }
  mkdirSync(here + "judge", { recursive: true });
  const per = 6;
  for (let i = 0; i < packets.length; i += per)
    writeFileSync(here + `judge/packet-${i / per + 1}.json`, JSON.stringify(packets.slice(i, i + per), null, 1));
  writeFileSync(here + "results/judge-key.json", JSON.stringify(key, null, 1));
  console.log(packets.length, "items in", Math.ceil(packets.length / per), "packets");
}
