// How a question gets answered, decided by the app instead of the user:
//   direct - one model answers.
//   split  - independent parts are answered at the same time, each from the original text, word
//            for word, and the answers are shown in order.
// Either way, work that is exact computation is done by a program: the model writes it, the app
// runs it shut away from everything, and what it prints is the answer.
// Measured on six hard problems: asking each problem separately, as written, beat a lead that
// rewrote the tasks, reviewed and merged (5/6 at 102k tokens against 4/6 at 470k). So nothing here
// rewrites the request, and there is no review or merge pass over finished work.
// Measured on twelve hard problems (bench/README.md): a second model checking the answer fixed one
// answer in 48 tries at 1.4 times the tokens, so there is no checking step; letting a program do
// the computing took the same problems from 6 right to 9-10 at less than half the tokens.
const providers = require("./providers.cjs");
const { createStatsStore } = require("./worker-stats.cjs");
const { tr } = require("./i18n.cjs");
const team = require("./team.cjs");

// Room for the model to think, by how hard the request looks. Only produced tokens are billed, so
// a generous cap costs nothing on an easy answer; it only saves a cut-off try from being redone.
const EFFORT_OUTPUT = { low: 4096, mid: 16000, high: 32000 };
const TRIAGE_OUTPUT = 4000;
const CONCURRENCY = 3;
const MAX_PARTS = 6;
// A one-line question this short goes straight to one model with no routing call: deciding would
// cost about as much as answering. Anything longer is looked at first.
const DIRECT_BELOW_CHARS = 200;
// How much of a model's reasoning is passed on while it works.
const THINK_TAIL = 600;
// The routing decision is small; fast models first, the strong ones only if those are missing.
const TRIAGE_ORDER = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "openai/gpt-oss-120b",
  "google/gemini-3.1-flash-lite",
];

const HEADING =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?(?:문제|질문|과제|problem|question|task|part|q)\s*\.?\s*(\d{1,2})\b/i;

/**
 * Split by structure alone, with no model: lines such as "## 문제 3" or "Question 2" that number
 * at least two parts in order. Returns {shared, parts:[{title, text}]} or null.
 * A plain numbered list is left alone: its items are often steps of one job.
 */
function splitByHeadings(text) {
  const lines = String(text).split("\n");
  const marks = [];
  lines.forEach((line, i) => {
    const m = HEADING.exec(line);
    if (m) marks.push({ i, n: Number(m[1]), title: line.replace(/^[\s#*]+/, "").replace(/\*+\s*$/, "").trim() });
  });
  if (marks.length < 2 || marks.length > MAX_PARTS) return null;
  if (!marks.every((m, k) => m.n === marks[0].n + k)) return null;
  const parts = marks.map((m, k) => ({
    title: m.title.slice(0, 60),
    text: lines.slice(m.i, marks[k + 1]?.i ?? lines.length).join("\n").trim(),
  }));
  if (parts.some((p) => p.text.length < 20)) return null;
  return { shared: lines.slice(0, marks[0].i).join("\n").trim(), parts };
}

const numbered = (text) =>
  String(text)
    .split("\n")
    .map((l, i) => `${i + 1}| ${l}`)
    .join("\n");

/** Turn a routing reply into a plan over the original text. Anything malformed means "direct". */
function readTriage(reply, text) {
  const lines = String(text).split("\n");
  const d = team.extractJSON(reply);
  const effort = ["low", "mid", "high"].includes(d?.effort) ? d.effort : "mid";
  const direct = { mode: "direct", effort };
  // An older reply may still say "roles" (answer, then check): that is one model answering now.
  if (!d || d.mode !== "split") return direct;
  const range = (r) =>
    Array.isArray(r) &&
    Number.isInteger(r[0]) &&
    Number.isInteger(r[1]) &&
    r[0] >= 1 &&
    r[1] >= r[0] &&
    r[1] <= lines.length;
  const cut = ([a, b]) => lines.slice(a - 1, b).join("\n").trim();
  if (!Array.isArray(d.parts) || d.parts.length < 2 || d.parts.length > MAX_PARTS) return direct;
  if (!d.parts.every((p) => p && range(p.lines))) return direct;
  // Parts must not overlap, or the same work is done twice.
  const sorted = [...d.parts].sort((x, y) => x.lines[0] - y.lines[0]);
  if (sorted.some((p, k) => k > 0 && p.lines[0] <= sorted[k - 1].lines[1])) return direct;
  const shared = (Array.isArray(d.shared) ? d.shared : []).filter(range).map(cut).join("\n").trim();
  const parts = sorted.map((p, k) => ({
    title: (typeof p.title === "string" && p.title.trim() ? p.title.trim() : `${k + 1}`).slice(0, 60),
    text: cut(p.lines),
    note: typeof p.note === "string" ? p.note.trim().slice(0, 200) : "",
  }));
  if (parts.some((p) => !p.text)) return direct;
  return { mode: "split", effort, shared, parts };
}

// Offered to the model with the work: a program instead of an answer, when that is the surer way.
const CODE_NOTE = [
  "If the answer has to be worked out by exact computation (arithmetic on large numbers, searching through combinations, optimisation, counting, shortest paths, simulation, checking every case), do not work it out yourself. Reply with ONLY one ```js code block whose first line is `// RUN` and nothing else. The app runs it and shows what it prints as your answer.",
  "The program: encode the data from the request exactly, compute the answer (BigInt for large integers), and print with console.log everything the request asks for, in the form it asks for and in the user's language. No imports, files, network or input; it must finish within 10 seconds.",
  "For anything else (explaining, writing, translating, advice, or code the user wants to read), answer normally and do not use `// RUN`.",
].join("\n");
const CODE_FIX =
  "That program did not produce an answer. Fix it and reply with the whole program again, as one ```js code block whose first line is `// RUN`.";

/** The program in a reply that is nothing but one runnable block, or null. */
function runnable(text) {
  const m = /^\s*```(?:js|javascript)[ \t]*\n[ \t]*\/\/[ \t]*RUN\b[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(String(text ?? ""));
  return m && m[1].trim() ? m[1] : null;
}

/** What one part's model reads: the shared lines, the part as written, and at most a one-line note. */
const partPrompt = (shared, part) =>
  [shared, part.text, part.note ? `(${part.note})` : ""].filter(Boolean).join("\n\n");

async function pool(items, limit, fn) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * @param {{text:string, context:any[], model:string, autoOrder?:string[]}} p
 * @param {{env?:object, fetchImpl?:Function, onProgress?:Function, onDelta?:Function,
 *   stats?:object, sleep?:Function, now?:Function, signal?:AbortSignal, allowPaid?:boolean,
 *   skipped?:(id:string)=>boolean, runCode?:(code:string)=>Promise<{ok:boolean,out:string,error?:string}>}} io
 *   runCode runs a program with no access to anything and returns what it printed. Without it,
 *   models are not offered the choice and answer everything themselves.
 */
async function run(p, io = {}) {
  const env = io.env ?? process.env;
  const onProgress = io.onProgress ?? (() => {});
  const stats = io.stats ?? createStatsStore();
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = io.now ?? (() => Date.now());
  const usage = { route: { in: 0, out: 0 }, work: { in: 0, out: 0 }, check: { in: 0, out: 0 } };
  const add = (who, r) => {
    usage[who].in += r?.inputTokens ?? 0;
    usage[who].out += r?.outputTokens ?? 0;
  };
  const request = (payload, extra = {}) =>
    providers.request(payload, {
      env,
      fetchImpl: io.fetchImpl,
      signal: io.signal,
      allowPaid: io.allowPaid === true,
      stream: true,
      ...extra,
    });
  const context = Array.isArray(p.context) ? p.context : [];

  // 1. Decide how to work, spending as little as possible on the decision.
  let plan = null;
  const byHeadings = splitByHeadings(p.text);
  if (byHeadings) plan = { mode: "split", effort: "high", ...byHeadings, routedBy: "rules" };
  else if (p.text.length < DIRECT_BELOW_CHARS && !p.text.trim().includes("\n"))
    plan = { mode: "direct", effort: "mid", routedBy: "rules" };
  else {
    onProgress({ stage: "route" });
    try {
      const r = await request(
        { action: "triage", model: "auto-free", text: numbered(p.text), context: [], maxOutputTokens: TRIAGE_OUTPUT },
        { autoOrder: TRIAGE_ORDER, timeoutMs: 60000, allowPaid: false },
      );
      add("route", r);
      plan = { ...readTriage(r.text, p.text), routedBy: r.modelId ?? "auto-free" };
    } catch (error) {
      if (error?.stopped) throw error;
      // No routing answer: answering directly is always a valid way to work.
      plan = { mode: "direct", effort: "mid", routedBy: "fallback" };
    }
  }
  const cap = EFFORT_OUTPUT[plan.effort];
  onProgress({ stage: "plan", mode: plan.mode, effort: plan.effort, parts: plan.parts?.map((x) => x.title) });

  const chain = team.workerChain(
    p.model,
    env,
    (await providers.status(env, io.fetchImpl ?? fetch)).ollama,
    stats,
  );
  /** One piece of work with retries and the next model on failure. Returns the reply or throws. */
  const solve = async (id, title, prompt, { ctx = [], onDelta } = {}) => {
    const report = (state, extra = {}) => onProgress({ stage: "part", id, title, state, ...extra });
    // The model's own reasoning while it works: the last stretch only, a few times a second.
    let thoughtAt = 0;
    const onThinking = (text) => {
      const t = now();
      if (t - thoughtAt < 300) return;
      thoughtAt = t;
      onProgress({ stage: "think", id, text: String(text).slice(-THINK_TAIL) });
    };
    let last;
    let best = null;
    for (const [m, model] of chain.entries()) {
      if (io.skipped?.(id)) break;
      if (m > 0) report("switch", { model, from: chain[m - 1], reason: last?.reason ?? team.failureReason(last) });
      const r = await team.superviseModel(model, prompt, {
        call: (action, mdl, text, c, maxOutputTokens, timeoutMs) =>
          request(
            { action, model: mdl, text, context: c, maxOutputTokens },
            {
              timeoutMs,
              autoOrder: p.autoOrder,
              onDelta: m === 0 ? onDelta : undefined,
              onThinking,
              // Skipping one part stops only that part's request.
              signal: io.signalFor?.(id) ?? io.signal,
            },
          ),
        action: "execute",
        context: ctx,
        // A short answer to a long question can be right ("서울"); only an empty one is redone.
        minChars: 1,
        maxOutputTokens: cap,
        stats,
        sleep,
        now,
        report,
        onReply: (done) => add("work", done),
      });
      if (r.done) return { ...r.done, model: r.done.modelId ?? model };
      last = r.error;
      if (last?.stopped) throw last;
      if (r.partial && (!best || r.partial.text.length > best.text.length))
        best = { ...r.partial, incomplete: true, model };
    }
    if (best) return best;
    throw last ?? new Error(tr("실행 실패"));
  };

  /**
   * One piece of work, where the model may hand back a program instead of an answer. The program
   * is run and what it prints becomes the answer; if it fails it gets one fix, and after that the
   * model answers by itself.
   */
  const answer = async (id, title, prompt, opts = {}) => {
    if (!io.runCode || plan.effort === "low") return solve(id, title, prompt, opts);
    const offered = `${prompt}\n\n${CODE_NOTE}`;
    let done = await solve(id, title, offered, opts);
    let code = runnable(done.text);
    if (!code || done.incomplete) return done;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (io.skipped?.(id)) return done;
      onProgress({ stage: "part", id, title, state: "computing", model: done.model });
      let ran;
      try {
        ran = await io.runCode(code);
      } catch (error) {
        ran = { ok: false, out: "", error: String(error?.message ?? error) };
      }
      if (ran?.ok && String(ran.out ?? "").trim())
        return {
          ...done,
          text: `${String(ran.out).trim()}\n\n${tr("계산에 쓴 프로그램:")}\n\n\`\`\`js\n${code.trim()}\n\`\`\``,
          computed: true,
        };
      if (attempt === 1) break;
      const why = ran?.error ? String(ran.error).slice(0, 500) : tr("출력이 없습니다.");
      const again = await solve(
        id,
        title,
        `${offered}\n\n${tr("이전 프로그램:")}\n\`\`\`js\n${code.trim()}\n\`\`\`\n${tr("실행 결과:")} ${why}\n\n${CODE_FIX}`,
        opts,
      );
      const fixed = runnable(again.text);
      if (!fixed || again.incomplete) return again;
      done = again;
      code = fixed;
    }
    // The program never ran: answer without one.
    return solve(id, title, prompt, opts);
  };

  // 2a. Independent parts, at the same time. Each finished part is reported at once.
  if (plan.mode === "split") {
    const results = new Array(plan.parts.length);
    plan.parts.forEach((part, i) => onProgress({ stage: "part", id: `p${i + 1}`, title: part.title, state: "waiting" }));
    await pool(plan.parts, CONCURRENCY, async (part, i) => {
      const id = `p${i + 1}`;
      if (io.skipped?.(id)) {
        results[i] = { skipped: true };
        onProgress({ stage: "part", id, title: part.title, state: "skipped" });
        return;
      }
      try {
        const done = await answer(id, part.title, partPrompt(plan.shared, part), { ctx: context });
        results[i] = io.skipped?.(id) ? { skipped: true } : done;
        onProgress({
          stage: "part",
          id,
          title: part.title,
          state: results[i].skipped ? "skipped" : "done",
          model: done.model,
          text: results[i].skipped ? undefined : done.text,
          partial: !!done.incomplete,
        });
      } catch (error) {
        if (error?.stopped && !io.skipped?.(id)) throw error;
        results[i] = io.skipped?.(id)
          ? { skipped: true }
          : { error: error instanceof Error ? error.message : tr("실행 실패") };
        onProgress({
          stage: "part",
          id,
          title: part.title,
          state: results[i].skipped ? "skipped" : "failed",
          message: results[i].error,
        });
      }
    });
    const text = plan.parts
      .map((part, i) => {
        const r = results[i];
        const body = r.skipped
          ? `(${tr("건너뜀")})`
          : r.error
            ? `(${tr("실패: {error}", { error: r.error })})`
            : r.text;
        return `### ${part.title}\n\n${body}`;
      })
      .join("\n\n");
    onProgress({ stage: "done" });
    return {
      text,
      mode: "split",
      effort: plan.effort,
      routedBy: plan.routedBy,
      parts: plan.parts.map((part, i) => ({
        title: part.title,
        model: results[i].model ?? null,
        failed: !!results[i].error,
        skipped: !!results[i].skipped,
        incomplete: !!results[i].incomplete,
        computed: !!results[i].computed,
      })),
      usage,
    };
  }

  // 2b. One answer.
  const answered = await answer("answer", "", p.text, { ctx: context, onDelta: io.onDelta });
  onProgress({ stage: "done" });
  return {
    text: answered.text,
    mode: "direct",
    effort: plan.effort,
    routedBy: plan.routedBy,
    model: answered.model,
    incomplete: !!answered.incomplete,
    computed: !!answered.computed,
    check: null,
    usage,
  };
}

/**
 * The user's controls over one run: stop everything, skip one part, or finish now with the parts
 * that are done. Pass `signal`, `signalFor` and `skipped` to run().
 */
function createControl() {
  const all = new AbortController();
  const per = new Map();
  const skippedIds = new Set();
  let finishing = false;
  const of = (id) => {
    if (!per.has(id)) per.set(id, new AbortController());
    return per.get(id);
  };
  return {
    signal: all.signal,
    signalFor: (id) => AbortSignal.any([all.signal, of(id).signal]),
    skipped: (id) => finishing || skippedIds.has(id),
    skip: (id) => {
      skippedIds.add(id);
      of(id).abort();
    },
    finish: () => {
      finishing = true;
      for (const c of per.values()) c.abort();
    },
    stop: () => all.abort(),
  };
}

module.exports = { run, createControl, splitByHeadings, readTriage, partPrompt, runnable, EFFORT_OUTPUT };
