// Team mode: an expensive lead model plans and judges, cheap or free worker models do the work.
// The lead never re-types worker output: its output tokens are the most expensive ones.
const providers = require("./providers.cjs");
const catalog = require("../src/catalog.json");
const { createStatsStore } = require("./worker-stats.cjs");
const { tr } = require("./i18n.cjs");

const REVIEW_BUDGET = 18000; // characters of worker output the lead sees per review
const WORKER_RETRY_DELAY_MS = 4000;
// Start workers with room to think. A reply cut off at a small cap is thrown away and the task
// solved again from scratch, so starting at 4096 and doubling paid for every discarded try.
// Only the tokens actually produced are billed; a higher first cap costs nothing on short answers.
const WORKER_MAX_OUTPUT = 16000;
// Reasoning models (Nemotron Super) think before the JSON; a small cap left plans empty.
// Only the tokens actually produced are billed, so a high cap costs nothing extra.
// Hard reasoning tasks need room: Nemotron Super scored 30/30 on the reasoning exam with 30000.
const MAX_OUTPUT = 32000;
const LEAD_MAX_OUTPUT = 16000;
const REVIEW_MAX_OUTPUT = 12000;
const LEAD_TIMEOUT_MS = 300000;
// Tasks are independent, so several run at once. Free tiers allow a few requests in parallel;
// a rate-limited one is retried or handed to the next model as before.
const WORKER_CONCURRENCY = 3;

/** Run fn over items with at most `limit` running at once, keeping the item order for results. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** Time budget for one worker call: room to stream the allowed output plus reading the prompt. */
function workerTimeout(promptChars, maxOutputTokens) {
  // About 40 output tokens a second, so a 32000-token retry may need up to ~14 minutes.
  return Math.min(
    900000,
    Math.max(45000, 20000 + maxOutputTokens * 25 + promptChars * 3),
  );
}

/** Shortest acceptable reply: a long instruction answered with a word is a dropped task. */
function minReplyChars(promptChars) {
  return promptChars >= 400 ? 40 : promptChars >= 120 ? 12 : 1;
}

/** Why a worker reply cannot be accepted as done, or "" when it can. */
function judgeReply(done, minChars) {
  const text = String(done?.text ?? "").trim();
  // A reasoning model can spend the whole budget thinking and write nothing: that is a cut-off,
  // and the retry needs more room, not the same budget again.
  if (done?.incomplete) return "truncated";
  if (done?.empty || !text) return "empty";
  if (text.length < minChars) return "short";
  return "";
}

function failureReason(error) {
  if (error?.timeout) return "timeout";
  if (error?.status === 429) return "rate-limit";
  if (error?.status >= 500) return "server";
  if (error?.transient) return "network";
  return "error";
}

/** Pull the first JSON object out of a reply that may carry prose or code fences around it. */
function extractJSON(text) {
  const s = String(text ?? "");
  try {
    return JSON.parse(s);
  } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced)
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function validPlan(plan) {
  if (
    !plan ||
    !Array.isArray(plan.tasks) ||
    plan.tasks.length < 1 ||
    plan.tasks.length > 6 ||
    plan.tasks.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        typeof t.title !== "string" ||
        typeof t.instructions !== "string" ||
        !t.instructions.trim() ||
        t.instructions.length > 8000,
    ) ||
    new Set(plan.tasks.map((t) => t.id)).size !== plan.tasks.length
  )
    throw new Error(
      tr(
        "총괄 모델의 작업 분할 형식이 잘못되었습니다. 계획 토큰은 이미 청구됐을 수 있고, 작업은 시작하지 않았습니다.",
      ),
    );
  return plan;
}

/** Cap each task's output so the lead always sees every task, and say what was cut. */
function reviewReport(tasks, results) {
  const per = Math.floor(REVIEW_BUDGET / tasks.length);
  return tasks
    .map((t) => {
      const r = results.get(t.id);
      let body = r?.error
        ? tr("[실패] {error}", { error: r.error })
        : (r?.text ?? tr("[결과 없음]"));
      if (body.length > per)
        body = `${body.slice(0, per)}\n${tr("[…검수용으로 {count}자 생략. 생략분은 최종 답에 그대로 포함됨]", { count: body.length - per })}`;
      return `## ${t.id} · ${t.title}${r?.incomplete ? ` (${tr("출력 상한 도달")})` : ""}\n${body}`;
    })
    .join("\n\n");
}

/**
 * Shortest acceptable merge. Merging removes repetition and headings, so it may be shorter than
 * the parts, but not by half: a 449-character merge of six results had kept only one of them.
 */
function mergeFloor(joined) {
  return Math.floor(joined.length * 0.5);
}

function concatResults(tasks, results) {
  return tasks
    .map((t) => {
      const r = results.get(t.id);
      return `### ${t.title}\n${r?.error ? `(${tr("실패: {error}", { error: r.error })})` : (r?.text ?? `(${tr("결과 없음")})`)}`;
    })
    .join("\n\n");
}

/**
 * The chosen worker plus free fallbacks whose key is present, ordered by local track record:
 * models that often fail or answer slowly move back. Without a record the chosen worker leads.
 */
function workerChain(worker, env, ollamaUp, stats) {
  const ok = (m) =>
    m.provider === "ollama"
      ? ollamaUp
      : m.provider === "gemini"
        ? !!env.GEMINI_API_KEY
        : m.provider === "compat"
          ? providers.router.available(m.id, env)
          : false;
  const ids = [
    worker,
    ...catalog
      .filter((m) => m.free && m.id !== worker && ok(m))
      .map((m) => m.id),
  ];
  return stats ? stats.order(ids, worker) : ids;
}

/**
 * Two tries on one model. A transient failure (rate limit, server error, timeout, dropped
 * connection) waits and retries; an empty, too short or cut-off reply is asked again (cut-off with
 * more room). Every attempt is recorded in the local track record.
 * Returns {done, attempt, elapsedMs} on an acceptable reply, otherwise {error, partial} where
 * partial is the longest cut-off or short reply seen, or null.
 */
async function superviseModel(
  model,
  prompt,
  {
    call,
    action = "work",
    context = [],
    minChars = 1,
    maxOutputTokens: firstMax = WORKER_MAX_OUTPUT,
    stats,
    sleep,
    now,
    report = () => {},
    onReply = () => {},
  },
) {
  let last;
  let partial = null;
  let maxOutputTokens = firstMax;
  // Two tries per model; a cut-off reply may keep growing its budget up to MAX_OUTPUT first.
  for (let attempt = 1; attempt <= 5; attempt++) {
    const timeoutMs = workerTimeout(prompt.length, maxOutputTokens);
    const startedAt = now();
    report("running", { model, attempt, startedAt, timeoutMs });
    let done;
    try {
      done = await call(
        action,
        model,
        prompt,
        context,
        maxOutputTokens,
        timeoutMs,
      );
    } catch (error) {
      last = error;
      const reason = failureReason(error);
      const elapsedMs = now() - startedAt;
      stats.record(model, {
        ok: false,
        ms: elapsedMs,
        reason: reason === "timeout" ? "timeout" : "error",
      });
      const transient =
        error?.transient || error?.status === 429 || error?.status >= 500;
      if (!transient || attempt >= 2) break;
      report("retry", { model, attempt, reason, elapsedMs });
      await sleep(WORKER_RETRY_DELAY_MS);
      continue;
    }
    onReply(done);
    const elapsedMs = now() - startedAt;
    if (done.substituted)
      report("substituted", { model, servedBy: done.servedBy });
    const problem = judgeReply(done, minChars);
    stats.record(model, {
      ok: !problem,
      ms: elapsedMs,
      reason: problem || undefined,
      substituted: !!done.substituted,
      servedBy: done.servedBy ?? undefined,
    });
    if (!problem) return { done, attempt, elapsedMs };
    // An empty reply carries only a placeholder message; it is never kept as a result.
    const text = done.empty ? "" : String(done.text ?? "").trim();
    if (text && (!partial || text.length > partial.text.trim().length))
      partial = { ...done, incomplete: true };
    last = Object.assign(
      new Error(
        problem === "empty"
          ? tr("작업 모델이 빈 답을 보냈습니다.")
          : problem === "truncated"
            ? tr("작업 모델 답이 출력 상한에서 잘렸습니다.")
            : tr("작업 모델 답이 작업에 비해 너무 짧습니다."),
      ),
      { reason: problem },
    );
    const canGrow = problem === "truncated" && maxOutputTokens < MAX_OUTPUT;
    if (attempt >= 2 && !canGrow) break;
    if (problem === "truncated")
      maxOutputTokens = Math.min(maxOutputTokens * 2, MAX_OUTPUT);
    report("retry", { model, attempt, reason: problem, elapsedMs });
  }
  return { error: last, partial };
}

/**
 * @param {{lead:string, worker:string, text:string, context:any[], maxRounds?:number}} p
 * @param {{env?:object, fetchImpl?:Function, onProgress?:(e:object)=>void, sleep?:(ms:number)=>Promise<void>, now?:()=>number, stats?:object, onUsage?:(u:object)=>void}} opts
 */
async function orchestrate(p, opts = {}) {
  const env = opts.env ?? process.env;
  const onProgress = opts.onProgress ?? (() => {});
  const sleep =
    opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const stats = opts.stats ?? createStatsStore();
  const maxRounds = Math.min(Math.max(p.maxRounds ?? 2, 1), 3);
  const usage = { lead: { in: 0, out: 0 }, worker: { in: 0, out: 0 } };
  const add = (who, r) => {
    usage[who].in += r.inputTokens ?? 0;
    usage[who].out += r.outputTokens ?? 0;
  };
  const call = (action, model, text, context, maxOutputTokens, timeoutMs, autoOrder) =>
    providers.request(
      { action, model, text, context, maxOutputTokens },
      // Streamed only so a model that goes silent is dropped early instead of after the time limit.
      { env, fetchImpl: opts.fetchImpl, timeoutMs, onUsage: opts.onUsage, autoOrder, stream: true },
    );
  // Automatic lead: the free model ranked first leads; if it is rate-limited or answers empty,
  // the next in the ranking takes over. The user can reorder the ranking in settings.
  const ranked = p.lead === "auto-free";
  let leadOrder = ranked && Array.isArray(p.leadOrder) ? p.leadOrder : null;
  let leadModel = p.lead;

  onProgress({ stage: "plan", model: p.lead });
  const planned = await call("plan", p.lead, p.text, p.context, LEAD_MAX_OUTPUT, LEAD_TIMEOUT_MS, leadOrder);
  add("lead", planned);
  if (ranked && planned.modelId) {
    // The model that planned also reviews, so one lead sees the whole job.
    leadModel = planned.modelId;
    leadOrder = [leadModel, ...(leadOrder ?? []).filter((id) => id !== leadModel)];
  }
  let secondOpinion = null;
  const plan = validPlan(extractJSON(planned.text));
  const goal = typeof plan.goal === "string" ? plan.goal : "";

  const chain = workerChain(
    p.worker,
    env,
    (await providers.status(env, opts.fetchImpl ?? fetch)).ollama,
    stats,
  );
  const usedWorkers = new Set();
  const substitutions = [];
  /**
   * Supervise one worker job. Each model gets two tries (see superviseModel), then the next model
   * in the chain takes over. If every model only produced a cut-off or short reply, the longest one
   * is kept, marked incomplete.
   */
  async function runWorker(
    prompt,
    { action = "work", job, minChars = 1 } = {},
  ) {
    const report = (state, extra = {}) =>
      onProgress({ stage: "worker", ...job, state, ...extra });
    let last;
    let best = null;
    for (const [m, model] of chain.entries()) {
      if (m > 0) report("switch", { model, from: chain[m - 1] });
      const r = await superviseModel(model, prompt, {
        call,
        action,
        minChars,
        stats,
        sleep,
        now,
        report,
        onReply: (done) => {
          add("worker", done);
          if (done.substituted)
            substitutions.push({ requested: model, servedBy: done.servedBy });
        },
      });
      if (r.done) {
        usedWorkers.add(model);
        report("done", { model, attempt: r.attempt, elapsedMs: r.elapsedMs });
        return r.done;
      }
      last = r.error;
      if (
        r.partial &&
        (!best || r.partial.text.trim().length > best.text.trim().length)
      )
        best = { ...r.partial, incomplete: true, model };
    }
    if (best) {
      usedWorkers.add(best.model);
      report("done", { model: best.model, partial: true });
      return best;
    }
    report("failed", {
      reason: last?.reason ?? failureReason(last),
      message: last instanceof Error ? last.message : tr("실행 실패"),
    });
    throw last;
  }

  const results = new Map();
  let helped = 0;
  const taskPrompt = (t, prev) =>
    t.feedback
      ? `${t.instructions}\n\n${tr("이전 결과:")}\n${prev ?? `(${tr("없음")})`}\n\n${tr("검토 의견(이것만 고쳐서 전체 결과를 다시 작성):")}\n${t.feedback}`
      : t.instructions;
  let todo = plan.tasks.map((t) => ({ ...t, feedback: "" }));
  let approved = false;
  let rounds = 0;
  let warning = "";

  for (let round = 1; round <= maxRounds && todo.length; round++) {
    rounds = round;
    for (const t of todo)
      onProgress({
        stage: "worker",
        taskId: t.id,
        title: t.title,
        round,
        state: "waiting",
      });
    // Pumasi: other people's apps take the tasks first. Tasks nobody answered fall back to our worker.
    const remote = new Map();
    if (opts.remote) {
      const prompts = todo.map((t) => taskPrompt(t, results.get(t.id)?.text).slice(0, 20000));
      const got = await opts.remote(prompts);
      for (const [i, t] of todo.entries()) {
        const texts = (got.get(i) ?? []).filter((s) => String(s).trim());
        if (!texts.length) continue;
        if (texts.length === 1) {
          remote.set(t.id, texts[0]);
          continue;
        }
        // Two helpers answered: our worker writes the better one from both, so one bad helper cannot win.
        try {
          const picked = await runWorker(
            `${t.instructions.slice(0, 6000)}\n\n${texts.map((s, n) => `--- ${n + 1} ---\n${s.slice(0, 8000)}`).join("\n\n")}`,
            { action: "merge", job: { taskId: t.id, title: t.title, round }, minChars: minReplyChars(t.instructions.length) },
          );
          remote.set(t.id, picked.incomplete ? texts[0] : picked.text);
        } catch {
          remote.set(t.id, texts[0]);
        }
      }
      helped += remote.size;
    }
    await pool(todo, WORKER_CONCURRENCY, async (t, i) => {
      if (remote.has(t.id)) {
        results.set(t.id, { text: remote.get(t.id) });
        onProgress({ stage: "worker", taskId: t.id, title: t.title, round, state: "done", model: "pumasi" });
        return;
      }
      onProgress({
        stage: "work",
        round,
        index: i + 1,
        total: todo.length,
        title: t.title,
        model: p.worker,
      });
      const prev = results.get(t.id)?.text;
      const prompt = taskPrompt(t, prev);
      // Workers get only their own task, never the whole conversation: that is the token saving.
      try {
        const sent = prompt.slice(0, 20000);
        const done = await runWorker(sent, {
          job: { taskId: t.id, title: t.title, round },
          minChars: minReplyChars(t.instructions.length),
        });
        results.set(t.id, { text: done.text, incomplete: done.incomplete });
      } catch (error) {
        // Keep an earlier good result rather than replacing it with a failure.
        if (!prev)
          results.set(t.id, {
            error: error instanceof Error ? error.message : tr("실행 실패"),
          });
      }
    });

    onProgress({ stage: "review", round, model: p.lead });
    let verdict = null;
    try {
      const reviewed = await call(
        "review",
        p.lead,
        `목표: ${goal}\n원래 요청: ${p.text.slice(0, 1500)}\n\n작업 결과:\n${reviewReport(plan.tasks, results)}`,
        [],
        REVIEW_MAX_OUTPUT,
        LEAD_TIMEOUT_MS,
        leadOrder,
      );
      add("lead", reviewed);
      verdict = extractJSON(reviewed.text);
      // The lead approved but was not sure: the runner-up in the ranking checks once.
      // This is the only extra call, and only when the lead asks for it.
      const reviewer = reviewed.modelId ?? leadModel;
      const second = ranked
        ? providers.autoCandidates(env, leadOrder).find((id) => id !== reviewer)
        : null;
      if (verdict?.approved === true && verdict.sure === false && second) {
        onProgress({ stage: "review", round, model: second, second: true });
        try {
          const checked = await call(
            "review",
            second,
            `목표: ${goal}\n원래 요청: ${p.text.slice(0, 1500)}\n\n작업 결과:\n${reviewReport(plan.tasks, results)}`,
            [],
            REVIEW_MAX_OUTPUT,
            LEAD_TIMEOUT_MS,
          );
          add("lead", checked);
          const v = extractJSON(checked.text);
          if (v && typeof v.approved === "boolean") {
            secondOpinion = { model: second, approved: v.approved };
            verdict = v;
          }
        } catch {
          // The runner-up could not answer: keep the lead's approval.
        }
      }
    } catch (error) {
      warning = tr(
        "검수 단계 실패: {error}. 작업 결과를 검수 없이 보여 줍니다.",
        {
          error: error instanceof Error ? error.message : tr("알 수 없는 오류"),
        },
      );
      break;
    }
    if (!verdict || typeof verdict.approved !== "boolean") {
      warning = tr(
        "총괄 모델 검수 결과를 읽지 못했습니다. 작업 결과를 검수 없이 보여 줍니다.",
      );
      break;
    }
    if (verdict.approved) {
      approved = true;
      break;
    }
    // Redoing a task means solving it again in full. Do that only when the lead is sure the result
    // is wrong; an unsure rejection keeps the results and says so.
    if (verdict.sure === false) {
      warning = tr("총괄 모델이 결과를 확신하지 못했지만 다시 풀지는 않았습니다. 확인해 주세요.");
      break;
    }
    const redo = Array.isArray(verdict.redo) ? verdict.redo : [];
    todo = redo
      .map((r) => {
        const t = plan.tasks.find((x) => x.id === r?.id);
        return t && { ...t, feedback: String(r.feedback ?? "").slice(0, 4000) };
      })
      .filter(Boolean);
    // No valid redo target: another review would only re-read the same results.
    if (!todo.length) {
      warning = tr(
        "총괄 모델이 재작업 대상을 지정하지 못했습니다. 현재 결과로 마감합니다.",
      );
      break;
    }
  }
  if (!approved && !warning)
    warning = tr("{maxRounds}회차 안에 최종 승인을 받지 못했습니다.", {
      maxRounds,
    });

  // Final answer: one task needs no merge; several are merged by a cheap worker, never the lead.
  let text;
  const ok = plan.tasks.filter((t) => results.get(t.id)?.text);
  const joined = concatResults(plan.tasks, results);
  // Too long to merge without truncation: show every result as is rather than lose content.
  if (plan.tasks.length === 1 || ok.length <= 1 || joined.length > 18000)
    text = joined;
  else {
    onProgress({ stage: "merge", model: p.worker });
    try {
      const merged = await runWorker(
        `원래 요청: ${p.text.slice(0, 1500)}\n\n아래 결과들을 하나의 최종 답으로 합치세요.\n\n${joined}`,
        {
          action: "merge",
          job: { taskId: "merge", title: "결과 합치기" },
          // A merge much shorter than its inputs has dropped work: ask again, then another model.
          minChars: mergeFloor(joined),
        },
      );
      // Still too short or cut off: show every result as is rather than lose a part.
      text =
        merged.incomplete || (merged.text ?? "").length < mergeFloor(joined)
          ? joined
          : merged.text;
    } catch {
      text = joined;
    }
  }
  if (plan.tasks.length === 1 && ok.length === 1)
    text = results.get(ok[0].id).text;

  onProgress({ stage: "done", round: rounds });
  return {
    text,
    goal,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      failed: !!results.get(t.id)?.error,
      incomplete: !!results.get(t.id)?.incomplete,
    })),
    rounds,
    approved,
    warning,
    usage,
    lead: p.lead,
    leadModel,
    secondOpinion,
    worker: p.worker,
    workersUsed: [...usedWorkers],
    substitutions,
    pumasiTasks: helped,
  };
}

module.exports = {
  orchestrate,
  superviseModel,
  failureReason,
  validPlan,
  extractJSON,
  reviewReport,
  workerChain,
  workerTimeout,
  minReplyChars,
  judgeReply,
};
