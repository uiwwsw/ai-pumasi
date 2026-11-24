// Team mode: an expensive lead model plans and reviews, cheap or free worker models do the work.
const providers = require("./providers.cjs");

function parseJSON(text, what) {
  try {
    return JSON.parse(
      String(text)
        .replace(/^\s*```(?:json)?\s*/, "")
        .replace(/\s*```\s*$/, ""),
    );
  } catch {
    throw new Error(
      `선임 모델이 ${what} 결과를 올바른 형식으로 주지 않았습니다. 이미 쓴 토큰은 청구됐을 수 있습니다.`,
    );
  }
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
    )
  )
    throw new Error("선임 모델의 작업 분할 형식이 잘못되었습니다.");
  return plan;
}

/**
 * @param {{lead:string, worker:string, text:string, context:any[], maxRounds?:number}} p
 * @param {{env?:object, fetchImpl?:Function, onProgress?:(e:object)=>void}} opts
 */
async function orchestrate(p, opts = {}) {
  const { onProgress = () => {} } = opts;
  const maxRounds = Math.min(Math.max(p.maxRounds ?? 2, 1), 3);
  const usage = { lead: { in: 0, out: 0 }, worker: { in: 0, out: 0 } };
  const add = (who, r) => {
    usage[who].in += r.inputTokens ?? 0;
    usage[who].out += r.outputTokens ?? 0;
  };
  const call = (action, model, text, context, maxOutputTokens) =>
    providers.request(
      { action, model, text, context, maxOutputTokens },
      { env: opts.env, fetchImpl: opts.fetchImpl },
    );

  onProgress({ stage: "plan", model: p.lead });
  const planned = await call("plan", p.lead, p.text, p.context, 4096);
  add("lead", planned);
  const plan = validPlan(parseJSON(planned.text, "작업 분할"));
  const results = new Map();
  let todo = plan.tasks.map((t) => ({ ...t, feedback: "" }));

  for (let round = 1; round <= maxRounds; round++) {
    for (const [i, t] of todo.entries()) {
      onProgress({
        stage: "work",
        round,
        index: i + 1,
        total: todo.length,
        title: t.title,
        model: p.worker,
      });
      const prompt = t.feedback
        ? `${t.instructions}\n\n이전 결과:\n${results.get(t.id) ?? ""}\n\n선임 피드백(이것만 고쳐서 전체 결과를 다시 작성):\n${t.feedback}`
        : t.instructions;
      // Workers get only their own task, never the whole conversation: that is the token saving.
      const done = await call(
        "work",
        p.worker,
        prompt.slice(0, 20000),
        [],
        4096,
      );
      add("worker", done);
      results.set(t.id, done.text);
    }
    onProgress({ stage: "review", round, model: p.lead });
    const report = plan.tasks
      .map((t) => `## ${t.id} · ${t.title}\n${results.get(t.id) ?? ""}`)
      .join("\n\n");
    const reviewed = await call(
      "review",
      p.lead,
      `목표: ${plan.goal ?? ""}\n원래 요청: ${p.text}\n\n주니어 결과:\n${report}${round === maxRounds ? "\n\n마지막 검수입니다. 반드시 approved:true와 최선의 final을 주세요." : ""}`.slice(
        0,
        20000,
      ),
      [],
      8192,
    );
    add("lead", reviewed);
    const verdict = parseJSON(reviewed.text, "검수");
    const redo = Array.isArray(verdict.redo) ? verdict.redo : [];
    if (verdict.approved === true || round === maxRounds || !redo.length) {
      const final =
        typeof verdict.final === "string" && verdict.final.trim()
          ? verdict.final
          : report;
      onProgress({ stage: "done", round });
      return {
        text: final,
        goal: plan.goal ?? "",
        tasks: plan.tasks.map((t) => ({ id: t.id, title: t.title })),
        rounds: round,
        approved: verdict.approved === true,
        usage,
        lead: p.lead,
        worker: p.worker,
      };
    }
    todo = redo
      .map((r) => {
        const t = plan.tasks.find((x) => x.id === r?.id);
        return t && { ...t, feedback: String(r.feedback ?? "") };
      })
      .filter(Boolean);
    if (!todo.length) todo = [];
  }
}

module.exports = { orchestrate, validPlan, parseJSON };
