// Head-to-head: aurora vs chatgpt-free, judged blind by OmniRoute auto router, both orders.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const read = (p) => JSON.parse(readFileSync(here + p, "utf8"));
const qa = read("items/qa.json");
const d3 = read("items/tasks.json").find((t) => t.id === "d3");
const raw = read("results/raw-free.json");
const cgOld = read("results/chatgpt-v0.json");
const cgNew = read("results/chatgpt-new.json");
const cg = (id) => (id.startsWith("q") && Number(id.slice(1)) <= 20 ? cgOld[String(Number(id.slice(1)))] : cgNew[id]?.text);
const SYS = `너는 출처를 모른 채 두 AI 답을 비교하는 엄격한 심판이다. 오늘은 2026-11-25다. 질문한 사람은 AI를 처음 쓰는 한국인이다.
가장 중요한 기준은 정확성이다(사실 오류, 계산 실수, 앞뒤 모순, 지어낸 숫자·이름·가격, 위험한 조언). 그다음 이해하기 쉬운지, 실제로 도움이 되는지 본다. 쓸데없이 길거나 되묻기만 하면 감점. 확인할 수 없는 최신 정보는 판단에 넣지 않는다.
JSON 하나만 출력한다: {"winner":"A"|"B"|"tie","A":1~10 정수,"B":1~10 정수,"reason":"한 문장"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function judge(q, a, b) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto",
          messages: [{ role: "system", content: SYS }, { role: "user", content: `질문: ${q}\n\n[A]\n${a.slice(0, 4000)}\n\n[B]\n${b.slice(0, 4000)}` }],
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(180000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d.choices?.[0]?.message?.content ?? "";
      const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
      if (["A", "B", "tie"].includes(j.winner) && Number.isFinite(j.A) && Number.isFinite(j.B)) return { ...j, by: d.model ?? "" };
    } catch {}
    await sleep(6000);
  }
  return null;
}
const out = {};
const items = [...qa, d3];
const queue = [...items];
async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const au = raw.aurora?.[it.id]?.text, c = cg(it.id);
    if (!au || !c) continue;
    const [x, y] = await Promise.all([judge(it.prompt, au, c), judge(it.prompt, c, au)]);
    const runs = [];
    if (x) runs.push({ aurora: x.A, chatgpt: x.B, win: x.winner === "A" ? "aurora" : x.winner === "B" ? "chatgpt" : "tie", by: x.by, reason: x.reason });
    if (y) runs.push({ aurora: y.B, chatgpt: y.A, win: y.winner === "B" ? "aurora" : y.winner === "A" ? "chatgpt" : "tie", by: y.by, reason: y.reason });
    out[it.id] = runs;
    writeFileSync(here + "results/duel.json", JSON.stringify(out, null, 1));
    console.log(it.id, runs.map((r) => r.win).join(","));
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log("done");
