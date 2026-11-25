// Aurora bundle + free Wikipedia search grounding for QA items. Stores "aurora-search" in raw-free.json.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const qa = JSON.parse(readFileSync(here + "items/qa.json", "utf8"));
const d3 = JSON.parse(readFileSync(here + "items/tasks.json", "utf8")).find((t) => t.id === "d3");
// Groq quota exhausted; Cloudflare gpt-oss caps output near 166 tokens, so NVIDIA models merge.
const MEMBERS = ["nvidia/nvidia/nemotron-3-ultra-550b-a55b", "gemini/gemini-3.1-flash-lite", "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b"];
const MERGER = "nvidia/nvidia/nemotron-3-ultra-550b-a55b";
const PLANNER = "gemini/gemini-3.1-flash-lite";
const UA = { "User-Agent": "aurora-bench/0.1 (research)" };
const BASE = "너는 AI를 처음 써 보는 사람을 돕는 비서다. 오늘은 2026-11-25다. 한국어로, 쉽게, 정확하게 답한다. 사실이 아닌 전제는 분명히 말한다. 필요한 만큼만 길게 쓴다.";
const GROUND = " [참고 자료]가 주어지면 거기 적힌 사실을 네 기억보다 우선한다. 자료에도 없고 확실하지 않은 숫자·전화번호·가격·기관명은 지어내지 말고, 공식 확인처(예: 정부24, 해당 기관 홈페이지)를 안내한다.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(model, messages, max = 5000) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: max }),
        signal: AbortSignal.timeout(180000),
      });
      const d = await r.json().catch(() => ({}));
      const text = d.choices?.[0]?.message?.content ?? "";
      const served = d.model ?? "";
      if (r.ok && text.trim() && (!served || model.endsWith(served) || served.includes(model.split("/").pop()))) return text;
      await sleep(r.status === 429 ? 20000 : 4000);
    } catch {
      await sleep(4000);
    }
  }
  return "";
}

async function wiki(query) {
  try {
    const s = await (await fetch("https://ko.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=2&srsearch=" + encodeURIComponent(query), { headers: UA, signal: AbortSignal.timeout(15000) })).json();
    const titles = (s.query?.search ?? []).map((x) => x.title);
    if (!titles.length) return [];
    const e = await (await fetch("https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=" + encodeURIComponent(titles.join("|")), { headers: UA, signal: AbortSignal.timeout(15000) })).json();
    const words = query.split(/\s+/).filter((w) => w.length >= 2);
    return Object.values(e.query.pages).map((p) => {
      const sents = String(p.extract ?? "").split(/(?<=[.다요])\s+|\n+/).filter(Boolean);
      const lead = sents.slice(0, 3);
      const hits = sents.filter((x) => words.some((w) => x.includes(w))).slice(0, 12);
      return { title: p.title, text: [...new Set([...lead, ...hits])].join(" ").slice(0, 1600) };
    });
  } catch {
    return [];
  }
}

async function ground(question) {
  const plan = await chat(PLANNER, [
    { role: "system", content: "질문에 답하려면 사실 확인이 필요한지 판단하고, 위키백과에서 찾을 짧은 한국어 검색어를 최대 2개 만든다. JSON만 출력: {\"search\":true|false,\"queries\":[\"...\"]}" },
    { role: "user", content: question },
  ], 400);
  let p = null;
  try {
    p = JSON.parse(plan.slice(plan.indexOf("{"), plan.lastIndexOf("}") + 1));
  } catch {}
  if (!p?.search || !Array.isArray(p.queries) || !p.queries.length) return { queries: [], context: "" };
  const docs = (await Promise.all(p.queries.slice(0, 2).map(wiki))).flat();
  const seen = new Set();
  const uniq = docs.filter((d) => d.text && !seen.has(d.title) && seen.add(d.title));
  return {
    queries: p.queries.slice(0, 2),
    context: uniq.map((d) => `- ${d.title} (위키백과): ${d.text}`).join("\n").slice(0, 4000),
  };
}

const outPath = here + "results/raw-free.json";
const all = JSON.parse(readFileSync(outPath, "utf8"));
all["aurora-search"] ??= {};
const queue = [...qa, d3].filter((it) => !all["aurora-search"][it.id]?.text);
async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const t0 = Date.now();
    const g = it.kind === "qa" ? await ground(it.prompt) : { queries: [], context: "" };
    const sys = BASE + (g.context ? GROUND : "");
    const user = g.context ? `[참고 자료]\n${g.context}\n\n[질문]\n${it.prompt}` : it.prompt;
    const drafts = (await Promise.all(MEMBERS.map((m) => chat(m, [{ role: "system", content: sys }, { role: "user", content: user }])))).filter(Boolean);
    let text = drafts[0] ?? "";
    if (drafts.length > 1) {
      const merged = await chat(MERGER, [
        { role: "system", content: sys + " 여러 초안을 하나의 최고 답으로 합친다. 초안끼리 다르면 참고 자료와 맞는 쪽, 그다음 다수 쪽을 따른다. 확인이 안 되는 구체 정보는 빼거나 확실하지 않다고 쓴다. 초안 이야기는 하지 않는다." },
        { role: "user", content: `${user}\n\n${drafts.map((d, k) => `[초안 ${k + 1}]\n${d}`).join("\n\n")}` },
      ]);
      if (merged) text = merged;
    }
    all["aurora-search"][it.id] = { text, ms: Date.now() - t0, drafts: drafts.length, queries: g.queries, contextChars: g.context.length };
    writeFileSync(outPath, JSON.stringify(all, null, 1));
    console.log(it.id, drafts.length, g.queries.join(" | "), g.context.length, text ? "ok" : "empty", Date.now() - t0);
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log("done");
