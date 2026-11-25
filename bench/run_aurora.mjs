// Aurora-style bundle: top free models answer, one merges. Adds "aurora" to results/raw-free.json.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const items = [...JSON.parse(readFileSync(here + "items/qa.json", "utf8")), ...JSON.parse(readFileSync(here + "items/tasks.json", "utf8"))];
const MEMBERS = ["nvidia/nvidia/nemotron-3-ultra-550b-a55b", "groq/openai/gpt-oss-120b", "gemini/gemini-3.1-flash-lite"];
const MERGER = "groq/openai/gpt-oss-120b";
const SYS = {
  qa: "너는 AI를 처음 써 보는 사람을 돕는 비서다. 한국어로, 쉽게, 정확하게 답한다. 모르거나 사실이 아닌 전제는 분명히 말한다. 확실하지 않은 숫자·이름·가격은 지어내지 말고 확실하지 않다고 말한다. 필요한 만큼만 길게 쓴다.",
  task: "지시를 정확히 따른다. 요구한 형식 외의 말은 붙이지 않는다.",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function chat(model, messages) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 6000 }),
        signal: AbortSignal.timeout(180000),
      });
      const d = await r.json().catch(() => ({}));
      const text = d.choices?.[0]?.message?.content ?? "";
      const served = d.model ?? "";
      // Reject silent fallbacks: the bundle must be the models we chose.
      if (r.ok && text.trim() && (!served || model.endsWith(served) || served.includes(model.split("/").pop()))) return text;
      await sleep(r.status === 429 ? 20000 : 4000);
    } catch {
      await sleep(4000);
    }
  }
  return "";
}

const outPath = here + "results/raw-free.json";
const all = JSON.parse(readFileSync(outPath, "utf8"));
all.aurora ??= {};
const queue = items.filter((it) => !all.aurora[it.id]?.text);
async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const t0 = Date.now();
    const sys = it.kind === "qa" ? SYS.qa : SYS.task;
    const drafts = (await Promise.all(MEMBERS.map((m) => chat(m, [{ role: "system", content: sys }, { role: "user", content: it.prompt }])))).filter(Boolean);
    let text = drafts[0] ?? "";
    if (drafts.length > 1) {
      const mergeSys =
        it.kind === "qa"
          ? SYS.qa + " 여러 초안을 하나의 최고 답으로 합친다. 초안끼리 숫자·이름·날짜가 다르면 다수 쪽을 따르고, 확인이 안 되면 확실하지 않다고 쓴다. 초안 이야기는 하지 않는다."
          : SYS.task + " 여러 초안 중 지시를 가장 정확히 지킨 것을 골라 필요하면 고친 뒤, 원래 지시가 요구한 형식 그대로 최종 답만 낸다.";
      const merged = await chat(MERGER, [
        { role: "system", content: mergeSys },
        { role: "user", content: `원래 지시:\n${it.prompt}\n\n${drafts.map((d, k) => `[초안 ${k + 1}]\n${d}`).join("\n\n")}` },
      ]);
      if (merged) text = merged;
    }
    all.aurora[it.id] = { text, ms: Date.now() - t0, drafts: drafts.length };
    writeFileSync(outPath, JSON.stringify(all, null, 1));
    console.log(it.id, drafts.length, text ? "ok" : "empty", Date.now() - t0);
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log("done");
