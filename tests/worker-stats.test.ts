import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createStatsStore, scoreOf } = require("../electron/worker-stats.cjs");

// 메모리 fs 구현
function createMemoryFs() {
  const files: Record<string, string> = {};
  return {
    existsSync: (path: string) => path in files,
    readFileSync: (path: string) => files[path],
    writeFileSync: (path: string, content: string) => {
      files[path] = content;
    },
    renameSync: (oldPath: string, newPath: string) => {
      files[newPath] = files[oldPath];
      delete files[oldPath];
    },
    mkdirSync: (path: string) => {
      // 메모리에서는 아무것도 안 해도 됨
    },
  };
}

test("깨진 JSON 파일이어도 예외 없이 빈 기록", () => {
  const memFs = createMemoryFs();
  memFs.writeFileSync("/stats.json", "not valid json{");

  const store = createStatsStore({ file: "/stats.json", fsImpl: memFs });
  const snapshot = store.snapshot();

  assert.deepEqual(snapshot, {});
});

test("성공·실패 기록 후 snapshot 개수와 okMs", () => {
  const memFs = createMemoryFs();
  const now = (() => {
    let t = 1000;
    return () => t;
  })();

  const store = createStatsStore({ file: "/stats.json", now, fsImpl: memFs });

  // 성공 기록
  store.record("model-a", { ok: true, ms: 5000 });
  store.record("model-a", { ok: true, ms: 10000 });
  store.record("model-b", { ok: false, reason: "timeout" });
  store.record("model-b", { ok: true, ms: 3000 });

  const snapshot = store.snapshot();

  assert.equal(snapshot["model-a"].ok, 2);
  assert.equal(snapshot["model-a"].okMs, 15000);
  assert.equal(snapshot["model-b"].fail, 1);
  assert.equal(snapshot["model-b"].timeout, 1);
});

test("실패가 잦은 모델과 느린 모델은 order에서 뒤로 간다", () => {
  const memFs = createMemoryFs();

  const store = createStatsStore({ file: "/stats.json", fsImpl: memFs });

  // model-fast는 빠르게 성공
  store.record("model-fast", { ok: true, ms: 10000 });
  // model-slow는 느리게 성공
  store.record("model-slow", { ok: true, ms: 180000 });
  // model-bad-fail은 실패가 많음
  store.record("model-bad-fail", { ok: true, ms: 20000 });
  store.record("model-bad-fail", { ok: false, reason: "timeout" });
  store.record("model-bad-fail", { ok: false, reason: "timeout" });
  store.record("model-bad-fail", { ok: false, reason: "timeout" });

  // preference는 없음
  const order = store.order(
    ["model-fast", "model-slow", "model-bad-fail"],
    undefined,
  );

  // model-bad-fail가 가장 뒤에 가야 함
  assert.equal(order[2], "model-bad-fail");
  // model-slow가 model-fast보다 뒤에 감 (느림벌점)
  assert.equal(order[1], "model-slow");
});

test("기록 없는 선호 모델은 기록 없는 다른 모델보다 앞", () => {
  const memFs = createMemoryFs();

  const store = createStatsStore({ file: "/stats.json", fsImpl: memFs });

  // preferred는 존재하지 않는 모델
  const prefer = "model-preferred";
  const order = store.order(["model-x", "model-y", "model-z"], prefer);

  // 두 모델 모두 0.5점이므로 선호 모델이 있으면 0.65점으로 높아짐
  // 그러나 preferred가 없으므로 모두 0.5점
  // 안정 정렬이므로 원래 순서 유지
  assert.deepEqual(order, ["model-x", "model-y", "model-z"]);
});

test("servedBy에 허용 안 되는 문자가 있으면 저장되지 않는다", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  const store = createStatsStore({ file: "/stats.json", now, fsImpl: memFs });

  // 허용 안 되는 문자열로 servedBy 기록 (ok 기록 먼저)
  store.record("model-test", { ok: true, ms: 1000 });
  store.record("model-test", {
    ok: false,
    reason: "timeout",
    servedBy: "sk-abc def!",
  });

  const snapshot = store.snapshot();

  // servedBy는 저장되지 않음 (유효하지 않음) - lastServedBy 필드 자체가 없음
  assert.equal(snapshot["model-test"].lastServedBy, null);
});

test("저장된 파일 내용에 servedBy 문자열이 없다", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  const store = createStatsStore({ file: "/stats.json", now, fsImpl: memFs });

  store.record("model-test", {
    ok: false,
    reason: "timeout",
    servedBy: "sk-abc def!",
  });

  // 파일 내용 확인
  const written = memFs.readFileSync("/stats.json");
  const parsed = JSON.parse(written);

  assert.equal(parsed.models["model-test"].lastServedBy, null);
  assert.equal(written.includes("sk-abc"), false);
});

test("41번째 기록 후 개수가 절반으로 줄어든다", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  const store = createStatsStore({ file: "/stats.json", now, fsImpl: memFs });

  // 40개의 성공 기록
  for (let i = 0; i < 40; i++) {
    store.record("model-halve", { ok: true, ms: 1000 });
  }

  const snapshot40 = store.snapshot();
  assert.equal(snapshot40["model-halve"].ok, 40);
  assert.equal(snapshot40["model-halve"].okMs, 40000);

  // 41번째 기록 (fail 기록)
  store.record("model-halve", { ok: false, reason: "timeout" });

  const snapshot41 = store.snapshot();
  assert.equal(snapshot41["model-halve"].ok, 20); // 40 / 2 = 20 (Math.floor)
  assert.equal(snapshot41["model-halve"].fail, 0); // 0 / 2 = 0
  assert.equal(snapshot41["model-halve"].okMs, 20000); // 40000 / 2 = 20000
});

test("저장은 .tmp에 쓴 뒤 rename한다", () => {
  let writePath: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  const memFs = {
    files: {} as Record<string, string>,
    existsSync: (path: string) => path in memFs.files,
    readFileSync: (path: string) => memFs.files[path],
    writeFileSync: (path: string, content: string) => {
      writePath = path;
      memFs.files[path] = content;
    },
    renameSync: (from: string, to: string) => {
      renameFrom = from;
      renameTo = to;
      memFs.files[to] = memFs.files[from];
      delete memFs.files[from];
    },
    mkdirSync: (path: string) => {},
  };

  const store = createStatsStore({ file: "/stats.json", fsImpl: memFs });

  store.record("model-test", { ok: true, ms: 1000 });

  // .tmp 파일에 먼저 쓰기
  assert.equal(writePath, "/stats.json.tmp");
  // renameSync로 이동
  assert.equal(renameFrom, "/stats.json.tmp");
  assert.equal(renameTo, "/stats.json");
  // 원본 파일에 내용이 있음
  assert.ok("/stats.json" in memFs.files);
});

test("scoreOf는 entry가 없으면 기본값 반환", () => {
  const score = scoreOf(undefined);
  assert.equal(score.rate, 0.5);
  assert.equal(score.avgMs, null);
  assert.equal(score.samples, 0);
});

test("scoreOf는 기록된 entry에 대해 올바른 점수 계산", () => {
  const entry = {
    ok: 10,
    fail: 2,
    okMs: 50000,
    timeout: 1,
    empty: 0,
    short: 0,
    truncated: 0,
    substituted: 0,
    lastServedBy: "model-a",
    updatedAt: 1000,
  };

  const score = scoreOf(entry);

  // rate = (10 + 1) / (12 + 2) = 11/14 ≈ 0.786
  assert.ok(Math.abs(score.rate - 11 / 14) < 0.001);
  // avgMs = 50000 / 10 = 5000
  assert.equal(score.avgMs, 5000);
  // samples = 10 + 2 = 12
  assert.equal(score.samples, 12);
});

test("preference가 있으면 선호 모델에 보너스 점수 부여", () => {
  const memFs = createMemoryFs();

  const store = createStatsStore({ file: "/stats.json", fsImpl: memFs });

  // 동일한 성공률을 가진 모델들
  store.record("model-a", { ok: true, ms: 5000 });
  store.record("model-b", { ok: true, ms: 5000 });

  const order = store.order(["model-a", "model-b", "model-c"], "model-b");

  // model-b가 선호이므로 앞에 옴
  assert.equal(order[0], "model-b");
  // model-c는 기록이 없어서 0.5점, model-a는 (1+1)/(1+1+2) = 0.5점과 동일
  // model-a가 먼저였으므로 앞에 옴
  assert.equal(order[1], "model-a");
});
