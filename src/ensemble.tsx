// Bundle vote: settings rows, the message built from a result, and the folded details under it.
import React from "react";
import type { Message } from "./domain";
import { t } from "./i18n";
import {
  BUNDLE_MAX,
  BUNDLE_MIN,
  bundleModels,
  modelById,
  modelReady,
  type EnsembleResult,
  type ProviderStatus,
  type RoutingSettings,
} from "./routing";

const STORED_TEXT = 3000; // characters of each model's reply kept in the saved conversation

const reasonNames: Record<string, string> = {
  timeout: t("시간 초과"),
  "rate-limit": t("한도 초과"),
  server: t("제공자 오류"),
  network: t("연결 실패"),
  error: t("요청 거절"),
  empty: t("빈 답"),
  short: t("너무 짧은 답"),
  truncated: t("답이 잘림"),
  stopped: t("답이 이미 정해져 기다리지 않음"),
};
const nameOf = (id: string) => modelById(id)?.name ?? id;

/** True when the bundle has enough selected models that can run right now. */
export function bundleReady(r: RoutingSettings, status: ProviderStatus) {
  return (
    r.ensemble &&
    r.ensembleModels.filter((id) => modelReady(id, status)).length >= BUNDLE_MIN
  );
}

export function EnsembleSettings({
  routing,
  setRouting,
  status,
}: {
  routing: RoutingSettings;
  setRouting: (fn: (r: RoutingSettings) => RoutingSettings) => void;
  status: ProviderStatus;
}) {
  const picked = routing.ensembleModels;
  const toggle = (id: string) =>
    setRouting((r) => ({
      ...r,
      ensembleModels: r.ensembleModels.includes(id)
        ? r.ensembleModels.filter((x) => x !== id)
        : [...r.ensembleModels, id].slice(0, BUNDLE_MAX),
    }));
  const usable = picked.filter((id) => modelReady(id, status)).length;
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>{t("묶음 투표")}</strong>
          <small>
            {t(
              "같은 질문을 무료·경량 모델 여러 개에 동시에 묻습니다. 정답이 짧은 질문은 측정 성적으로 무게를 준 투표로 고르고, 긴 답은 성적이 가장 좋은 모델이 하나로 합칩니다. 켜면 팀 모드 대신 이 방식으로 실행합니다.",
            )}
          </small>
        </span>
        <input
          type="checkbox"
          aria-label={t("묶음 투표")}
          checked={routing.ensemble}
          onChange={(e) =>
            setRouting((r) => ({
              ...r,
              ensemble: e.target.checked,
              team: e.target.checked ? false : r.team,
            }))
          }
        />
      </label>
      {routing.ensemble && (
        <div
          className="ensemble-picker"
          role="group"
          aria-labelledby="ensemble-picker-title"
        >
          <div className="ensemble-picker-title" id="ensemble-picker-title">
            {t("묶을 모델")}{" "}
            <span>
              {t("{min}~{max}개", { min: BUNDLE_MIN, max: BUNDLE_MAX })}
            </span>
          </div>
          {bundleModels.map((m) => {
            const on = picked.includes(m.id);
            const available = modelReady(m.id, status);
            return (
              <label
                key={m.id}
                className={`ensemble-option${available ? "" : " is-off"}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!available || (!on && picked.length >= BUNDLE_MAX)}
                  onChange={() => toggle(m.id)}
                />
                <span>{m.name}</span>
                <small>
                  {available
                    ? m.free
                      ? t("무료")
                      : t("경량")
                    : m.provider === "ollama"
                      ? t("실행 안 됨")
                      : m.provider === "compat"
                        ? t("무료 제공자 키 없음")
                        : t("키 없음")}
                </small>
              </label>
            );
          })}
          <p className="ensemble-note">
            {usable < BUNDLE_MIN
              ? t(
                  "실행할 수 있는 모델을 {min}개 이상 골라야 묶음 투표로 실행합니다. 그 전에는 기본 실행 모델로 실행합니다.",
                  { min: BUNDLE_MIN },
                )
              : t(
                  "{count}개 모델에 동시에 묻습니다. 사용량도 모델 수만큼 듭니다.",
                  { count: usable },
                )}{" "}
            {t(
              "무게는 공개 측정에서 미리 정한 값이고 앱이 바꾸지 않습니다. 측정에 없는 모델은 모두 같은 작은 무게라 다수결과 같고, 동점이면 위에서 먼저 고른 모델을 따릅니다.",
            )}
          </p>
        </div>
      )}
    </>
  );
}

/** The assistant message for a bundle result: the answer, a usage footer, and folded details. */
export function ensembleMessage(
  r: EnsembleResult,
): Pick<Message, "text" | "model" | "ensemble"> {
  const { text, ...rest } = r;
  const failed = r.models.filter((m) => !m.ok && !m.stopped).length;
  const skipped = r.models.filter((m) => m.stopped).length;
  const footer = t(
    "묶음 투표 · {asked}개 모델{failed}{skipped} · 합계 입력 {inTokens} / 출력 {outTokens} 토큰",
    {
      asked: r.asked,
      failed: failed ? t(" ({n}개 실패)", { n: failed }) : "",
      skipped: skipped
        ? t(" · 답이 정해져 {n}개는 기다리지 않음", { n: skipped })
        : "",
      inTokens: r.usage.total.in,
      outTokens: r.usage.total.out,
    },
  );
  const swaps = [
    ...new Set(
      (r.substitutions ?? []).map((s) =>
        t("\n주의: {requested} 대신 {servedBy}가 답했습니다.", {
          requested: nameOf(s.requested),
          servedBy: s.servedBy ?? t("다른 모델"),
        }),
      ),
    ),
  ].join("");
  return {
    text: `${text}\n\n—\n${footer}${r.warning ? `\n${t("주의: {warning}", { warning: r.warning })}` : ""}${swaps}`,
    model: r.writer,
    ensemble: {
      ...rest,
      models: r.models.map((m) => ({
        ...m,
        text: m.text.slice(0, STORED_TEXT),
      })),
    },
  };
}

function headline(e: NonNullable<Message["ensemble"]>) {
  if (e.kind === "vote" && e.stoppedEarly)
    return t(
      "{agree}개 모델이 같은 답 · 남은 모델이 모두 반대해도 뒤집히지 않아 바로 확정",
      { agree: e.agree },
    );
  if (e.kind === "vote")
    return e.agree === e.voters
      ? t("{voters}개 모델이 모두 같은 답", { voters: e.voters })
      : t("{voters}개 모델 중 {agree}개가 같은 답", {
          voters: e.voters,
          agree: e.agree,
        });
  if (e.kind === "merge")
    return t("서술형이라 투표 없이 {writer}가 {count}개 답을 합침", {
      writer: nameOf(e.writer),
      count: e.models.filter((m) => m.ok).length,
    });
  return t("{writer} 하나만 답함", { writer: nameOf(e.writer) });
}

export function EnsembleDetails({
  ensemble: e,
}: {
  ensemble: Message["ensemble"];
}) {
  if (!e || !Array.isArray(e.models)) return null;
  const failed = e.models.filter((m) => !m.ok && !m.stopped).length;
  return (
    <details className="ensemble-details">
      <summary>
        <span className="ensemble-headline">{headline(e)}</span>
        {e.kind === "vote" && e.answer && (
          <span className="ensemble-answer">{e.answer}</span>
        )}
        {failed > 0 && (
          <span className="ensemble-muted">
            {t("{count}개는 답하지 못해 제외", { count: failed })}
          </span>
        )}
        <span className="ensemble-toggle">{t("모델별 답")}</span>
      </summary>
      <ul>
        {e.models.map((m) => (
          <li
            key={m.model}
            className={
              m.ok
                ? m.agreed
                  ? "is-agreed"
                  : ""
                : m.stopped
                  ? "is-stopped"
                  : "is-failed"
            }
          >
            <div className="ensemble-row">
              <strong>{nameOf(m.model)}</strong>
              <span className="ensemble-pick">
                {m.stopped
                  ? reasonNames.stopped
                  : !m.ok
                    ? t("제외 · {reason}", {
                        reason: reasonNames[m.reason ?? ""] ?? t("실패"),
                      })
                    : e.kind === "merge"
                      ? m.model === e.writer
                        ? t("합친 모델")
                        : t("참고 답")
                      : m.answer || t("정답 줄 없음")}
              </span>
              <span className="ensemble-meta">
                {t("무게 {weight} · 입력 {inTokens} / 출력 {outTokens}", {
                  weight: m.weight.toFixed(2),
                  inTokens: m.usage.in,
                  outTokens: m.usage.out,
                })}
              </span>
            </div>
            {m.text && (
              <details className="ensemble-reply">
                <summary>{t("답 전체")}</summary>
                <div className="message-text">{m.text}</div>
              </details>
            )}
          </li>
        ))}
      </ul>
      <p className="ensemble-muted">
        {t("합계 입력 {inTokens} / 출력 {outTokens} 토큰", {
          inTokens: e.usage.total.in,
          outTokens: e.usage.total.out,
        })}
        {e.kind === "vote"
          ? t(" · 이긴 답의 무게 합 {score}", { score: e.score })
          : ""}
      </p>
    </details>
  );
}
