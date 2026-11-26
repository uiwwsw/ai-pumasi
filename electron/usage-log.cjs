// This file stores only model ids and numeric counters, never prompts or keys.
const path = require("node:path");

const KINDS = ["execute", "analyze", "plan", "work", "review", "merge"];
const MODEL_REGEX = /^[\w.:\/-]{1,80}$/;

function createUsageLog({
  file = null,
  now = () => Date.now(),
  fsImpl = require("node:fs"),
  maxPerKey = 200,
  maxRuns = 50,
} = {}) {
  let data = { version: 1, enabled: true, records: [], runs: [] };

  // 파일에서 초기 데이터 로드
  if (file) {
    try {
      if (fsImpl.existsSync(file)) {
        const content = fsImpl.readFileSync(file, "utf8");
        const parsed = JSON.parse(content);
        if (
          parsed?.version === 1 &&
          Array.isArray(parsed.records) &&
          Array.isArray(parsed.runs)
        ) {
          // records 검증
          const records = [];
          for (const r of parsed.records) {
            if (!r || typeof r !== "object") continue;
            if (typeof r.model !== "string" || !MODEL_REGEX.test(r.model))
              continue;
            if (typeof r.kind !== "string" || !KINDS.includes(r.kind)) continue;
            if (!Number.isInteger(r.inputChars) || r.inputChars < 1) continue;
            if (!Number.isInteger(r.inputTokens) || r.inputTokens < 0) continue;
            if (!Number.isInteger(r.outputTokens) || r.outputTokens < 0)
              continue;
            const at = Number.isFinite(r.at) ? r.at : 0;
            records.push({
              model: r.model,
              kind: r.kind,
              inputChars: r.inputChars,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              at,
            });
          }

          // runs 검증
          const runs = [];
          for (const r of parsed.runs) {
            if (!r || typeof r !== "object") continue;
            if (typeof r.lead !== "string" || !MODEL_REGEX.test(r.lead))
              continue;
            if (typeof r.worker !== "string" || !MODEL_REGEX.test(r.worker))
              continue;
            const validatePercent = (v) =>
              Number.isInteger(v) && v >= 0 && v <= 100;
            if (!validatePercent(r.plan)) continue;
            if (!validatePercent(r.work)) continue;
            if (!validatePercent(r.review)) continue;
            if (!validatePercent(r.merge)) continue;
            const at = Number.isFinite(r.at) ? r.at : 0;
            runs.push({
              lead: r.lead,
              worker: r.worker,
              plan: r.plan,
              work: r.work,
              review: r.review,
              merge: r.merge,
              at,
            });
          }

          // enabled: false일 때만 false
          const enabled = parsed.enabled === false ? false : true;

          data = { version: 1, enabled, records, runs };

          // 로드 후에도 maxPerKey, maxRuns 제한 적용
          applyMaxPerKey(data, maxPerKey);
          applyMaxRuns(data, maxRuns);
        } else {
          data = { version: 1, enabled: true, records: [], runs: [] };
        }
      }
    } catch (e) {
      // 파일이 없거나 JSON이 깨졌거나 버전이 다르면 빈 기록으로 시작
      data = { version: 1, enabled: true, records: [], runs: [] };
    }
  }

  // 파일 저장 함수
  function saveData() {
    if (!file) return;
    try {
      const dir = path.dirname(file);
      if (!fsImpl.existsSync(dir)) {
        fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const tmpFile = `${file}.tmp`;
      fsImpl.writeFileSync(tmpFile, JSON.stringify(data), { mode: 0o600 });
      fsImpl.renameSync(tmpFile, file);
    } catch (e) {
      // 저장 실패는 무시
    }
  }

  // 같은 (model, kind) 조합의 기록이 maxPerKey를 넘으면 가장 오래된 것부터 삭제
  function applyMaxPerKey(store, limit) {
    if (limit <= 0) return;
    const grouped = new Map();
    for (const r of store.records) {
      const key = `${r.model}|${r.kind}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    const filtered = [];
    for (const [, arr] of grouped) {
      if (arr.length > limit) {
        // 가장 오래된 것부터 삭제 (앞에서부터 자르기)
        filtered.push(...arr.slice(-limit));
      } else {
        filtered.push(...arr);
      }
    }
    // 원래 순서 유지 위해 at으로 정렬
    filtered.sort((a, b) => a.at - b.at);
    store.records = filtered;
  }

  // runs가 maxRuns를 넘으면 앞에서부터 삭제
  function applyMaxRuns(store, limit) {
    if (limit <= 0) return;
    if (store.runs.length > limit) {
      store.runs = store.runs.slice(-limit);
    }
  }

  function record({ model, kind, inputChars, inputTokens, outputTokens }) {
    if (!data.enabled) return;
    if (typeof model !== "string" || !MODEL_REGEX.test(model)) return;
    if (typeof kind !== "string" || !KINDS.includes(kind)) return;
    if (!Number.isInteger(inputChars) || inputChars < 1) return;
    if (!Number.isInteger(inputTokens) || inputTokens < 0) return;
    if (!Number.isInteger(outputTokens) || outputTokens < 0) return;

    data.records.push({
      model,
      kind,
      inputChars,
      inputTokens,
      outputTokens,
      at: now(),
    });

    applyMaxPerKey(data, maxPerKey);
    saveData();
  }

  function recordRun({ lead, worker, plan, work, review, merge }) {
    if (!data.enabled) return;
    if (typeof lead !== "string" || !MODEL_REGEX.test(lead)) return;
    if (typeof worker !== "string" || !MODEL_REGEX.test(worker)) return;
    const validatePercent = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
    if (!validatePercent(plan)) return;
    if (!validatePercent(work)) return;
    if (!validatePercent(review)) return;
    if (!validatePercent(merge)) return;

    data.runs.push({
      lead,
      worker,
      plan,
      work,
      review,
      merge,
      at: now(),
    });

    applyMaxRuns(data, maxRuns);
    saveData();
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(data));
  }

  function setEnabled(value) {
    data.enabled = value === true;
    saveData();
  }

  function clear() {
    data.records = [];
    data.runs = [];
    saveData();
  }

  return {
    record,
    recordRun,
    snapshot,
    setEnabled,
    clear,
  };
}

module.exports = { createUsageLog, KINDS };
