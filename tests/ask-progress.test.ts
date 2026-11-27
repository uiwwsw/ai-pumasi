import test from "node:test";
import assert from "node:assert/strict";
import { applyProgress, emptyRun, howLine, MODE_NAME } from "../src/ask-progress";

test("a single answer keeps its model and reasoning; a new try starts with none", () => {
  let run = emptyRun();
  run = applyProgress(run, { stage: "plan", mode: "direct", effort: "mid" });
  run = applyProgress(run, { stage: "think", id: "answer", text: "너무 이른 생각" });
  assert.equal(run.answer, undefined);
  run = applyProgress(run, { stage: "part", id: "answer", title: "", state: "running", model: "m1" });
  run = applyProgress(run, { stage: "think", id: "answer", text: "식을 세운다" });
  assert.equal(run.answer?.model, "m1");
  assert.equal(run.answer?.thinking, "식을 세운다");
  assert.equal(run.parts.length, 0);
  run = applyProgress(run, { stage: "part", id: "answer", title: "", state: "running", model: "m2" });
  assert.equal(run.answer?.thinking, undefined);
});

test("reasoning goes to the part it belongs to", () => {
  let run = emptyRun();
  run = applyProgress(run, { stage: "plan", mode: "split", effort: "mid" });
  run = applyProgress(run, { stage: "part", id: "p1", title: "A", state: "running" });
  run = applyProgress(run, { stage: "part", id: "p2", title: "B", state: "running" });
  run = applyProgress(run, { stage: "think", id: "p2", text: "B 생각" });
  assert.deepEqual(run.parts.map((p) => p.thinking), [undefined, "B 생각"]);
});

test("the line under an answer names Pumasi mode only when several models worked on it", () => {
  const usage = { route: { in: 0, out: 0 }, work: { in: 0, out: 0 }, check: { in: 0, out: 0 } };
  const split = howLine({ mode: "split", text: "", usage, parts: [{}, {}] } as never);
  assert.ok(split.startsWith(MODE_NAME));
  const direct = howLine({ mode: "direct", text: "", usage, model: "x" } as never);
  assert.ok(!direct.includes(MODE_NAME));
});
