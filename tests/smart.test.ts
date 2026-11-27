import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { run, splitByHeadings, readTriage, partPrompt } = require("../electron/smart.cjs");
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
  assert.equal(readTriage(JSON.stringify({ mode: "roles", effort: "high" }), text).mode, "roles");
  // One piece of work is checked by a second model only when it is worth checking.
  assert.equal(readTriage(JSON.stringify({ mode: "roles", effort: "low" }), text).mode, "direct");
});

test("split: each part goes out word for word, at once, with no routing, review or merge call; numbered problems are checked", async () => {
  const text = "답은 `정답 N: X`로.\n\n## 문제 1\n" + long("사과 수를 구하라") + "\n\n## 문제 2\n" + long("배 수를 구하라");
  const w = world((_k, user) => (user.includes("사과") ? "풀이…\n정답 1: 3" : "풀이…\n정답 2: 5"));
  const events: any[] = [];
  const r = await run({ text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" }, { ...w.io, onProgress: (e: any) => events.push(e) });
  assert.equal(r.mode, "split");
  assert.equal(r.routedBy, "rules");
  // Two answers and one check for each: numbered problems are worth a second look.
  assert.deepEqual(w.calls.map((c) => c.kind).sort(), ["answer", "answer", "check", "check"]);
  const checks = w.calls.filter((c) => c.kind === "check");
  assert.ok(checks.every((c) => c.model !== "nvidia/nemotron-3.5-super-vl-120b-a12b"));
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

test("split and roles together: only a deep part is checked, and only a failed check redoes it", async () => {
  const text = [long("아래 두 가지를 해 주세요."), "", long("가: 이 문장을 영어로 옮겨 주세요."), "", long("나: 17 곱하기 23을 구하세요.")].join("\n");
  const lines = text.split("\n").length;
  let redo = 0;
  const w = world((kind, user) => {
    if (kind === "triage")
      return JSON.stringify({
        mode: "split",
        effort: "mid",
        parts: [
          { title: "번역", lines: [3, 3], check: false },
          { title: "곱셈", lines: [5, lines], check: true },
        ],
      });
    if (kind === "check")
      return JSON.stringify({ verdict: "wrong", problem: "17×23을 다시 계산하면 391입니다." });
    if (user.includes("다른 모델이 짚은 단계")) {
      // The fix gets the earlier answer with its work log, and is told to continue, not restart.
      assert.ok(user.includes("381") && user.includes("Do not start over"));
      redo++;
      return "391";
    }
    return user.includes("곱하기") ? "381" : "Please translate.";
  });
  const events: any[] = [];
  const r = await run({ text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" }, { ...w.io, onProgress: (e: any) => events.push(e) });
  assert.equal(r.mode, "split");
  // The translation is not checked; the multiplication is, by a different model, and is redone once.
  const checks = w.calls.filter((c) => c.kind === "check");
  assert.equal(checks.length, 1);
  assert.ok(checks[0].user.includes("곱하기") && !checks[0].user.includes("영어로"));
  // Only the checked part is asked for a work log.
  const answers = w.calls.filter((c) => c.kind === "answer");
  assert.ok(answers.some((c) => c.user.includes("곱하기") && c.user.includes("work log")));
  assert.ok(answers.some((c) => c.user.includes("영어로") && !c.user.includes("work log")));
  assert.equal(redo, 1);
  assert.match(r.text, /### 곱셈\n\n391/);
  assert.equal(r.parts[0].check, null);
  assert.deepEqual({ ...r.parts[1].check, problem: undefined }, { model: checks[0].model, verdict: "wrong", revised: true, problem: undefined });
  assert.ok(events.some((e) => e.stage === "part" && e.id === "p2" && e.state === "checking"));
  assert.ok(events.some((e) => e.stage === "part" && e.id === "p2" && e.state === "revising"));
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

test("roles: a different model checks, and only a concrete objection gets the answer redone", async () => {
  const text = [long("다음 논리 문제를 풀어 주세요."), "", long("조건이 여럿 있는 문제")].join("\n");
  const make = (verdict: any) => {
    let answers = 0;
    return world((kind) =>
      kind === "triage"
        ? JSON.stringify({ mode: "roles", effort: "high" })
        : kind === "check"
          ? JSON.stringify(verdict)
          : ++answers === 1 ? "첫 답입니다. 정답: 7 " + long("풀이") : "고친 답입니다. 정답: 8 " + long("풀이"),
    );
  };
  const wrong = make({ verdict: "wrong", problem: "셋째 조건을 빠뜨렸습니다." });
  const a = await run({ text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" }, wrong.io);
  assert.deepEqual(wrong.calls.map((c) => c.kind), ["triage", "answer", "check", "answer"]);
  const checker = wrong.calls[2].model;
  assert.notEqual(checker, wrong.calls[1].model);
  assert.ok(wrong.calls[3].user.includes("셋째 조건을 빠뜨렸습니다."));
  assert.match(a.text, /고친 답/);
  assert.deepEqual({ verdict: a.check.verdict, revised: a.check.revised }, { verdict: "wrong", revised: true });
  for (const v of [{ verdict: "right" }, { verdict: "unsure" }, { verdict: "wrong", problem: "" }]) {
    const w = make(v);
    const r = await run({ text, context: [], model: "nvidia/nemotron-3.5-super-vl-120b-a12b" }, w.io);
    assert.deepEqual(w.calls.map((c) => c.kind), ["triage", "answer", "check"]);
    assert.match(r.text, /첫 답/);
    assert.equal(r.check.revised, false);
  }
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
