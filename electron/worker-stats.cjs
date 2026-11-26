const path = require("node:path");
// Local per-model track record for team-mode workers. Holds model ids and numbers only, never keys.
const COUNTS = [
  "ok",
  "fail",
  "timeout",
  "empty",
  "short",
  "truncated",
  "substituted",
  "okMs",
];

function createStatsStore({
  file = null,
  now = () => Date.now(),
  fsImpl = require("node:fs"),
} = {}) {
  let data = { version: 1, models: {} };

  // modelId와 servedBy가 유효한지 확인하는 정규식
  const validId = /^[\w.:\/-]{1,80}$/;

  // 파일에서 초기 데이터 로드
  if (file) {
    try {
      if (fsImpl.existsSync(file)) {
        const content = fsImpl.readFileSync(file, "utf8");
        const parsed = JSON.parse(content);
        if (
          parsed?.version === 1 &&
          parsed.models &&
          typeof parsed.models === "object" &&
          !Array.isArray(parsed.models)
        ) {
          // Keep only well-formed entries; any non-number count becomes 0.
          const models = {};
          for (const [id, entry] of Object.entries(parsed.models)) {
            if (!validId.test(id) || !entry || typeof entry !== "object")
              continue;
            const clean = { lastServedBy: null, updatedAt: 0 };
            for (const k of COUNTS)
              clean[k] =
                Number.isFinite(entry[k]) && entry[k] >= 0 ? entry[k] : 0;
            if (
              typeof entry.lastServedBy === "string" &&
              validId.test(entry.lastServedBy)
            )
              clean.lastServedBy = entry.lastServedBy;
            if (Number.isFinite(entry.updatedAt))
              clean.updatedAt = entry.updatedAt;
            models[id] = clean;
          }
          data = { version: 1, models };
        } else {
          data = { version: 1, models: {} };
        }
      }
    } catch (e) {
      // 파일이 없거나 JSON이 깨졌거나 버전이 다르면 빈 기록으로 시작
      data = { version: 1, models: {} };
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

  function record(model, outcome) {
    if (typeof model !== "string" || !validId.test(model)) return;
    const ms = Number.isFinite(outcome?.ms) && outcome.ms >= 0 ? outcome.ms : 0;

    const entry = (data.models[model] = data.models[model] || {
      ok: 0,
      fail: 0,
      timeout: 0,
      empty: 0,
      short: 0,
      truncated: 0,
      substituted: 0,
      okMs: 0,
      lastServedBy: null,
      updatedAt: 0,
    });

    if (outcome.ok) {
      entry.ok += 1;
      entry.okMs += ms;
    } else {
      entry.fail += 1;
      if (outcome.reason === "timeout") entry.timeout += 1;
      else if (outcome.reason === "empty") entry.empty += 1;
      else if (outcome.reason === "short") entry.short += 1;
      else if (outcome.reason === "truncated") entry.truncated += 1;
    }

    if (outcome.substituted) {
      entry.substituted += 1;
    }

    if (typeof outcome.servedBy === "string" && validId.test(outcome.servedBy))
      entry.lastServedBy = outcome.servedBy;

    entry.updatedAt = now();

    // 오래된 기록 정리: ok + fail이 40을 넘으면 절반으로
    if (entry.ok + entry.fail > 40) {
      entry.ok = Math.floor(entry.ok / 2);
      entry.fail = Math.floor(entry.fail / 2);
      entry.timeout = Math.floor(entry.timeout / 2);
      entry.empty = Math.floor(entry.empty / 2);
      entry.short = Math.floor(entry.short / 2);
      entry.truncated = Math.floor(entry.truncated / 2);
      entry.substituted = Math.floor(entry.substituted / 2);
      entry.okMs = Math.floor(entry.okMs / 2);
    }

    saveData();
  }

  function order(ids, preferred) {
    const entries = ids.map((id) => ({
      id,
      ...scoreOf(data.models[id]),
    }));

    // 점수 계산: rate - 느림벌점 + 선호보너스
    const scored = entries.map((e) => {
      const penalty =
        e.avgMs !== null ? Math.min(e.avgMs / 120000, 1) * 0.3 : 0;
      const bonus = e.id === preferred ? 0.15 : 0;
      return {
        id: e.id,
        score: e.rate - penalty + bonus,
        originalOrder: ids.indexOf(e.id),
      };
    });

    // 점수 내림차순, 같으면 원래 순서 유지 (안정 정렬)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalOrder - b.originalOrder;
    });

    return scored.map((s) => s.id);
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(data.models));
  }

  return { record, order, snapshot };
}

function scoreOf(entry) {
  if (!entry) {
    return { rate: 0.5, avgMs: null, samples: 0 };
  }
  const total = entry.ok + entry.fail;
  const rate = (entry.ok + 1) / (total + 2);
  const avgMs = entry.ok > 0 ? entry.okMs / entry.ok : null;
  return { rate, avgMs, samples: total };
}

module.exports = { createStatsStore, scoreOf };
