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

export function CrewRoster({ status, order }: { status: ProviderStatus; order: string[] }) {
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
    </div>
  );
}
