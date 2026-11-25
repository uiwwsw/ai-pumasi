// Blind-judge each packet item through OmniRoute's auto router (user choice, 2026-11-25).
// Usage: node bench/judge_auto.mjs [router-model]   -> results/judge-auto.json
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const router = process.argv[2] ?? "auto";
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const outPath = here + "results/judge-auto.json";
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `너는 AI 답변을 출처를 모른 채 채점하는 엄격한 평가자다. 오늘은 2026-11-25다.
질문 하나와 여러 답(레이블 A, B, ...)이 주어진다. 각 답에 1~10점을 매긴다.
- 정확성(가장 중요): 사실 오류, 계산 실수, 앞뒤 모순, 위험한 조언, 그럴듯하게 지어낸 구체 정보(숫자, 이름, 기관, 가격)를 찾는다.
- 쉬움: 처음 쓰는 사람이 바로 이해하고 따라 할 수 있는가.
- 도움: 원하는 것을 얻는가. 쓸데없이 길거나 되묻기만 하면 감점.
확인할 수 없는 최신 정보는 감점도 가점도 하지 않는다.
fabricated는 사실이 아닌 구체 정보를 지어냈으면 true.
JSON 하나만 출력한다: {"scores":{"A":{"score":정수,"fabricated":true|false,"error":"틀린 점 또는 빈 문자열"}, ...}}`;

async function judge(item) {
  const labels = Object.keys(item.answers);
  const user = `질문: ${item.question}\n\n` + labels.map((l) => `[${l}]\n${item.answers[l]}`).join("\n\n");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: router,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
          max_tokens: 8000,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(240000),
      });
      const d = await r.json().catch(() => ({}));
      const text = d.choices?.[0]?.message?.content ?? "";
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      const j = a >= 0 ? JSON.parse(text.slice(a, b + 1)) : null;
      const s = j?.scores;
      if (s && labels.every((l) => Number.isFinite(s[l]?.score))) return { scores: s, judgedBy: d.model ?? "" };
    } catch {}
    await sleep(8000);
  }
  return { error: "judge failed" };
}

const files = readdirSync(here + "judge").filter((f) => f.startsWith("packet-")).sort();
for (const f of files) {
  const items = JSON.parse(readFileSync(here + "judge/" + f, "utf8"));
  await Promise.all(
    items.map(async (item) => {
      if (out[item.id]?.scores) return;
      out[item.id] = await judge(item);
      writeFileSync(outPath, JSON.stringify(out, null, 1));
      console.log(item.id, out[item.id].scores ? "ok " + out[item.id].judgedBy : out[item.id].error);
    }),
  );
}
console.log("done");
