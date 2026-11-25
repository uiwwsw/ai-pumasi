// Cross-check step: a different free model audits concrete claims (numbers, times, phone numbers, fees)
// in an Aurora answer and only patches the flagged spans. Reads argv[2] (default aurora-v3), writes argv[3] (default aurora-v4).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const SRC = process.argv[2] ?? "aurora-v3";
const DST = process.argv[3] ?? "aurora-v4";
const VERIFIER = "google/gemini-3.1-flash-lite";
const key = readFileSync(homedir() + "/gateway key file", "utf8").trim();
const items = [...JSON.parse(readFileSync(here + "items/qa.json", "utf8")), JSON.parse(readFileSync(here + "items/tasks.json", "utf8")).find((t) => t.id === "d3")];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Only answers with concrete figures are audited (speed).
const CONCRETE = /\d{2,}|\d+\s*(시간|분|원|%|일|개월|년)|☎|전화|번호/;

async function chat(model, messages) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 3000 }),
        signal: AbortSignal.timeout(120000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d.choices?.[0]?.message?.content ?? "";
      if (r.ok && t.trim()) return t;
      await sleep(r.status === 429 ? 15000 : 3000);
    } catch {
      await sleep(3000);
    }
  }
  return "";
}

const SYS = `너는 사실 확인 담당이다. 오늘은 2026-11-25, 대상은 한국 사용자다.
답변에서 구체적인 주장(숫자, 날짜, 소요 시간, 금액, 세율, 시험 문항·시간, 전화번호, 기관명, 법정 기한)만 골라 검토한다.
- 널리 확립된 사실이거나 [참고 자료]와 맞으면 그대로 둔다.
- 틀렸다고 확신하면 올바른 값으로 고친다.
- 확인할 수 없는 전화번호나, 출처 없이 너무 구체적인 세부 수치는 '공식 확인 필요' 문구로 바꾼다.
- 일반 조언, 문장 표현, 형식은 건드리지 않는다. 의심이 없으면 빈 목록을 낸다.
JSON만 출력: {"fixes":[{"find":"답변 안의 정확한 원문 일부(짧게)","replace":"바꿀 문장 일부"}]}`;

const all = JSON.parse(readFileSync(here + "results/raw-free.json", "utf8"));
all[DST] ??= {};
const queue = items.filter((it) => !all[DST][it.id]);
async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const src = all[SRC][it.id];
    const t0 = Date.now();
    let text = src.text;
    let applied = [];
    if (it.kind === "qa" && CONCRETE.test(text)) {
      const out = await chat(VERIFIER, [
        { role: "system", content: SYS },
        { role: "user", content: `[질문]\n${it.prompt}\n\n[답변]\n${text}` },
      ]);
      let fixes = [];
      try {
        fixes = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).fixes ?? [];
      } catch {}
      for (const f of fixes.slice(0, 8)) {
        if (typeof f?.find === "string" && f.find.length >= 2 && typeof f.replace === "string" && text.includes(f.find)) {
          text = text.split(f.find).join(f.replace);
          applied.push(f);
        }
      }
    }
    all[DST][it.id] = { text, ms: (src.ms ?? 0) + (Date.now() - t0), verifyMs: Date.now() - t0, fixes: applied, hard: src.hard };
    writeFileSync(here + "results/raw-free.json", JSON.stringify(all, null, 1));
    console.log(it.id, applied.length, applied.map((f) => `${f.find} => ${f.replace}`).join(" | ").slice(0, 220));
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log("done");
