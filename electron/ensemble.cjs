// Bundle mode: the same request goes to several free or cheap models at once. A short definite
// answer is picked by a vote weighted by each model's measured accuracy; a long answer is written
// by the highest-weighted model from all replies. Failed models drop out of the vote.
const providers = require("./providers.cjs");
const catalog = require("../src/catalog.json");
const { createStatsStore } = require("./worker-stats.cjs");
const { superviseModel, failureReason } = require("./team.cjs");
const { extractAnswer, weightOf, tally } = require("./ensemble-vote.cjs");

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
      `묶음 투표에는 서로 다른 모델 ${MIN_MODELS}~${MAX_MODELS}개가 필요합니다.`,
    );
  for (const id of ids) {
    const m = catalog.find((x) => x.id === id);
    if (!bundleable(m))
      throw new Error("묶음 투표에는 무료·경량 모델만 넣을 수 있습니다.");
    if (m.provider === "compat" ? !status.models?.[m.id] : !status[m.provider])
      throw new Error(
        `${m.name}: ${m.provider === "ollama" ? "Ollama가 실행 중이 아닙니다." : m.provider === "compat" ? "이 모델을 주는 무료 제공자(NVIDIA·OpenRouter·Groq·Gemini 등) 키가 없습니다." : "키가 설정되지 않았습니다."}`,
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
      if (t.length > per) t = `${t.slice(0, per)}\n[…${t.length - per}자 생략]`;
      return `## 답 ${i + 1} · ${nameOf(r.model)}\n${t}`;
    })
    .join("\n\n");
  return `요청:\n${text.slice(0, 3000)}\n\n같은 요청에 대한 여러 모델의 답:\n\n${body}`;
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
      { env, fetchImpl, timeoutMs, onUsage: opts.onUsage },
    );
  const supervise = (model, prompt, job, extra) =>
    superviseModel(model, prompt, {
      call,
      stats,
      sleep,
      now,
      maxOutputTokens: MAX_OUTPUT,
      onReply: onReply(model),
      report: (state, e = {}) =>
        onProgress({ stage: "worker", ...job, state, ...e }),
      ...extra,
    });

  for (const model of p.models)
    onProgress({
      stage: "worker",
      taskId: model,
      title: nameOf(model),
      state: "waiting",
    });
  const settled = await Promise.all(
    p.models.map(async (model) => {
      const job = { taskId: model, title: nameOf(model) };
      const r = await supervise(model, p.text, job, {
        action: "vote",
        context: p.context,
      });
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
        message: r.error instanceof Error ? r.error.message : "실행 실패",
      });
      return { model, ok: false, reason, text: r.partial?.text ?? "" };
    }),
  );

  const ok = settled.filter((r) => r.ok);
  if (!ok.length)
    throw new Error(
      "묶은 모델이 모두 답하지 못했습니다. 사용량이 발생했을 수 있습니다.",
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
  if (ok.length === 1) {
    kind = "single";
    writer = ok[0].model;
    text = ok[0].text;
    result = withAnswer.length
      ? tally(withAnswer, { weight })
      : { ...result, voters: 1, agree: 1 };
    warning = `${settled.length}개 중 ${nameOf(writer)}만 답해 투표하지 못했습니다.`;
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
      warning = `답을 합치지 못해 ${nameOf(writer)}의 답을 그대로 보여 줍니다.`;
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
    score: result.score,
    models: settled.map((r) => ({
      model: r.model,
      weight: weight(r.model),
      ok: r.ok,
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
