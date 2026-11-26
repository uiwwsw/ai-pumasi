import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Every t("…") / tr("…") key in the code needs an English entry with the same {placeholders}.
const dicts = fs
  .readdirSync("src/i18n")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(`src/i18n/${f}`, "utf8")) as Record<string, string>);
const EN: Record<string, string> = Object.assign({}, ...dicts);
const files = [
  ...fs.readdirSync("src").filter((f) => /\.(tsx?|ts)$/.test(f)).map((f) => `src/${f}`),
  ...fs.readdirSync("electron").filter((f) => f.endsWith(".cjs")).map((f) => `electron/${f}`),
];
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every translated string has an English entry with the same placeholders", () => {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:t|tr)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/gs)) {
      const key = m[2].replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
      if (!/[가-힣]/.test(key)) continue;
      if (!(key in EN)) missing.push(`${f}: ${key}`);
      else if (holes(key) !== holes(EN[key])) mismatched.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], "missing English entries");
  assert.deepEqual(mismatched, [], "placeholder mismatch");
});

test("English entries contain no Korean and no leftover app name", () => {
  for (const [ko, en] of Object.entries(EN)) {
    assert.ok(!/[가-힣]/.test(en), `Korean left in English text for: ${ko}`);
    assert.ok(!/\bAurora\b/.test(en), `old app name in: ${en}`);
  }
});
