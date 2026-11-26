import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  extractAnswer,
  normalizeAnswer,
  weightOf,
  tally,
} = require("../electron/ensemble-vote.cjs");

test("the last 정답 line is the answer", () => {
  assert.equal(extractAnswer("정답: 3\n다시 보니\n정답: 5"), "5");
  assert.equal(extractAnswer("풀이…\n**정답:** `42`."), "42");
  assert.equal(extractAnswer("- 최종 답: 서울"), "서울");
  assert.equal(extractAnswer("Final answer: B"), "B");
  assert.equal(extractAnswer("정답 ： ７"), "７");
});

test("boxed{} is a fallback, prose without an answer line is empty", () => {
  assert.equal(
    extractAnswer("so \\boxed{1} then \\boxed{\\frac{1}{2}}"),
    "\\frac{1}{2}",
  );
  assert.equal(extractAnswer("정답은 아마 3일 것 같습니다"), "");
  assert.equal(extractAnswer(undefined), "");
});

test("normalization makes the same answer compare equal", () => {
  const cases: [string, string][] = [
    ["1,234명", "1234"],
    ["1,000원", "1000"],
    ["１２", "12"],
    ["(B)", "b"],
    ["b.", "b"],
    ["b) 42", "b"],
    ["②", "2"],
    ["007", "7"],
    ["-007", "-7"],
    ["3.50", "3.5"],
    ["4.0", "4"],
    ["서울입니다", "서울"],
    ["3시간", "3"],
    ["$\\text{42}$", "42"],
    ["**12**", "12"],
    ["“예”", "예"],
  ];
  for (const [raw, key] of cases) assert.equal(normalizeAnswer(raw), key, raw);
  // A unit alone is not stripped to nothing.
  assert.equal(normalizeAnswer("명"), "명");
});

test("weights come from the fixed table, unknown models get the default", () => {
  assert.equal(
    weightOf("nvidia/nemotron-3.5-super-vl-120b-a12b"),
    3.434,
  );
  assert.equal(weightOf("openai/gpt-oss-120b"), 0);
  assert.equal(weightOf("gemini-flash-latest"), 0.1);
  assert.equal(weightOf("x", { default: 0.3, models: { y: 2 } }), 0.3);
  assert.equal(weightOf("y", { default: 0.3, models: { y: 2 } }), 2);
  assert.equal(weightOf("x", { models: {} }), 0.1);
});

const w = (table: Record<string, number>) => (id: string) => table[id] ?? 0.1;

test("a strong model outweighs a weak majority", () => {
  const r = tally(
    [
      { model: "w1", answer: "8" },
      { model: "s", answer: "7" },
      { model: "w2", answer: "8" },
    ],
    { weight: w({ s: 3, w1: 0.5, w2: 0.5 }) },
  );
  assert.equal(r.answer, "7");
  assert.equal(r.agree, 1);
  assert.equal(r.voters, 3);
  assert.equal(r.score, 3);
  assert.deepEqual(r.groups[1].models, ["w1", "w2"]);
});

test("equal score goes to more votes, then to the earlier model", () => {
  const byCount = tally(
    [
      { model: "a", answer: "1" },
      { model: "b", answer: "2" },
      { model: "c", answer: "2" },
    ],
    { weight: w({ a: 1, b: 0.5, c: 0.5 }) },
  );
  assert.equal(byCount.answer, "2");
  const byOrder = tally([
    { model: "a", answer: "x" },
    { model: "b", answer: "y" },
  ]);
  assert.equal(byOrder.answer, "x");
  // Zero-weight models still break ties by count.
  const zero = tally(
    [
      { model: "a", answer: "1" },
      { model: "b", answer: "2" },
      { model: "c", answer: "2" },
    ],
    { weight: () => 0 },
  );
  assert.equal(zero.answer, "2");
});

test("normalized answers share a group, failed and empty runs do not vote", () => {
  const r = tally([
    { model: "a", answer: "1,000" },
    { model: "b", answer: "1000명" },
    { model: "c", answer: "" },
    { model: "d", answer: "5", failed: true },
  ]);
  assert.equal(r.key, "1000");
  assert.equal(r.answer, "1,000");
  assert.equal(r.agree, 2);
  assert.equal(r.voters, 2);
  assert.deepEqual(tally([{ model: "a", answer: " " }]), {
    answer: "",
    key: "",
    agree: 0,
    voters: 0,
    score: 0,
    groups: [],
  });
});
