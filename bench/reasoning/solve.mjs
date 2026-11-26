// Solve the reasoning exam with free models and a majority vote (Aurora bundle).
// Usage: node solve.mjs <exam_dir> [model,model,...] [weights.json]   -> <exam_dir>/free-answers.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const dir = process.argv[2];
const key = readFileSync(homedir() + "/.omniroute/claude-code.key", "utf8").trim();
const questions = JSON.parse(readFileSync(dir + "/questions.json", "utf8"));
// Order matters: vote ties go to the earlier model.
const DEFAULT_MODELS = [
  "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
  "groq/openai/gpt-oss-120b",
  "gemini/gemini-3.1-flash-lite",
  "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b",
];
const argvModels = process.argv[3];
const MODELS = argvModels !== undefined && argvModels !== ""
  ? argvModels.split(",")
  : DEFAULT_MODELS;
// Optional weights file (third argument)
const weightsPath = process.argv[4];
let weights = { models: {} };
if (weightsPath && existsSync(weightsPath)) {
  weights = JSON.parse(readFileSync(weightsPath, "utf8"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 답 추출 함수 (포맷별)
export const extract = (t, format) => {
  const text = String(t ?? "");

  // format이 없으면 기존 동작 (정답: X)
  if (!format) {
    const m = [...text.matchAll(/정답\s*[:：]\s*`?([^`\n]+)`?/g)].pop();
    return m ? m[1].trim().replace(/[*.\s]+$/g, "").replace(/^\*+/, "") : "";
  }

  // boxed: \boxed{...} 내부 내용 추출
  if (format === "boxed") {
    // 마지막 \boxed{ 위치 찾기 (실제 LaTeX: \boxed{...})
    const lastBoxedIdx = text.lastIndexOf("\\boxed{");
    if (lastBoxedIdx !== -1) {
      // 그 위치부터 중괄호 깊이 카운트
      let depth = 1;
      let start = lastBoxedIdx + 7; // "\\boxed{" 길이 = 7
      for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) {
            return text.slice(start, i).trim();
          }
        }
      }
    }
    // fallback: 정답: X
    const m = [...text.matchAll(/정답\s*[:：]\s*`?([^`\n]+)`?/g)].pop();
    return m ? m[1].trim().replace(/[*.\s]+$/g, "").replace(/^\*+/, "") : "";
  }

  // solution: <solution>내용</solution> 추출
  if (format === "solution") {
    const m = [...text.matchAll(/<solution>([\s\S]*?)<\/solution>/g)].pop();
    if (m) return m[1].trim();
    // fallback: 정답: X
    const m2 = [...text.matchAll(/정답\s*[:：]\s*`?([^`\n]+)`?/g)].pop();
    return m2 ? m2[1].trim().replace(/[*.\s]+$/g, "").replace(/^\*+/, "") : "";
  }

  return "";
};

// 정규화 함수 (포맷별)
export const norm = (s) => String(s).replace(/[\s*`<>]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/명$|시간$|원$/, "");

export const normFor = (s, format) => {
  if (!format) return norm(s);

  if (format === "boxed") {
    // 공백, $, 쉼표, \text{...} 껍데기 제거, 앞의 0 제거
    let result = String(s)
      .replace(/[\s,]+/g, "")  // 공백, 쉼표 제거
      .replace(/\$/g, "")     // $ 제거
      .replace(/\\[a-zA-Z]+\{/g, "")  // \text{, \mathbf{ 같은 껍데기 제거
      .replace(/\}/g, "")       // } 제거
      .replace(/\\text/g, ""); // 남은 \text도 제거
    // 앞의 0 제거 (숫자만 남김)
    if (/^\d+$/.test(result)) {
      result = result.replace(/^0+(?=\d)/, "") || "0";
    }
    return result;
  }

  if (format === "solution") {
    // 소문자로, - -> 공백, 연속 공백 -> 하나, ", " 로 다시 연결
    return String(s)
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .split(",")
      .map(p => p.trim())
      .filter(p => p)
      .join(", ");
  }

  return norm(s);
};

async function ask(model, prompt, format) {
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
      if (r.ok && text.trim() && same) return { text, answer: extract(text, format), ms: Date.now() - t0 };
      if (r.ok && !same) return { text: "", answer: "", error: "fallback " + served };
      await sleep(r.status === 429 || r.status === 503 ? 45000 * (i + 1) : 5000);
    } catch {
      await sleep(5000);
    }
  }
  return { text: "", answer: "", error: "failed" };
}

/**
 * Tally votes and weighted votes from model answers.
 * @param {Array} runs - Array of {answer, error, ms, modelId} per model
 * @param {string} kind - Question kind
 * @param {Object} weights - Weights object with models[modelId][kind] or models[modelId]._all
 * @param {string} format - Answer format (boxed, solution, or undefined)
 * @returns {Object} { vote, votes, wvote, wscore }
 */
function tally(runs, kind, weights, format) {
  // solution 포맷은 칸별 투표
  if (format === "solution") {
    // 비어있지 않은 모델들만 필터링
    const validRuns = runs.filter(r => r.answer && r.answer.trim());

    if (validRuns.length === 0) {
      return { vote: "", votes: 0, wvote: "", wscore: 0 };
    }

    // 각 모델의 답을 칸으로 나누기
    const answersPerModel = validRuns.map(r => {
      const normalized = normFor(r.answer, format);
      const items = normalized.split(", ").map(s => s.trim()).filter(s => s);
      return {
        answer: r.answer,
        normalized: normalized,
        items: items,
        modelId: r.modelId,
        originalIndex: runs.indexOf(r)
      };
    });

    // 최대 칸 수
    const maxCells = Math.max(...answersPerModel.map(a => a.items.length), 1);

    // 각 칸별 투표
    let voteParts = [];
    let wvoteParts = [];
    let totalWscore = 0;

    for (let cellIdx = 0; cellIdx < maxCells; cellIdx++) {
      // Majority vote (simple)
      const cellCountMap = new Map();
      answersPerModel.forEach((a, i) => {
        const cellVal = a.items[cellIdx];
        if (!cellVal) return;
        const k = norm(cellVal);
        const e = cellCountMap.get(k) ?? { n: 0, first: i, raw: cellVal };
        e.n++;
        cellCountMap.set(k, e);
      });
      const best = [...cellCountMap.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0];
      voteParts.push(best?.raw ?? "");

      // Weighted vote
      const wsum = new Map();
      answersPerModel.forEach((a, i) => {
        const cellVal = a.items[cellIdx];
        if (!cellVal) return;
        const k = norm(cellVal);
        const modelId = a.modelId;
        let w = 0.1;
        if (weights.models[modelId]) {
          w = weights.models[modelId][kind] ?? weights.models[modelId]._all ?? 0.1;
        }
        const e = wsum.get(k) ?? { sum: 0, count: 0, first: i, raw: cellVal };
        e.sum += w;
        e.count++;
        wsum.set(k, e);
      });
      const wbest = [...wsum.values()].sort((a, b) => b.sum - a.sum || b.count - a.count || a.first - b.first)[0];
      wvoteParts.push(wbest?.raw ?? "");
      totalWscore += wbest ? wbest.sum : 0;
    }

    const vote = voteParts.join(", ");
    const wvote = wvoteParts.join(", ");
    const wscore = Number((totalWscore / maxCells).toFixed(3));

    // votes: 모든 칸이 vote와 같은 모델 수
    // 각 모델의 정규화된 답이 vote와 일치하는지 비교
    const votes = answersPerModel.filter(a => {
      const normalizedParts = a.items;
      if (normalizedParts.length !== maxCells) return false;
      return normalizedParts.every((part, idx) => part === voteParts[idx]);
    }).length;

    return { vote, votes, wvote, wscore };
  }

  // boxed / 없음: 기존 방식 (정규화한 답 단위로 다수결)
  // Majority vote
  const countMap = new Map();
  runs.forEach((r, i) => {
    if (!r.answer) return;
    const k = normFor(r.answer, format);
    const e = countMap.get(k) ?? { n: 0, first: i, raw: r.answer };
    e.n++;
    countMap.set(k, e);
  });
  const best = [...countMap.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0];
  const vote = best?.raw ?? "";
  const votes = best?.n ?? 0;

  // Weighted vote
  const wsum = new Map();
  runs.forEach((r, i) => {
    if (!r.answer) return;
    const k = normFor(r.answer, format);
    const modelId = r.modelId;
    // Get weight for this model/kind
    let w = 0.1;
    if (weights.models[modelId]) {
      w = weights.models[modelId][kind] ?? weights.models[modelId]._all ?? 0.1;
    }
    const e = wsum.get(k) ?? { sum: 0, count: 0, first: i, raw: r.answer };
    e.sum += w;
    e.count++;
    wsum.set(k, e);
  });
  const wbest = [...wsum.values()].sort((a, b) => b.sum - a.sum || b.count - a.count || a.first - b.first)[0];
  const wvote = wbest?.raw ?? "";
  const wscore = wbest ? Number(wbest.sum.toFixed(3)) : 0;

  return { vote, votes, wvote, wscore };
}

const outPath = dir + "/free-answers.json";
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const queue = questions.filter((q) => !out[q.id]);
async function worker() {
  while (queue.length) {
    const q = queue.shift();
    const t0 = Date.now();
    const format = q.format; // 문제의 포맷
    const runs = await Promise.all(MODELS.map((m, i) => {
      const r = ask(m, q.prompt, format);
      // Add modelId to each result
      return r.then(res => ({ ...res, modelId: m }));
    }));
    // Majority vote on normalized answers; ties go to the earlier (stronger) model.
    const kind = q.kind;
    const { vote, votes, wvote, wscore } = tally(runs, kind, weights, format);
    out[q.id] = { vote, votes, wvote, wscore, ms: Date.now() - t0, models: Object.fromEntries(MODELS.map((m, i) => [m, { answer: runs[i].answer, error: runs[i].error, ms: runs[i].ms }])) };
    writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log(q.no, q.id, "vote:", out[q.id].vote, `(${out[q.id].votes}/${MODELS.length})`, "wvote:", out[q.id].wvote, `(${out[q.id].wscore})`, runs.map((r) => r.answer || r.error || "-").join(" | ").slice(0, 160));
  }
}
await Promise.all([worker(), worker(), worker()]);

// After all workers done, re-tally ALL entries in free-answers.json (including previously solved)
// using the model list stored in each entry's models object.
const idToKind = Object.fromEntries(questions.map((q) => [q.id, q.kind]));
const idToFormat = Object.fromEntries(questions.map((q) => [q.id, q.format]));
for (const [qid, entry] of Object.entries(out)) {
  if (!entry.models) continue;
  const kind = idToKind[qid];
  const format = idToFormat[qid];
  if (!kind) continue;
  const modelIds = Object.keys(entry.models);
  const runs = modelIds.map((m) => ({ ...entry.models[m], modelId: m }));
  const { vote, votes, wvote, wscore } = tally(runs, kind, weights, format);
  out[qid].vote = vote;
  out[qid].votes = votes;
  out[qid].wvote = wvote;
  out[qid].wscore = wscore;
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log("done");
