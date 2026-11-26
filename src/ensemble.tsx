// Bundle vote: settings rows, the message built from a result, and the folded details under it.
import React from "react";
import type { Message } from "./domain";
import {
  BUNDLE_MAX,
  BUNDLE_MIN,
  bundleModels,
  modelById,
  type EnsembleResult,
  type ProviderStatus,
  type RoutingSettings,
} from "./routing";

const STORED_TEXT = 3000; // characters of each model's reply kept in the saved conversation

const reasonNames: Record<string, string> = {
  timeout: "시간 초과",
  "rate-limit": "한도 초과",
  server: "제공자 오류",
  network: "연결 실패",
  error: "요청 거절",
  empty: "빈 답",
  short: "너무 짧은 답",
  truncated: "답이 잘림",
};
const nameOf = (id: string) => modelById(id)?.name ?? id;

/** True when the bundle has enough selected models that can run right now. */
export function bundleReady(r: RoutingSettings, status: ProviderStatus) {
  return (
    r.ensemble &&
    r.ensembleModels.filter((id) => status[modelById(id)?.provider]).length >=
      BUNDLE_MIN
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
  const usable = picked.filter((id) => status[modelById(id)?.provider]).length;
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>묶음 투표</strong>
          <small>
            같은 질문을 무료·경량 모델 여러 개에 동시에 묻습니다. 정답이 짧은
            질문은 측정 성적으로 무게를 준 투표로 고르고, 긴 답은 성적이 가장
            좋은 모델이 하나로 합칩니다. 켜면 팀 모드 대신 이 방식으로
            실행합니다.
          </small>
        </span>
        <input
          type="checkbox"
          aria-label="묶음 투표"
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
            묶을 모델{" "}
            <span>
              {BUNDLE_MIN}~{BUNDLE_MAX}개
            </span>
          </div>
          {bundleModels.map((m) => {
            const on = picked.includes(m.id);
            const available = !!status[m.provider];
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
                      ? "무료"
                      : "경량"
                    : m.provider === "ollama"
                      ? "실행 안 됨"
                      : "키 없음"}
                </small>
              </label>
            );
          })}
          <p className="ensemble-note">
            {usable < BUNDLE_MIN
              ? `실행할 수 있는 모델을 ${BUNDLE_MIN}개 이상 골라야 묶음 투표로 실행합니다. 그 전에는 기본 실행 모델로 실행합니다.`
              : `${usable}개 모델에 동시에 묻습니다. 사용량도 모델 수만큼 듭니다.`}{" "}
            무게는 공개 측정에서 미리 정한 값이고 앱이 바꾸지 않습니다. 측정에
            없는 모델은 모두 같은 작은 무게라 다수결과 같고, 동점이면 위에서
            먼저 고른 모델을 따릅니다.
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
  const failed = r.models.filter((m) => !m.ok).length;
  const footer = `묶음 투표 · ${r.asked}개 모델${failed ? ` (${failed}개 실패)` : ""} · 합계 입력 ${r.usage.total.in} / 출력 ${r.usage.total.out} 토큰`;
  const swaps = [
    ...new Set(
      (r.substitutions ?? []).map(
        (s) =>
          `\n주의: ${nameOf(s.requested)} 대신 ${s.servedBy ?? "다른 모델"}가 답했습니다.`,
      ),
    ),
  ].join("");
  return {
    text: `${text}\n\n—\n${footer}${r.warning ? `\n주의: ${r.warning}` : ""}${swaps}`,
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
  if (e.kind === "vote")
    return e.agree === e.voters
      ? `${e.voters}개 모델이 모두 같은 답`
      : `${e.voters}개 모델 중 ${e.agree}개가 같은 답`;
  if (e.kind === "merge")
    return `서술형이라 투표 없이 ${nameOf(e.writer)}가 ${e.models.filter((m) => m.ok).length}개 답을 합침`;
  return `${nameOf(e.writer)} 하나만 답함`;
}

export function EnsembleDetails({
  ensemble: e,
}: {
  ensemble: Message["ensemble"];
}) {
  if (!e || !Array.isArray(e.models)) return null;
  const failed = e.models.filter((m) => !m.ok).length;
  return (
    <details className="ensemble-details">
      <summary>
        <span className="ensemble-headline">{headline(e)}</span>
        {e.kind === "vote" && e.answer && (
          <span className="ensemble-answer">{e.answer}</span>
        )}
        {failed > 0 && (
          <span className="ensemble-muted">{failed}개는 답하지 못해 제외</span>
        )}
        <span className="ensemble-toggle">모델별 답</span>
      </summary>
      <ul>
        {e.models.map((m) => (
          <li
            key={m.model}
            className={m.ok ? (m.agreed ? "is-agreed" : "") : "is-failed"}
          >
            <div className="ensemble-row">
              <strong>{nameOf(m.model)}</strong>
              <span className="ensemble-pick">
                {!m.ok
                  ? `제외 · ${reasonNames[m.reason ?? ""] ?? "실패"}`
                  : e.kind === "merge"
                    ? m.model === e.writer
                      ? "합친 모델"
                      : "참고 답"
                    : m.answer || "정답 줄 없음"}
              </span>
              <span className="ensemble-meta">
                무게 {m.weight.toFixed(2)} · 입력 {m.usage.in} / 출력{" "}
                {m.usage.out}
              </span>
            </div>
            {m.text && (
              <details className="ensemble-reply">
                <summary>답 전체</summary>
                <div className="message-text">{m.text}</div>
              </details>
            )}
          </li>
        ))}
      </ul>
      <p className="ensemble-muted">
        합계 입력 {e.usage.total.in} / 출력 {e.usage.total.out} 토큰
        {e.kind === "vote" ? ` · 이긴 답의 무게 합 ${e.score}` : ""}
      </p>
    </details>
  );
}
