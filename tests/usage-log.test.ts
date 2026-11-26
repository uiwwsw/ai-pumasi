import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createUsageLog, KINDS } = require("../electron/usage-log.cjs");

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

test("정상 record 후 snapshot에 at 포함, 파일에 저장되고 새 store로 다시 로드됨", () => {
  const memFs = createMemoryFs();
  const now = (() => {
    let t = 1000;
    return () => t++;
  })();

  const store = createUsageLog({ file: "/usage.json", now, fsImpl: memFs });

  store.record({
    model: "claude-3-opus",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });

  const snap = store.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.records.length, 1);
  assert.equal(snap.records[0].model, "claude-3-opus");
  assert.equal(snap.records[0].kind, "execute");
  assert.equal(snap.records[0].inputChars, 100);
  assert.equal(snap.records[0].inputTokens, 25);
  assert.equal(snap.records[0].outputTokens, 50);
  assert.equal(snap.records[0].at, 1000);

  // 파일에 저장되었는지 확인
  const written = memFs.readFileSync("/usage.json");
  const parsed = JSON.parse(written);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].at, 1000);

  // 새 store로 다시 로드
  const store2 = createUsageLog({
    file: "/usage.json",
    now: () => 2000,
    fsImpl: memFs,
  });
  const snap2 = store2.snapshot();
  assert.equal(snap2.records.length, 1);
  assert.equal(snap2.records[0].model, "claude-3-opus");
  assert.equal(snap2.records[0].at, 1000);
});

test("잘못된 model/kind/음수/소수/inputChars 0 은 무시", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  const store = createUsageLog({ file: "/usage.json", now, fsImpl: memFs });

  // 잘못된 model (빈 문자열)
  store.record({
    model: "",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  // 잘못된 model (너무 김)
  store.record({
    model: "a".repeat(81),
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  // 잘못된 model (특수문자)
  store.record({
    model: "bad model!",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  // 잘못된 kind
  store.record({
    model: "claude-3",
    kind: "invalid",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  // inputChars 0
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 0,
    inputTokens: 25,
    outputTokens: 50,
  });
  // inputChars 음수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: -1,
    inputTokens: 25,
    outputTokens: 50,
  });
  // inputChars 소수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100.5,
    inputTokens: 25,
    outputTokens: 50,
  });
  // inputTokens 음수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: -1,
    outputTokens: 50,
  });
  // inputTokens 소수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25.5,
    outputTokens: 50,
  });
  // outputTokens 음수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: -1,
  });
  // outputTokens 소수
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50.5,
  });

  const snap = store.snapshot();
  assert.equal(snap.records.length, 0);
});

test("maxPerKey=3 일 때 같은 조합 5건 넣으면 최근 3건만, 다른 조합은 그대로", () => {
  const memFs = createMemoryFs();
  const now = (() => {
    let t = 1000;
    return () => t++;
  })();

  const store = createUsageLog({
    file: "/usage.json",
    now,
    fsImpl: memFs,
    maxPerKey: 3,
    maxRuns: 50,
  });

  // 같은 (model, kind) 조합 5건
  store.record({
    model: "model-a",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  store.record({
    model: "model-a",
    kind: "execute",
    inputChars: 200,
    inputTokens: 50,
    outputTokens: 100,
  });
  store.record({
    model: "model-a",
    kind: "execute",
    inputChars: 300,
    inputTokens: 75,
    outputTokens: 150,
  });
  store.record({
    model: "model-a",
    kind: "execute",
    inputChars: 400,
    inputTokens: 100,
    outputTokens: 200,
  });
  store.record({
    model: "model-a",
    kind: "execute",
    inputChars: 500,
    inputTokens: 125,
    outputTokens: 250,
  });

  // 다른 조합 2건
  store.record({
    model: "model-a",
    kind: "analyze",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  store.record({
    model: "model-b",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });

  const snap = store.snapshot();
  // model-a + execute 조합은 최근 3건만 (300, 400, 500)
  const executeRecords = snap.records.filter(
    (r: any) => r.model === "model-a" && r.kind === "execute",
  );
  assert.equal(executeRecords.length, 3);
  assert.equal(executeRecords[0].inputChars, 300);
  assert.equal(executeRecords[1].inputChars, 400);
  assert.equal(executeRecords[2].inputChars, 500);

  // 다른 조합은 그대로 유지
  const analyzeRecords = snap.records.filter(
    (r: any) => r.model === "model-a" && r.kind === "analyze",
  );
  assert.equal(analyzeRecords.length, 1);
  assert.equal(analyzeRecords[0].inputChars, 100);

  const modelBRecords = snap.records.filter(
    (r: any) => r.model === "model-b" && r.kind === "execute",
  );
  assert.equal(modelBRecords.length, 1);
  assert.equal(modelBRecords[0].inputChars, 100);
});

test("setEnabled(false) 후 record/recordRun 무시, 기존 기록 유지, 다시 로드해도 enabled false", () => {
  const memFs = createMemoryFs();
  const now = (() => {
    let t = 1000;
    return () => t++;
  })();

  const store = createUsageLog({ file: "/usage.json", now, fsImpl: memFs });

  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  store.setEnabled(false);
  // enabled false 후 record 무시됨
  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 200,
    inputTokens: 50,
    outputTokens: 100,
  });

  let snap = store.snapshot();
  assert.equal(snap.enabled, false);
  assert.equal(snap.records.length, 1); // 기존 기록 유지
  assert.equal(snap.records[0].inputChars, 100);

  // 다시 로드해도 enabled false
  const store2 = createUsageLog({
    file: "/usage.json",
    now: () => 2000,
    fsImpl: memFs,
  });
  const snap2 = store2.snapshot();
  assert.equal(snap2.enabled, false);
  assert.equal(snap2.records.length, 1);
});

test("clear() 후 records·runs 비고 enabled 유지", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  const store = createUsageLog({ file: "/usage.json", now, fsImpl: memFs });

  store.record({
    model: "claude-3",
    kind: "execute",
    inputChars: 100,
    inputTokens: 25,
    outputTokens: 50,
  });
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: 10,
    work: 20,
    review: 30,
    merge: 40,
  });

  store.clear();

  const snap = store.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.records.length, 0);
  assert.equal(snap.runs.length, 0);
});

test("깨진 JSON, version 2 파일은 빈 기록·enabled true", () => {
  const memFs = createMemoryFs();

  // 깨진 JSON
  memFs.writeFileSync("/usage.json", "not valid json{");
  let store = createUsageLog({ file: "/usage.json", fsImpl: memFs });
  let snap = store.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.records.length, 0);
  assert.equal(snap.runs.length, 0);

  // version 2
  memFs.writeFileSync(
    "/usage.json",
    JSON.stringify({ version: 2, enabled: true, records: [], runs: [] }),
  );
  store = createUsageLog({ file: "/usage.json", fsImpl: memFs });
  snap = store.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.records.length, 0);
  assert.equal(snap.runs.length, 0);

  // version 없는 경우
  memFs.writeFileSync(
    "/usage.json",
    JSON.stringify({ enabled: true, records: [], runs: [] }),
  );
  store = createUsageLog({ file: "/usage.json", fsImpl: memFs });
  snap = store.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.records.length, 0);
  assert.equal(snap.runs.length, 0);
});

test("recordRun 검증과 maxRuns 제한", () => {
  const memFs = createMemoryFs();
  const now = (() => {
    let t = 1000;
    return () => t++;
  })();

  const store = createUsageLog({
    file: "/usage.json",
    now,
    fsImpl: memFs,
    maxPerKey: 200,
    maxRuns: 3,
  });

  // 유효한 recordRun
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: 10,
    work: 20,
    review: 30,
    merge: 40,
  });
  store.recordRun({
    lead: "lead-2",
    worker: "worker-2",
    plan: 20,
    work: 30,
    review: 40,
    merge: 50,
  });
  store.recordRun({
    lead: "lead-3",
    worker: "worker-3",
    plan: 30,
    work: 40,
    review: 50,
    merge: 60,
  });
  store.recordRun({
    lead: "lead-4",
    worker: "worker-4",
    plan: 40,
    work: 50,
    review: 60,
    merge: 70,
  });

  let snap = store.snapshot();
  assert.equal(snap.runs.length, 3); // maxRuns=3이므로 최근 3개만
  assert.equal(snap.runs[0].lead, "lead-2");
  assert.equal(snap.runs[1].lead, "lead-3");
  assert.equal(snap.runs[2].lead, "lead-4");

  // 잘못된 값들 - 무시되어야 함
  store.recordRun({
    lead: "",
    worker: "worker-1",
    plan: 10,
    work: 20,
    review: 30,
    merge: 40,
  });
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: -1,
    work: 20,
    review: 30,
    merge: 40,
  });
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: 101,
    work: 20,
    review: 30,
    merge: 40,
  });
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: 10.5,
    work: 20,
    review: 30,
    merge: 40,
  });
  store.recordRun({
    lead: "lead-1",
    worker: "worker-1",
    plan: 10,
    work: 20,
    review: 30,
    merge: 40,
    extra: "field",
  }); // extra 필드는 무시됨 (검증 통과)

  snap = store.snapshot();
  // 여전히 3개 유지 (새로운 유효한 것 없음)
  assert.equal(snap.runs.length, 3);
});

test("파일에 프롬프트 같은 다른 필드가 섞인 record를 넣어도 저장 결과에 그 필드가 없다", () => {
  const memFs = createMemoryFs();
  const now = () => 1000;

  // 파일에 text 필드가 있는 record를 직접 넣음
  memFs.writeFileSync(
    "/usage.json",
    JSON.stringify({
      version: 1,
      enabled: true,
      records: [
        {
          model: "claude-3",
          kind: "execute",
          inputChars: 100,
          inputTokens: 25,
          outputTokens: 50,
          at: 1000,
          text: "비밀 프롬프트 내용",
          secretKey: "sk-12345",
        },
      ],
      runs: [],
    }),
  );

  // 로드 후 저장 트리거 (setEnabled로 저장 유도)
  const store = createUsageLog({ file: "/usage.json", now, fsImpl: memFs });
  store.setEnabled(true); // 저장 트리거
  const snap = store.snapshot();

  // text, secretKey 필드가 없어야 함
  assert.equal(snap.records.length, 1);
  assert.equal("text" in snap.records[0], false);
  assert.equal("secretKey" in snap.records[0], false);
  assert.equal(snap.records[0].model, "claude-3");
  assert.equal(snap.records[0].kind, "execute");
  assert.equal(snap.records[0].inputChars, 100);

  // 파일에 저장된 내용에도 text, secretKey가 없어야 함
  const written = memFs.readFileSync("/usage.json");
  const parsed = JSON.parse(written);
  assert.equal("text" in parsed.records[0], false);
  assert.equal("secretKey" in parsed.records[0], false);
  assert.equal(written.includes("비밀"), false);
  assert.equal(written.includes("sk-12345"), false);
});
