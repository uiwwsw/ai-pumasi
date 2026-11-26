// Team mode: an expensive lead model plans and judges, cheap or free worker models do the work.
// The lead never re-types worker output: its output tokens are the most expensive ones.
const providers = require("./providers.cjs");
const catalog = require("../src/catalog.json");
const { createStatsStore } = require("./worker-stats.cjs");

const REVIEW_BUDGET = 18000; // characters of worker output the lead sees per review
const WORKER_RETRY_DELAY_MS = 4000;
const WORKER_MAX_OUTPUT = 4096;

/** Time budget for one worker call: room to stream the allowed output plus reading the prompt. */
function workerTimeout(promptChars, maxOutputTokens) {
  return Math.min(
    240000,
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
  if (done?.empty || !text) return "empty";
  if (done.incomplete) return "truncated";
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
      "총괄 모델의 작업 분할 형식이 잘못되었습니다. 계획 토큰은 이미 청구됐을 수 있고, 작업은 시작하지 않았습니다.",
    );
  return plan;
}

/** Cap each task's output so the lead always sees every task, and say what was cut. */
function reviewReport(tasks, results) {
  const per = Math.floor(REVIEW_BUDGET / tasks.length);
  return tasks
    .map((t) => {
      const r = results.get(t.id);
      let body = r?.error ? `[실패] ${r.error}` : (r?.text ?? "[결과 없음]");
      if (body.length > per)
        body = `${body.slice(0, per)}\n[…검수용으로 ${body.length - per}자 생략. 생략분은 최종 답에 그대로 포함됨]`;
      return `## ${t.id} · ${t.title}${r?.incomplete ? " (출력 상한 도달)" : ""}\n${body}`;
    })
    .join("\n\n");
}

function concatResults(tasks, results) {
  return tasks
    .map((t) => {
      const r = results.get(t.id);
      return `### ${t.title}\n${r?.error ? `(실패: ${r.error})` : (r?.text ?? "(결과 없음)")}`;
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
 * @param {{lead:string, worker:string, text:string, context:any[], maxRounds?:number}} p
 * @param {{env?:object, fetchImpl?:Function, onProgress?:(e:object)=>void, sleep?:(ms:number)=>Promise<void>, now?:()=>number, stats?:object}} opts
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
  const call = (action, model, text, context, maxOutputTokens, timeoutMs) =>
    providers.request(
      { action, model, text, context, maxOutputTokens },
      { env, fetchImpl: opts.fetchImpl, timeoutMs },
    );

  onProgress({ stage: "plan", model: p.lead });
  const planned = await call("plan", p.lead, p.text, p.context, 4096);
  add("lead", planned);
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
   * Supervise one worker job. Each model gets two tries: a transient failure (rate limit, server
   * error, timeout, dropped connection) waits and retries, an empty, too short or cut-off reply is
   * asked again (cut-off with more room). After that the next model in the chain takes over.
   * If every model only produced a cut-off or short reply, the longest one is kept, marked incomplete.
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
      let maxOutputTokens = WORKER_MAX_OUTPUT;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const timeoutMs = workerTimeout(prompt.length, maxOutputTokens);
        const startedAt = now();
        report("running", { model, attempt, startedAt, timeoutMs });
        let done;
        try {
          done = await call(
            action,
            model,
            prompt,
            [],
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
          if (!transient || attempt === 2) break;
          report("retry", { model, attempt, reason, elapsedMs });
          await sleep(WORKER_RETRY_DELAY_MS);
          continue;
        }
        add("worker", done);
        const elapsedMs = now() - startedAt;
        if (done.substituted) {
          substitutions.push({ requested: model, servedBy: done.servedBy });
          report("substituted", { model, servedBy: done.servedBy });
        }
        const problem = judgeReply(done, minChars);
        stats.record(model, {
          ok: !problem,
          ms: elapsedMs,
          reason: problem || undefined,
          substituted: !!done.substituted,
          servedBy: done.servedBy ?? undefined,
        });
        if (!problem) {
          usedWorkers.add(model);
          report("done", { model, attempt, elapsedMs });
          return done;
        }
        const text = String(done.text ?? "").trim();
        if (text && (!best || text.length > best.text.trim().length))
          best = { ...done, incomplete: true, model };
        last = Object.assign(
          new Error(
            problem === "empty"
              ? "작업 모델이 빈 답을 보냈습니다."
              : problem === "truncated"
                ? "작업 모델 답이 출력 상한에서 잘렸습니다."
                : "작업 모델 답이 작업에 비해 너무 짧습니다.",
          ),
          { reason: problem },
        );
        if (attempt === 2) break;
        if (problem === "truncated")
          maxOutputTokens = Math.min(maxOutputTokens * 2, 16000);
        report("retry", { model, attempt, reason: problem, elapsedMs });
      }
    }
    if (best) {
      usedWorkers.add(best.model);
      report("done", { model: best.model, partial: true });
      return best;
    }
    report("failed", {
      reason: last?.reason ?? failureReason(last),
      message: last instanceof Error ? last.message : "실행 실패",
    });
    throw last;
  }

  const results = new Map();
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
    for (const [i, t] of todo.entries()) {
      onProgress({
        stage: "work",
        round,
        index: i + 1,
        total: todo.length,
        title: t.title,
        model: p.worker,
      });
      const prev = results.get(t.id)?.text;
      const prompt = t.feedback
        ? `${t.instructions}\n\n이전 결과:\n${prev ?? "(없음)"}\n\n검토 의견(이것만 고쳐서 전체 결과를 다시 작성):\n${t.feedback}`
        : t.instructions;
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
            error: error instanceof Error ? error.message : "실행 실패",
          });
      }
    }

    onProgress({ stage: "review", round, model: p.lead });
    let verdict = null;
    try {
      const reviewed = await call(
        "review",
        p.lead,
        `목표: ${goal}\n원래 요청: ${p.text.slice(0, 1500)}\n\n작업 결과:\n${reviewReport(plan.tasks, results)}`,
        [],
        2048,
      );
      add("lead", reviewed);
      verdict = extractJSON(reviewed.text);
    } catch (error) {
      warning = `검수 단계 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}. 작업 결과를 검수 없이 보여 줍니다.`;
      break;
    }
    if (!verdict || typeof verdict.approved !== "boolean") {
      warning =
        "총괄 모델 검수 결과를 읽지 못했습니다. 작업 결과를 검수 없이 보여 줍니다.";
      break;
    }
    if (verdict.approved) {
      approved = true;
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
      warning =
        "총괄 모델이 재작업 대상을 지정하지 못했습니다. 현재 결과로 마감합니다.";
      break;
    }
  }
  if (!approved && !warning)
    warning = `${maxRounds}회차 안에 최종 승인을 받지 못했습니다.`;

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
          // A merge far shorter than its inputs has dropped work.
          minChars: Math.min(200, Math.floor(joined.length * 0.2)),
        },
      );
      text = merged.incomplete ? joined : merged.text || joined;
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
    worker: p.worker,
    workersUsed: [...usedWorkers],
    substitutions,
  };
}

module.exports = {
  orchestrate,
  validPlan,
  extractJSON,
  reviewReport,
  workerChain,
  workerTimeout,
  minReplyChars,
  judgeReply,
};
