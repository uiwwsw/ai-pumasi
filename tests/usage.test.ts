import test from "node:test";
import assert from "node:assert/strict";
import {
  inputChars,
  quantile,
  inferCall,
  project,
  projectTeam,
  MIN_SAMPLES,
} from "../src/usage";
import type { Model } from "../src/routing";
import type { Message } from "../src/domain";
import type { UsageHistory, UsageRecord, TeamRun } from "../src/usage";

const mockLead: Model = {
  id: "lead-model",
  name: "Lead",
  provider: "anthropic",
  tier: "standard",
};
const mockWorker: Model = {
  id: "worker-model",
  name: "Worker",
  provider: "gemini",
  tier: "light",
};
const mockContext: Message[] = [
  { id: "1", role: "user", text: "context message" },
];

test("quantile interpolation works correctly", () => {
  const arr = [10, 20, 30, 40];
  assert.equal(quantile(arr, 0.5), 25);
  assert.equal(quantile(arr, 0), 10);
  assert.equal(quantile(arr, 1), 40);
  assert.equal(quantile(arr, 0.25), 17.5);
  assert.equal(quantile(arr, 0.75), 32.5);
});

test("quantile returns NaN for empty array", () => {
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test("inputChars sums prompt and context lengths", () => {
  assert.equal(inputChars("hello", []), 5);
  assert.equal(inputChars("hello", [{ text: "world" }]), 10);
  assert.equal(inputChars("", [{ text: "a" }, { text: "bc" }]), 3);
});

test("project with insufficient history uses default basis", () => {
  const history: UsageHistory = { enabled: true, records: [], runs: [] };
  const result = project("test prompt", mockContext, null, mockWorker, history);

  assert.equal(result.basis, "default");
  assert.equal(result.samples, 0);
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].kind, "execute");
  assert.deepEqual(result.stages[0].calls, [1, 1]);
  assert.equal(result.stages[0].samples, 0);
});

test("project uses history values for input/output/total when history available", () => {
  // execute 기록 10건: tokens = 50 + 0.5*chars
  const records: UsageRecord[] = [];
  const recordChars = 500; // history record의 chars
  for (let i = 0; i < 10; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: recordChars,
      inputTokens: Math.round(50 + recordChars * 0.5),
      outputTokens: 100,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };

  // 프로젝트 호출 시 실제 프롬프트 길이
  const prompt = "test prompt";
  const context: Message[] = [
    { id: "1", role: "user", text: "context message" },
  ];
  const actualChars = inputChars(prompt, context); // 10 + 16 = 26

  const result = project(prompt, context, null, mockWorker, history);

  // input은 history에서 추론된 값
  // ratio = inputTokens/inputChars = (50 + 0.5*500)/500 = 200
  const ratio = (50 + recordChars * 0.5) / recordChars;
  const expectedInput = Math.ceil(ratio * actualChars);
  assert.equal(result.input, expectedInput);
  // total[0] === input + output[0]
  assert.equal(result.total[0], result.input + result.output[0]);
  assert.equal(result.basis, "history");
  assert.equal(result.samples, 10);
});

test("project percent uses project total, not estimate total", () => {
  const records: UsageRecord[] = [];
  const chars = 100;
  for (let i = 0; i < 10; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: chars,
      inputTokens: Math.round(50 + chars * 0.5),
      outputTokens: 100,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };
  const budget = 100000;

  const result = project(
    "test prompt",
    mockContext,
    budget,
    mockWorker,
    history,
  );

  assert.ok(result.percent !== null);
  if (result.percent) {
    // percent[0] === total[0]/1000 (budget이 100000이므로 100으로 나눔)
    assert.equal(result.percent[0], (result.total[0] / budget) * 100);
  }
});

test("project uses ratio method when inputChars have low variance", () => {
  const records: UsageRecord[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: 500,
      inputTokens: 300,
      outputTokens: 200 + i * 10,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };

  const result = project("test prompt", mockContext, null, mockWorker, history);

  assert.equal(result.basis, "history");
  assert.equal(result.samples, 10);
});

test("project ignores records with different model or kind", () => {
  const records: UsageRecord[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      model: "other-model",
      kind: "execute",
      inputChars: 100 + i * 90,
      inputTokens: Math.round(50 + (100 + i * 90) * 0.5),
      outputTokens: 100 + i * 100,
      at: Date.now() + i,
    });
    records.push({
      model: "worker-model",
      kind: "analyze",
      inputChars: 100 + i * 90,
      inputTokens: Math.round(50 + (100 + i * 90) * 0.5),
      outputTokens: 100 + i * 100,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };

  const result = project("test prompt", mockContext, null, mockWorker, history);

  assert.equal(result.basis, "default");
  assert.equal(result.samples, 0);
});

test("project with disabled history uses default basis", () => {
  const records: UsageRecord[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: 100 + i * 90,
      inputTokens: Math.round(50 + (100 + i * 90) * 0.5),
      outputTokens: 100 + i * 100,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: false, records, runs: [] };

  const result = project("test prompt", mockContext, null, mockWorker, history);

  assert.equal(result.basis, "default");
  assert.equal(result.samples, 0);
});

test("project with null history uses default basis", () => {
  const result = project("test prompt", mockContext, null, mockWorker, null);

  assert.equal(result.basis, "default");
  assert.equal(result.samples, 0);
});

test("project percent is calculated correctly with budget", () => {
  const history: UsageHistory = { enabled: true, records: [], runs: [] };
  const budget = 100000;
  const result = project(
    "test prompt",
    mockContext,
    budget,
    mockWorker,
    history,
  );

  const expectedLow = (result.total[0] / budget) * 100;
  const expectedHigh = (result.total[1] / budget) * 100;
  assert.ok(result.percent !== null);
  if (result.percent) {
    assert.equal(result.percent[0], expectedLow);
    assert.equal(result.percent[1], expectedHigh);
  }
});

test("projectTeam with null history uses default basis and 4 stages", () => {
  const result = projectTeam(
    "test prompt",
    mockContext,
    null,
    mockLead,
    mockWorker,
    null,
  );

  assert.equal(result.basis, "default");
  assert.equal(result.stages.length, 4);
  assert.equal(result.stages[0].kind, "plan");
  assert.equal(result.stages[1].kind, "work");
  assert.equal(result.stages[2].kind, "review");
  assert.equal(result.stages[3].kind, "merge");
  assert.deepEqual(result.stages[0].calls, [1, 1]);
  assert.deepEqual(result.stages[1].calls, [2, 4]);
  assert.deepEqual(result.stages[2].calls, [1, 2]);
  assert.deepEqual(result.stages[3].calls, [0, 1]);
});

test("projectTeam with only lead plan history uses mixed basis", () => {
  const records: UsageRecord[] = [];
  for (let i = 0; i < 6; i++) {
    records.push({
      model: "lead-model",
      kind: "plan",
      inputChars: 100 + i * 50,
      inputTokens: 200 + i * 10,
      outputTokens: 300 + i * 50,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };

  const result = projectTeam(
    "test prompt",
    mockContext,
    null,
    mockLead,
    mockWorker,
    history,
  );

  assert.equal(result.basis, "mixed");
  assert.ok(result.samples > 0);
});

test("projectTeam with sufficient runs uses run quantiles for calls", () => {
  const runs: TeamRun[] = [];
  for (let i = 0; i < 6; i++) {
    runs.push({
      lead: "lead-model",
      worker: "worker-model",
      plan: 1,
      work: 2 + i,
      review: 1 + Math.floor(i / 2),
      merge: i % 2,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records: [], runs };

  const result = projectTeam(
    "test prompt",
    mockContext,
    null,
    mockLead,
    mockWorker,
    history,
  );

  const workVals = [2, 3, 4, 5, 6, 7];
  const reviewVals = [1, 1, 2, 2, 3, 3];
  const mergeVals = [0, 0, 0, 1, 1, 1];
  assert.equal(result.stages[1].calls[0], Math.floor(quantile(workVals, 0.2)));
  assert.equal(result.stages[1].calls[1], Math.ceil(quantile(workVals, 0.8)));
  assert.equal(
    result.stages[2].calls[0],
    Math.floor(quantile(reviewVals, 0.2)),
  );
  assert.equal(result.stages[2].calls[1], Math.ceil(quantile(reviewVals, 0.8)));
  assert.equal(result.stages[3].calls[0], Math.floor(quantile(mergeVals, 0.2)));
  assert.equal(result.stages[3].calls[1], Math.ceil(quantile(mergeVals, 0.8)));
  assert.deepEqual(result.stages[0].calls, [1, 1]);
});

test("projectTeam: all stages with history samples → basis 'history' and total matches stages sum", () => {
  // 네 단계 모두 기록 5건 이상 → history basis
  const records: UsageRecord[] = [];
  for (let i = 0; i < 6; i++) {
    records.push({
      model: "lead-model",
      kind: "plan",
      inputChars: 100,
      inputTokens: 200,
      outputTokens: 300,
      at: Date.now() + i,
    });
    records.push({
      model: "worker-model",
      kind: "work",
      inputChars: 500,
      inputTokens: 600,
      outputTokens: 700,
      at: Date.now() + i,
    });
    records.push({
      model: "lead-model",
      kind: "review",
      inputChars: 300,
      inputTokens: 400,
      outputTokens: 500,
      at: Date.now() + i,
    });
    records.push({
      model: "worker-model",
      kind: "merge",
      inputChars: 200,
      inputTokens: 300,
      outputTokens: 400,
      at: Date.now() + i,
    });
  }
  const history: UsageHistory = { enabled: true, records, runs: [] };

  const result = projectTeam(
    "test prompt",
    mockContext,
    null,
    mockLead,
    mockWorker,
    history,
  );

  assert.equal(result.basis, "history");
  // total 이 stages total 합과 같음을 확인
  const expectedTotal: [number, number] = [0, 0];
  for (const s of result.stages) {
    expectedTotal[0] += s.total[0];
    expectedTotal[1] += s.total[1];
  }
  assert.equal(result.total[0], expectedTotal[0]);
  assert.equal(result.total[1], expectedTotal[1]);
});

test("inferCall: at이 뒤섞인 배열에서 최신 기록만 쓰는지 확인", () => {
  const records: UsageRecord[] = [];
  // at이 큰 200건 (최신)
  for (let i = 0; i < 200; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: 100,
      inputTokens: 50,
      outputTokens: 1000, // 최신은 큰 output
      at: Date.now() + i * 1000,
    });
  }
  // at이 작은 50건 (구버전, 배열 뒤쪽에 둠)
  for (let i = 0; i < 50; i++) {
    records.push({
      model: "worker-model",
      kind: "execute",
      inputChars: 100,
      inputTokens: 50,
      outputTokens: 1, // 구버전은 작은 output
      at: Date.now() - i * 1000,
    });
  }

  const history: UsageHistory = { enabled: true, records, runs: [] };
  const result = project("test prompt", mockContext, null, mockWorker, history);

  // 최신 200건만 사용되어 output[0]이 1000에 가까워야 함
  assert.equal(result.basis, "history");
  // stages.total[0]이 1000이어야 함 (200건의 output 평균)
  const avgOutput0 = result.stages[0].total[0];
  assert.ok(avgOutput0 > 500, `expected output[0] > 500, got ${avgOutput0}`);
});
