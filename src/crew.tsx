// The crew: the models that do the work. Each one carries the same small mark wherever it shows up
// (the roster, the work in progress, the line above an answer), so it is clear at a glance who did
// what. The colour only tells models apart; it says nothing about quality.
import React from "react";
import { t } from "./i18n";
import { leadRanking, modelById, modelReady, models, type ProviderStatus } from "./routing";

const HUES = 7;
const hueOf = (id: string) => {
  let h = 0;
  // Models of one family share a colour: hash the name up to its first digit or space.
  for (const c of (id.match(/^[a-z]+/i)?.[0] ?? id).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % HUES;
};

export function ModelToken({ id, title }: { id?: string | null; title?: string }) {
  const model = id ? modelById(id) : undefined;
  const name = model?.name ?? id ?? "";
  const letter = (name.match(/[A-Za-z0-9가-힣]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      className={`model-token hue-${model?.provider === "auto" ? "auto" : hueOf(id ?? "")}`}
      title={title ?? name}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/** The models that can answer right now with the keys present, strongest free ones first. */
export function readyCrew(status: ProviderStatus, order: string[]) {
  const ranked = leadRanking(order).map((m) => m.id);
  const rest = models.filter((m) => m.provider !== "auto" && !ranked.includes(m.id)).map((m) => m.id);
  return [...ranked, ...rest].filter((id) => modelReady(id, status)).map((id) => modelById(id));
}

/** Working as a team needs a second model: one answers, another checks or takes a part. */
export const TEAM_MIN = 2;

export function CrewRoster({
  status,
  order,
  onAdd,
}: {
  status: ProviderStatus;
  order: string[];
  onAdd?: () => void;
}) {
  const crew = readyCrew(status, order);
  if (!crew.length) return null;
  return (
    <div className="crew">
      <h2>{t("지금 일할 수 있는 모델 {n}개", { n: crew.length })}</h2>
      <ul>
        {crew.map((m) => (
          <li key={m.id}>
            <ModelToken id={m.id} />
            <span>{m.name}</span>
            {m.free && <small>{t("무료")}</small>}
          </li>
        ))}
      </ul>
      {crew.length < TEAM_MIN && (
        <p className="crew-short">
          {t("여러 모델이 함께 풀려면 {n}개 이상 필요합니다. 지금은 이 모델이 혼자 답합니다.", { n: TEAM_MIN })}
          {onAdd && (
            <button type="button" onClick={onAdd}>
              {t("모델 더 연결하기")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** The composer's model button when the app picks: the marks of the models it will draw on. */
export function CrewStack({ status, order }: { status: ProviderStatus; order: string[] }) {
  const crew = readyCrew(status, order).slice(0, 3);
  if (!crew.length) return <ModelToken id="auto-free" />;
  return (
    <span className="token-stack">
      {crew.map((m) => (
        <ModelToken key={m.id} id={m.id} />
      ))}
    </span>
  );
}
