import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../src/code";

test("diffLines counts a one-line change", () => {
  const d = diffLines("a\nb\nc\n", "a\nx\nc\n");
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.deepEqual(
    d.lines.map((l) => l.kind),
    ["same", "del", "add", "same"],
  );
});

test("diffLines shows a new file as all added", () => {
  const d = diffLines("", "a\nb\n");
  assert.equal(d.added, 2);
  assert.equal(d.removed, 0);
});

test("diffLines handles a one-line change in a long file without truncating", () => {
  const before = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
  const d = diffLines(before, before.replace("line 2500", "changed"));
  assert.equal(d.truncated, false);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.lines.length, 5001);
});

test("diffLines falls back to removed-then-added when the changed middle is huge", () => {
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
  const d = diffLines(a, b);
  assert.equal(d.truncated, true);
  assert.equal(d.added, 3000);
  assert.equal(d.removed, 3000);
});
