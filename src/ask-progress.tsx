// What the app is doing while it answers: only things that are actually happening, with the
// controls to skip a part or finish with what is done. No percentages and no made-up status.
import React, { useEffect, useState } from "react";
import { t } from "./i18n";
import { modelById, type AskProgress, type AskResult } from "./routing";
import type { TrailStep } from "./domain";
import { ModelToken } from "./crew";

export type AskPart = {
  id: string;
  title: string;
  state: Extract<AskProgress, { stage: "part" }>["state"];
  model?: string;
  from?: string;
  reason?: string;
  startedAt?: number;
  text?: string;
  message?: string;
  /** The last stretch of the model's own reasoning, when it sends any. */
  thinking?: string;
};
export type AskRun = {
  stage: "start" | "route" | "work" | "check" | "revise";
  mode?: AskResult["mode"];
  parts: AskPart[];
  checker?: string;
  /** The single answer when the work is not split. */
  answer?: AskPart;
  startedAt: number;
};
export const emptyRun = (): AskRun => ({ stage: "start", parts: [], startedAt: Date.now() });
/** Several models worked on it together: split between them, or one solving and one checking. */
export const MODE_NAME = "Pumasi mode";
/** After this long without an answer, asking another user for help is offered. */
export const SLOW_MS = 45_000;

/** Fold one progress event into the run shown on screen. */
export function applyProgress(run: AskRun, e: AskProgress): AskRun {
  if (e.stage === "route") return { ...run, stage: "route" };
  if (e.stage === "plan") return { ...run, stage: "work", mode: e.mode };
  if (e.stage === "check") return { ...run, stage: "check", checker: e.model };
  if (e.stage === "revise") return { ...run, stage: "revise" };
  if (e.stage === "think") {
    if (e.id === "answer")
      return run.answer ? { ...run, answer: { ...run.answer, thinking: e.text } } : run;
    return {
      ...run,
      parts: run.parts.map((p) => (p.id === e.id ? { ...p, thinking: e.text } : p)),
    };
  }
  if (e.stage !== "part") return run;
  const found = e.id === "answer" ? run.answer : run.parts.find((p) => p.id === e.id);
  const next: AskPart = {
    ...(found ?? { id: e.id, title: e.title, state: e.state }),
    ...Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== "stage" && v !== undefined)),
    // A new try starts clean: no reason left over from the last one.
    ...(e.state === "running" ? { reason: undefined, from: undefined, thinking: undefined } : {}),
  } as AskPart;
  if (e.id === "answer") return { ...run, answer: next };
  return {
    ...run,
    parts: found ? run.parts.map((p) => (p.id === e.id ? next : p)) : [...run.parts, next],
  };
}

const name = (id?: string) => (id ? (modelById(id)?.name ?? id) : "");
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? t("{s}초", { s }) : t("{m}분 {s}초", { m: Math.floor(s / 60), s: s % 60 });
};
function why(reason?: string) {
  if (reason === "timeout") return t("응답이 없어");
  if (reason === "rate-limit") return t("한도에 걸려");
  if (reason === "server" || reason === "network") return t("연결이 끊겨");
  if (reason === "empty") return t("빈 답이 와서");
  if (reason === "truncated") return t("답이 잘려서");
  return t("문제가 생겨");
}
function partLine(p: AskPart, now: number) {
  if (p.state === "waiting") return t("차례를 기다리는 중");
  if (p.state === "done") return t("끝남 · {model}", { model: name(p.model) });
  if (p.state === "skipped") return t("건너뜀");
  if (p.state === "failed") return t("실패");
  if (p.state === "switch")
    return t("{why} {model}(으)로 넘김", { why: why(p.reason), model: name(p.model) });
  if (p.state === "retry") return t("{why} 다시 묻는 중", { why: why(p.reason) });
  return t("{model} · {time}", { model: name(p.model), time: clock(now - (p.startedAt ?? now)) });
}

/** The last lines of a model's reasoning, as plain text. */
const lastThought = (text?: string) => (text ?? "").replace(/\s+/g, " ").trim().slice(-220);

export function AskProgressView({
  run,
  writing,
  onSkip,
  onFinish,
  onHelp,
}: {
  run: AskRun;
  /** The answer has started to appear below. */
  writing: boolean;
  onSkip: (id: string) => void;
  onFinish: () => void;
  /** Offered once the wait is long: ask another user's app for help. */
  onHelp?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const done = run.parts.filter((p) => p.state === "done").length;
  const open = run.parts.filter((p) => !["done", "skipped", "failed"].includes(p.state)).length;
  const a = run.answer;
  const single =
    a?.state === "switch"
      ? t("{why} {model}(으)로 넘김", { why: why(a.reason), model: name(a.model) })
      : a?.state === "retry"
        ? t("{why} 다시 묻는 중", { why: why(a.reason) })
        : writing
          ? a?.model
            ? t("{model}이(가) 답을 쓰는 중", { model: name(a.model) })
            : t("답을 쓰는 중")
          : a?.model
            ? t("{model}이(가) 생각하는 중", { model: name(a.model) })
            : t("답할 모델을 부르는 중");
  const headline =
    run.stage === "route"
      ? t("어떻게 풀지 정하는 중")
      : run.stage === "check"
        ? t("{model}이(가) 답을 검수하는 중", { model: name(run.checker) })
        : run.stage === "revise"
          ? t("검수에서 나온 지적을 반영해 고치는 중")
          : run.mode === "split"
            ? t("{total}개로 나눠 푸는 중 · {done}개 끝남", { total: run.parts.length, done })
            : single;
  const together = run.mode === "split" || run.mode === "roles";
  const thought = run.mode === "split" || writing ? "" : lastThought(a?.thinking);
  return (
    <div className="ask-progress" role="status" aria-live="polite">
      <div className="ask-headline">
        <span className="ask-headline-text">
          {together && <span className="mode-chip">{MODE_NAME}</span>}
          {run.mode !== "split" && (run.stage === "check" ? run.checker : a?.model) && (
            <ModelToken id={run.stage === "check" ? run.checker : a?.model} />
          )}
          <span>{headline}</span>
          <span className="ask-elapsed">{clock(now - run.startedAt)}</span>
        </span>
        {run.mode === "split" && done > 0 && open > 0 && (
          <button type="button" onClick={onFinish}>
            {t("지금까지로 마무리")}
          </button>
        )}
      </div>
      {thought && <p className="ask-thought">{thought}</p>}
      {run.mode === "split" && (
        <ol>
          {run.parts.map((p) => (
            <li key={p.id} className={`is-${p.state}`}>
              <ModelToken id={p.model} />
              <span className="ask-part-title">
                {p.title}
                {p.state === "running" && p.thinking && (
                  <span className="ask-part-thought">{lastThought(p.thinking)}</span>
                )}
              </span>
              <span className="ask-part-state">{partLine(p, now)}</span>
              {!["done", "skipped", "failed"].includes(p.state) && (
                <button type="button" onClick={() => onSkip(p.id)}>
                  {t("건너뛰기")}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {onHelp && now - run.startedAt >= SLOW_MS && (
        <p className="ask-slow">
          {t("오래 걸리고 있습니다.")}
          <button type="button" onClick={onHelp}>
            {t("Ask for help")}
          </button>
        </p>
      )}
    </div>
  );
}

/** The parts that are already answered, in order, for showing before the rest are done. */
export const finishedText = (run: AskRun) =>
  run.parts
    .filter((p) => p.state === "done" && p.text)
    .map((p) => `### ${p.title}\n\n${p.text}`)
    .join("\n\n");

/** One quiet line under an answer saying how it was produced. */
export function howLine(r: AskResult): string {
  if (r.mode === "split") {
    const n = r.parts?.length ?? 0;
    const skipped = r.parts?.filter((p) => p.skipped).length ?? 0;
    const failed = r.parts?.filter((p) => p.failed).length ?? 0;
    return [
      MODE_NAME,
      t("{n}개로 나눠 풂", { n }),
      skipped ? t("{n}개 건너뜀", { n: skipped }) : "",
      failed ? t("{n}개 실패", { n: failed }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const model = name(r.model);
  if (r.mode === "roles" && r.check)
    return [
      MODE_NAME,
      model,
      r.check.revised
        ? t("{model}의 검수를 반영해 고침", { model: name(r.check.model) })
        : r.check.verdict === "right"
          ? t("{model}이(가) 검수함", { model: name(r.check.model) })
          : t("{model}이(가) 검수했지만 확신하지 못함", { model: name(r.check.model) }),
    ].join(" · ");
  return model;
}

/** Who did which part, kept with the answer. Nothing for an answer one model gave directly. */
export function trailOf(r: AskResult): TrailStep[] | undefined {
  if (r.mode === "split" && r.parts?.length)
    return r.parts.map((p) => ({
      label: p.title,
      model: p.model,
      note: p.skipped
        ? t("건너뜀")
        : p.failed
          ? t("실패")
          : p.incomplete
            ? t("답이 잘림")
            : undefined,
    }));
  if (r.mode === "roles" && r.check)
    return [
      { label: t("풀이"), model: r.model },
      {
        label: t("검수"),
        model: r.check.model,
        note:
          r.check.verdict === "right"
            ? t("맞다고 봄")
            : r.check.verdict === "wrong"
              ? t("틀린 곳을 지적함")
              : t("확신하지 못함"),
      },
      ...(r.check.revised ? [{ label: t("지적을 반영해 다시 풀이"), model: r.model }] : []),
    ];
  return undefined;
}
