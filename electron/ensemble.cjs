// Bundle mode: the same request goes to several free or cheap models at once. A short definite
// answer is picked by a vote weighted by each model's measured accuracy; a long answer is written
// by the highest-weighted model from all replies. Failed models drop out of the vote.
const providers = require("./providers.cjs");
const catalog = require("../src/catalog.json");
const { createStatsStore } = require("./worker-stats.cjs");
const { superviseModel, failureReason } = require("./team.cjs");
const { extractAnswer, weightOf, tally } = require("./ensemble-vote.cjs");
const { tr } = require("./i18n.cjs");

const MIN_MODELS = 2;
const MAX_MODELS = 5;
const MAX_OUTPUT = 4096;
const SHORT_ANSWER = 60; // characters; a longer "정답:" line is prose, not a votable answer
const SYNTH_BUDGET = 16000; // characters of model answers the writer reads
const KEPT_TEXT = 6000; // characters of each model's reply returned for the details view

/** Models the bundle may use: free ones and the light tier of each provider. */
function bundleable(m) {
  return (
    !!m && m.provider !== "auto" && (m.free === true || m.tier === "light")
  );
}

/** Throws unless the list is 2-5 distinct bundleable models whose key or local server is there. */
function checkModels(ids, status) {
  if (
    !Array.isArray(ids) ||
    ids.length < MIN_MODELS ||
    ids.length > MAX_MODELS ||
    new Set(ids).size !== ids.length
  )
    throw new Error(
      tr("묶음 투표에는 서로 다른 모델 {min}~{max}개가 필요합니다.", {
        min: MIN_MODELS,
        max: MAX_MODELS,
      }),
    );
  for (const id of ids) {
    const m = catalog.find((x) => x.id === id);
    if (!bundleable(m))
      throw new Error(tr("묶음 투표에는 무료·경량 모델만 넣을 수 있습니다."));
    if (m.provider === "compat" ? !status.models?.[m.id] : !status[m.provider])
      throw new Error(
        tr("{name}: {detail}", {
          name: m.name,
          detail:
            m.provider === "ollama"
              ? tr("Ollama가 실행 중이 아닙니다.")
              : m.provider === "compat"
                ? tr(
                    "이 모델을 주는 무료 제공자(NVIDIA·OpenRouter·Groq·Gemini 등) 키가 없습니다.",
                  )
                : tr("키가 설정되지 않았습니다."),
        }),
      );
  }
}

/** Highest weight first; equal weights keep the user's order. */
function strongest(ids, weight) {
  return [...ids].sort(
    (a, b) => weight(b) - weight(a) || ids.indexOf(a) - ids.indexOf(b),
  )[0];
}

function synthesisPrompt(text, runs, nameOf) {
  const per = Math.floor(SYNTH_BUDGET / runs.length);
  const body = runs
    .map((r, i) => {
      let t = r.text.trim();
      if (t.length > per)
        t = `${t.slice(0, per)}\n${tr("[…{count}자 생략]", { count: t.length - per })}`;
      return `## ${tr("답 {num} · {model}", { num: i + 1, model: nameOf(r.model) })}\n${t}`;
    })
    .join("\n\n");
  return `${tr("요청:")}\n${text.slice(0, 3000)}\n\n${tr("같은 요청에 대한 여러 모델의 답:")}\n\n${body}`;
}

/**
 * @param {{models:string[], text:string, context:any[]}} p
 * @param {{env?:object, fetchImpl?:Function, onProgress?:(e:object)=>void, sleep?:(ms:number)=>Promise<void>, now?:()=>number, stats?:object, weight?:(id:string)=>number}} opts
 */
async function runEnsemble(p, opts = {}) {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const onProgress = opts.onProgress ?? (() => {});
  const sleep =
    opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const stats = opts.stats ?? createStatsStore();
  const weight = opts.weight ?? ((id) => weightOf(id));
  // Once the leading answer cannot be outvoted by the models still running, stop waiting for them.
  const stop = new AbortController();
  const finished = new Set();
  const cut = (model) => stop.signal.aborted && !finished.has(model);
  const nameOf = (id) => catalog.find((m) => m.id === id)?.name ?? id;

  checkModels(p?.models, await providers.status(env, fetchImpl));
  // Reject a malformed request once, instead of as one failure per model.
  providers.validate({
    action: "vote",
    model: p.models[0],
    text: p.text,
    context: p.context,
    maxOutputTokens: MAX_OUTPUT,
  });

  const byModel = {};
  const substitutions = [];
  const onReply = (model) => (done) => {
    const u = (byModel[model] ??= { in: 0, out: 0 });
    u.in += done.inputTokens ?? 0;
    u.out += done.outputTokens ?? 0;
    if (done.substituted)
      substitutions.push({ requested: model, servedBy: done.servedBy });
  };
  const call = (action, model, text, context, maxOutputTokens, timeoutMs) =>
    providers.request(
      { action, model, text, context, maxOutputTokens },
      {
        env,
        fetchImpl,
        timeoutMs,
        onUsage: opts.onUsage,
        signal: action === "vote" ? stop.signal : null,
      },
    );
  // A model cut off by an early decision did not fail: keep it out of its track record.
  const fair = {
    order: (...a) => stats.order(...a),
    record: (model, e) => (cut(model) ? undefined : stats.record(model, e)),
  };
  const supervise = (model, prompt, job, extra) =>
    superviseModel(model, prompt, {
      call,
      stats: fair,
      sleep: (ms) => (cut(model) ? Promise.resolve() : sleep(ms)),
      now,
      maxOutputTokens: MAX_OUTPUT,
      onReply: onReply(model),
      report: (state, e = {}) =>
        cut(model)
          ? undefined
          : onProgress({ stage: "worker", ...job, state, ...e }),
      ...extra,
    });

  for (const model of p.models)
    onProgress({
      stage: "worker",
      taskId: model,
      title: nameOf(model),
      state: "waiting",
    });
  const totalWeight = p.models.reduce((t, m) => t + weight(m), 0);
  const replies = new Map();
  // True when every finished reply has a short answer and the leader beats the runner-up even if
  // every unfinished model joined the runner-up.
  const decided = () => {
    const done = [...replies.values()];
    const ok = done.filter((r) => r.ok);
    if (!ok.length) return false;
    const answers = ok.map((r) => {
      const a = extractAnswer(r.text);
      return a && a.length <= SHORT_ANSWER ? a : "";
    });
    if (answers.some((a) => !a)) return false;
    const t = tally(
      ok.map((r, i) => ({ model: r.model, answer: answers[i] })),
      { weight },
    );
    const used = done.reduce((n, r) => n + weight(r.model), 0);
    const second = t.groups[1]?.score ?? 0;
    return t.groups[0].score > second + (totalWeight - used) + 1e-9;
  };
  const run = async (model, job) => {
    const r = await supervise(model, p.text, job, {
      action: "vote",
      context: p.context,
    });
    // Decided while this model was still working: its late reply or failure is not reported.
    if (stop.signal.aborted) return null;
    if (r.done) {
      onProgress({
        stage: "worker",
        ...job,
        state: "done",
        model,
        elapsedMs: r.elapsedMs,
      });
      return { model, ok: true, text: r.done.text };
    }
    const reason = r.error?.reason ?? failureReason(r.error);
    onProgress({
      stage: "worker",
      ...job,
      state: "failed",
      model,
      reason,
      message: r.error instanceof Error ? r.error.message : tr("실행 실패"),
    });
    return { model, ok: false, reason, text: r.partial?.text ?? "" };
  };
  let release;
  const early = new Promise((resolve) => (release = resolve));
  const runs = p.models.map(async (model) => {
    const job = { taskId: model, title: nameOf(model) };
    const r = await run(model, job);
    if (stop.signal.aborted) return;
    finished.add(model);
    replies.set(model, r);
    if (replies.size < p.models.length && decided()) {
      stop.abort();
      release();
    }
  });
  await Promise.race([Promise.all(runs), early]);
  const stoppedEarly = stop.signal.aborted;
  const settled = p.models.map((model) => {
    if (replies.has(model)) return replies.get(model);
    onProgress({
      stage: "worker",
      taskId: model,
      title: nameOf(model),
      state: "stopped",
      model,
    });
    return { model, ok: false, stopped: true, reason: "stopped", text: "" };
  });

  const ok = settled.filter((r) => r.ok);
  if (!ok.length)
    throw new Error(
      tr("묶은 모델이 모두 답하지 못했습니다. 사용량이 발생했을 수 있습니다."),
    );
  for (const r of ok) {
    const a = extractAnswer(r.text);
    r.answer = a && a.length <= SHORT_ANSWER ? a : "";
  }

  const withAnswer = ok.filter((r) => r.answer);
  let kind;
  let text;
  let writer;
  let warning = "";
  let result = { answer: "", agree: 0, voters: 0, score: 0, groups: [] };
  if (stoppedEarly) {
    kind = "vote";
    result = tally(withAnswer, { weight });
    writer = strongest(result.groups[0].models, weight);
    text = ok.find((r) => r.model === writer).text;
  } else if (ok.length === 1) {
    kind = "single";
    writer = ok[0].model;
    text = ok[0].text;
    result = withAnswer.length
      ? tally(withAnswer, { weight })
      : { ...result, voters: 1, agree: 1 };
    warning = tr("{count}개 중 {writer}만 답해 투표하지 못했습니다.", {
      count: settled.length,
      writer: nameOf(writer),
    });
  } else if (withAnswer.length * 2 >= ok.length) {
    // Most replies end in a short "정답:" line: a question with one right answer. Vote.
    kind = "vote";
    result = tally(withAnswer, { weight });
    writer = strongest(result.groups[0].models, weight);
    text = ok.find((r) => r.model === writer).text;
  } else {
    // Open-ended: the highest-weighted model writes one answer from all of them.
    kind = "merge";
    writer = strongest(
      ok.map((r) => r.model),
      weight,
    );
    onProgress({ stage: "merge", model: writer });
    const prompt = synthesisPrompt(p.text, ok, nameOf);
    const longest = Math.max(...ok.map((r) => r.text.trim().length));
    const r = await supervise(
      writer,
      prompt,
      { taskId: "merge", title: "답 합치기" },
      {
        action: "synthesize",
        context: p.context,
        minChars: Math.min(200, Math.floor(longest * 0.3)),
      },
    );
    const mergeJob = { stage: "worker", taskId: "merge", title: "답 합치기" };
    onProgress(
      r.done
        ? { ...mergeJob, state: "done", model: writer, elapsedMs: r.elapsedMs }
        : {
            ...mergeJob,
            state: "failed",
            model: writer,
            reason: r.error?.reason ?? failureReason(r.error),
          },
    );
    if (r.done) text = r.done.text;
    else {
      text = ok.find((x) => x.model === writer).text;
      warning = tr("답을 합치지 못해 {writer}의 답을 그대로 보여 줍니다.", {
        writer: nameOf(writer),
      });
    }
  }

  const total = Object.values(byModel).reduce(
    (t, u) => ({ in: t.in + u.in, out: t.out + u.out }),
    { in: 0, out: 0 },
  );
  onProgress({ stage: "done" });
  return {
    kind,
    text,
    writer,
    answer: result.answer,
    agree: result.agree,
    voters: result.voters,
    asked: p.models.length,
    stoppedEarly,
    score: result.score,
    models: settled.map((r) => ({
      model: r.model,
      weight: weight(r.model),
      ok: r.ok,
      stopped: r.stopped === true,
      answer: r.answer ?? "",
      agreed:
        kind !== "merge" &&
        !!r.answer &&
        (result.groups[0]?.models ?? []).includes(r.model),
      reason: r.ok ? undefined : r.reason,
      text: r.text.slice(0, KEPT_TEXT),
      usage: byModel[r.model] ?? { in: 0, out: 0 },
    })),
    usage: { total, byModel },
    warning,
    substitutions,
  };
}

module.exports = {
  runEnsemble,
  checkModels,
  bundleable,
  MIN_MODELS,
  MAX_MODELS,
};
