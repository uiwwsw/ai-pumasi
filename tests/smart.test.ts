import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { run, splitByHeadings, readTriage, partPrompt, EFFORT_OUTPUT } = require("../electron/smart.cjs");
const { createStatsStore } = require("../electron/worker-stats.cjs");

const env = { NVIDIA_API_KEY: "k", AURORA_OLLAMA: "0" };
const reply = (text: string, usage = { prompt_tokens: 5, completion_tokens: 7 }) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage }),
});
/** A fake provider: `answer(kind, userText, model)` decides each reply; every call is recorded. */
function world(answer: (kind: string, user: string, model: string) => string) {
  const calls: { kind: string; user: string; model: string; max: number }[] = [];
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const system = String(body.messages?.[0]?.content ?? "");
    const user = String(body.messages?.at(-1)?.content ?? "");
    const kind = system.includes("You decide how a request should be worked on")
      ? "triage"
      : system.includes("You check another model")
        ? "check"
        : "answer";
    calls.push({ kind, user, model: body.model, max: body.max_tokens });
    return reply(answer(kind, user, body.model));
  };
  const io = { env, fetchImpl, stats: createStatsStore(), sleep: async () => {} };
  return { calls, io };
}
const long = (s: string) => `${s} `.repeat(12);

test("numbered headings split a request with no model call; a plain list is left alone", () => {
  const s = splitByHeadings("모두 풀어 주세요. 답은 한 줄로.\n\n## 문제 1\n" + long("첫째") + "\n\n## 문제 2\n" + long("둘째"));
  assert.equal(s.shared, "모두 풀어 주세요. 답은 한 줄로.");
  assert.deepEqual(s.parts.map((p: any) => p.title), ["문제 1", "문제 2"]);
  assert.ok(s.parts[1].text.startsWith("## 문제 2\n둘째"));
  assert.equal(splitByHeadings("1. 설치한다\n2. 실행한다\n3. 확인한다"), null);
  assert.equal(splitByHeadings("## 문제 1\n" + long("하나뿐")), null);
  // Numbers out of order are not a list of parts.
  assert.equal(splitByHeadings("Question 2\n" + long("a") + "\nQuestion 5\n" + long("b")), null);
});

test("a routing reply becomes line ranges of the original; anything malformed means direct", () => {
  const text = "공통 지시\nA 첫 줄\nA 둘째 줄\nB 첫 줄";
  const ok = readTriage(
    JSON.stringify({ mode: "split", effort: "high", shared: [[1, 1]], parts: [{ title: "A", lines: [2, 3], note: "A의 답" }, { title: "B", lines: [4, 4] }] }),
    text,
  );
  assert.equal(ok.mode, "split");
  assert.equal(ok.shared, "공통 지시");
  assert.equal(ok.parts[0].text, "A 첫 줄\nA 둘째 줄");
  assert.equal(partPrompt(ok.shared, ok.parts[0]), "공통 지시\n\nA 첫 줄\nA 둘째 줄\n\n(A의 답)");
  // Overlapping or out-of-range parts, one part, or no JSON: answer directly.
  for (const bad of [
    { mode: "split", parts: [{ lines: [1, 3] }, { lines: [3, 4] }] },
    { mode: "split", parts: [{ lines: [1, 9] }, { lines: [2, 2] }] },
    { mode: "split", parts: [{ lines: [1, 4] }] },
    { mode: "weird" },
  ])
    assert.equal(readTriage(JSON.stringify(bad), text).mode, "direct");
  assert.equal(readTriage("not json", text).mode, "direct");
  // "roles" (answer, then a check by another model) is gone: it is one model answering.
  assert.equal(readTriage(JSON.stringify({ mode: "roles", effort: "high" }), text).mode, "direct");
  // One piece of work is checked by a second model only when it is worth checking.
  assert.equal(readTriage(JSON.stringify({ mode: "roles", effort: "low" }), text).mode, "direct");
});

test("split: each part goes out word for word, at once, with no routing, review or merge call", async () => {
  const text = "답은 `정답 N: X`로.\n\n## 문제 1\n" + long("사과 수를 구하라") + "\n\n## 문제 2\n" + long("배 수를 구하라");
  const w = world((_k, user) => (user.includes("사과") ? "풀이…\n정답 1: 3" : "풀이…\n정답 2: 5"));
  const events: any[] = [];
  const r = await run({ text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" }, { ...w.io, onProgress: (e: any) => events.push(e) });
  assert.equal(r.mode, "split");
  assert.equal(r.routedBy, "rules");
  assert.deepEqual(w.calls.map((c) => c.kind), ["answer", "answer"]);
  // The model reads the shared line and its own problem exactly as written, and nothing of the other.
  const first = w.calls.find((c) => c.user.includes("사과"))!;
  assert.ok(first.user.startsWith("답은 `정답 N: X`로.\n\n## 문제 1\n사과 수를 구하라"));
  assert.ok(!first.user.includes("배 수"));
  assert.equal(first.max, 32000);
  assert.match(r.text, /### 문제 1\n\n풀이…\n정답 1: 3\n\n### 문제 2\n\n풀이…\n정답 2: 5/);
  // Each finished part is reported with its text, so the window can show it before the rest.
  assert.equal(events.filter((e) => e.stage === "part" && e.state === "done" && e.text).length, 2);
  assert.deepEqual(r.usage.route, { in: 0, out: 0 });
  assert.deepEqual(r.usage.work, { in: 10, out: 14 });
});

test("a short question is answered directly with no routing call, and streams", async () => {
  const w = world(() => "서울입니다.");
  const r = await run({ text: "한국의 수도는?", context: [], model: "auto-free" }, w.io);
  assert.equal(r.mode, "direct");
  assert.deepEqual(w.calls.map((c) => c.kind), ["answer"]);
  assert.equal(r.text, "서울입니다.");
});

test("a long request is routed once by a fast model; a skipped part costs nothing", async () => {
  const text = [long("다음 두 문서를 각각 요약해 주세요."), "", long("문서 가: 봄에 대한 글"), "", long("문서 나: 겨울에 대한 글")].join("\n");
  const w = world((kind, user) =>
    kind === "triage"
      ? JSON.stringify({ mode: "split", effort: "low", shared: [[1, 1]], parts: [{ title: "가", lines: [3, 3], note: "요약" }, { title: "나", lines: [5, 5], note: "요약" }] })
      : user.includes("봄") ? "봄 요약입니다. ".repeat(4) : "겨울 요약입니다. ".repeat(4),
  );
  const r = await run({ text, context: [], model: "auto-free" }, { ...w.io, skipped: (id: string) => id === "p2" });
  assert.equal(w.calls[0].kind, "triage");
  assert.equal(w.calls[0].model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.ok(w.calls[0].user.startsWith("1| 다음 두 문서를"));
  assert.equal(w.calls.filter((c) => c.kind === "answer").length, 1);
  assert.equal(w.calls.find((c) => c.kind === "answer")!.max, 4096);
  assert.deepEqual(r.parts.map((p: any) => p.skipped), [false, true]);
  assert.match(r.text, /### 나\n\n\(건너뜀\)/);
});

test("computation: the model hands back a program, the app runs it, and what it prints is the answer", async () => {
  const program = "```js\n// RUN\nconsole.log('정답: ' + 17 * 23)\n```";
  const w = world((kind, user) =>
    kind === "triage" ? JSON.stringify({ mode: "direct", effort: "mid" }) : user.includes("// RUN") ? program : "그냥 답",
  );
  const ran: string[] = [];
  const events: any[] = [];
  const text = [long("다음 계산 문제를 풀어 주세요."), "", long("17 곱하기 23은 얼마인가요?")].join("\n");
  const r = await run(
    { text, context: [], model: "auto-free" },
    {
      ...w.io,
      onProgress: (e: any) => events.push(e),
      runCode: async (code: string) => {
        ran.push(code);
        return { ok: true, out: "정답: 391\n" };
      },
    },
  );
  // No second model looks at the answer: one routing call, one answer.
  assert.deepEqual(w.calls.map((c) => c.kind), ["triage", "answer"]);
  assert.ok(w.calls[1].user.startsWith(text) && w.calls[1].user.includes("// RUN"));
  assert.deepEqual(ran, ["console.log('정답: ' + 17 * 23)"]);
  assert.ok(r.text.startsWith("정답: 391\n\n"));
  assert.ok(r.text.includes("```js\nconsole.log('정답: ' + 17 * 23)\n```"));
  assert.equal(r.computed, true);
  assert.equal(r.check, null);
  assert.ok(events.some((e) => e.stage === "part" && e.id === "answer" && e.state === "computing"));
});

test("computation: a failed program gets one fix, then the model answers by itself", async () => {
  const text = [long("다음 계산 문제를 풀어 주세요."), "", long("17 곱하기 23은 얼마인가요?")].join("\n");
  const make = (results: any[]) => {
    const w = world((kind, user) =>
      kind === "triage"
        ? JSON.stringify({ mode: "direct", effort: "mid" })
        : !user.includes("// RUN")
          ? "혼자 푼 답: 391"
          : user.includes("did not produce an answer")
            ? "```js\n// RUN\nconsole.log(391)\n```"
            : "```js\n// RUN\nconsole.log(nope)\n```",
    );
    let n = 0;
    const runs: string[] = [];
    const runCode = async (code: string) => {
      runs.push(code);
      return results[n++];
    };
    return { w, runs, runCode };
  };
  // The first program fails, the fixed one runs.
  const fixed = make([{ ok: false, out: "", error: "nope is not defined" }, { ok: true, out: "391" }]);
  const a = await run({ text, context: [], model: "auto-free" }, { ...fixed.w.io, runCode: fixed.runCode });
  assert.deepEqual(fixed.runs, ["console.log(nope)", "console.log(391)"]);
  assert.ok(fixed.w.calls[2].user.includes("nope is not defined"));
  assert.ok(a.text.startsWith("391\n\n") && a.computed);
  // Both fail (the second prints nothing): the model is asked again without the offer.
  const failed = make([{ ok: false, out: "", error: "timeout" }, { ok: true, out: "  " }]);
  const b = await run({ text, context: [], model: "auto-free" }, { ...failed.w.io, runCode: failed.runCode });
  assert.equal(b.text, "혼자 푼 답: 391");
  assert.equal(b.computed, false);
  assert.equal(failed.w.calls.at(-1)!.user, text);
});

test("computation is offered only where a program can run, and code the user asked to read is not run", async () => {
  const text = [long("다음 계산 문제를 풀어 주세요."), "", long("17 곱하기 23은 얼마인가요?")].join("\n");
  // Nowhere to run a program: the request goes out as written.
  const plain = world((kind) => (kind === "triage" ? JSON.stringify({ mode: "direct", effort: "mid" }) : "391"));
  await run({ text, context: [], model: "auto-free" }, plain.io);
  assert.equal(plain.calls[1].user, text);
  // An easy request is not offered it either.
  const easy = world((kind) => (kind === "triage" ? JSON.stringify({ mode: "direct", effort: "low" }) : "안녕하세요"));
  let ran = 0;
  const runCode = async () => (ran++, { ok: true, out: "x" });
  await run({ text, context: [], model: "auto-free" }, { ...easy.io, runCode });
  assert.equal(easy.calls[1].user, text);
  // A code block without the marker, or with words around it, is an answer to read.
  for (const reply of ["```js\nfunction add(a, b) { return a + b }\n```", "이렇게 하면 됩니다.\n```js\n// RUN\nconsole.log(1)\n```"]) {
    const w = world((kind) => (kind === "triage" ? JSON.stringify({ mode: "direct", effort: "mid" }) : reply));
    const r = await run({ text, context: [], model: "auto-free" }, { ...w.io, runCode });
    assert.equal(r.text, reply);
    assert.equal(r.computed, false);
  }
  assert.equal(ran, 0);
});

test("split: each part may compute on its own", async () => {
  const text = "## 문제 1\n" + long("17 곱하기 23을 계산") + "\n\n## 문제 2\n" + long("인사말을 영어로");
  const w = world((_kind, user) => (user.includes("곱하기") ? "```js\n// RUN\nconsole.log(17*23)\n```" : "Hello."));
  const r = await run(
    { text, context: [], model: "auto-free" },
    { ...w.io, runCode: async () => ({ ok: true, out: "391" }) },
  );
  assert.equal(r.mode, "split");
  assert.deepEqual(r.parts.map((p: any) => p.computed), [true, false]);
  assert.match(r.text, /### 문제 1\n\n391\n/);
  assert.match(r.text, /### 문제 2\n\nHello\./);
});

test("depth: light is one short answer from a fast model; deep gives every part the most room", async () => {
  const many = "## 문제 1\n" + long("첫째 문제") + "\n\n## 문제 2\n" + long("둘째 문제");
  // Light: no routing, no split, no program, the small output cap, fast models first.
  const light = world(() => "짧은 답");
  let ran = 0;
  const a = await run(
    { text: many, context: [], model: "auto-free", depth: "light" },
    { ...light.io, runCode: async () => (ran++, { ok: true, out: "x" }) },
  );
  assert.deepEqual(light.calls.map((c) => c.kind), ["answer"]);
  assert.equal(light.calls[0].user, many);
  assert.equal(light.calls[0].max, EFFORT_OUTPUT.low);
  assert.equal(light.calls[0].model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.deepEqual([a.mode, a.depth, a.effort, ran], ["direct", "light", "low", 0]);
  // Deep: a short question that would get the middle cap gets the high one.
  const deep = world(() => "긴 답");
  const b = await run({ text: "한국의 수도는?", context: [], model: "auto-free", depth: "deep" }, deep.io);
  assert.equal(deep.calls[0].max, EFFORT_OUTPUT.high);
  assert.deepEqual([b.depth, b.effort], ["deep", "high"]);
  // Left alone, the same question gets the middle cap.
  const auto = world(() => "답");
  const c = await run({ text: "한국의 수도는?", context: [], model: "auto-free" }, auto.io);
  assert.equal(auto.calls[0].max, EFFORT_OUTPUT.mid);
  assert.equal(c.depth, "auto");
});

test("when routing fails, the question is still answered", async () => {
  const text = [long("긴 요청입니다."), "", long("둘째 문단")].join("\n");
  const w = world((kind) => (kind === "triage" ? "죄송합니다, JSON이 아닙니다" : "답입니다. " + long("내용")));
  const r = await run({ text, context: [], model: "auto-free" }, w.io);
  assert.equal(r.mode, "direct");
  assert.match(r.text, /답입니다/);
});

test("controls: skipping a running part stops only that request; finish keeps what is done", async () => {
  const { createControl } = require("../electron/smart.cjs");
  const text = "## 문제 1\n" + long("빠른 문제") + "\n\n## 문제 2\n" + long("느린 문제");
  const control = createControl();
  const fetchImpl = (_url: string, init: any) => {
    const user = String(JSON.parse(init.body).messages.at(-1).content);
    if (user.includes("빠른")) return Promise.resolve(reply("빠른 답"));
    // The slow part never answers; it only ends when its request is aborted.
    return new Promise((_ok, fail) =>
      init.signal.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" }))),
    );
  };
  const events: any[] = [];
  const running = run(
    { text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" },
    {
      env, fetchImpl, stats: createStatsStore(), sleep: async () => {},
      signal: control.signal, signalFor: control.signalFor, skipped: control.skipped,
      onProgress: (e: any) => {
        events.push(e);
        if (e.stage === "part" && e.id === "p1" && e.state === "done") control.finish();
      },
    },
  );
  const r = await running;
  assert.match(r.text, /### 문제 1\n\n빠른 답/);
  assert.match(r.text, /### 문제 2\n\n\(건너뜀\)/);
  assert.deepEqual(r.parts.map((p: any) => p.skipped), [false, true]);
  // Stop ends the whole run as stopped, not as a failure.
  const c2 = createControl();
  const stopped = run(
    { text: "한국의 수도는?", context: [], model: "auto-free" },
    { env, fetchImpl: (_u: string, init: any) => new Promise((_ok, fail) => init.signal.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" })))), stats: createStatsStore(), sleep: async () => {}, signal: c2.signal, signalFor: c2.signalFor, skipped: c2.skipped },
  );
  setTimeout(() => c2.stop(), 10);
  await assert.rejects(stopped, (e: any) => e.stopped === true);
});
