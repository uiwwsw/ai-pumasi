// The ways of working the user can pick, named by what they cost rather than by which models run.
import React, { useEffect, useRef, useState } from "react";
import { Feather, Layers, Telescope, Check, SlidersHorizontal } from "lucide-react";
import { t } from "./i18n";
import type { Depth } from "./routing";

export const MODES: {
  id: Depth;
  name: () => string;
  about: () => string;
  Icon: typeof Feather;
  /** Not yet shown by measurement to be better than Pumasi mode. */
  beta?: boolean;
}[] = [
  {
    id: "light",
    name: () => t("가볍게"),
    about: () => t("빠른 모델 하나가 바로 답합니다. 토큰을 가장 적게 씁니다."),
    Icon: Feather,
  },
  {
    id: "auto",
    name: () => "Pumasi mode",
    about: () => t("질문을 보고 알아서 정합니다. 필요할 때만 여러 모델을 씁니다."),
    Icon: Layers,
  },
  {
    id: "deep",
    name: () => "Team",
    about: () => t("여러 모델이 각자 풀고 답을 맞춰 봅니다. 토큰을 많이 쓰고 오래 걸립니다."),
    Icon: Telescope,
    beta: true,
  },
];
export const modeOf = (depth: Depth) => MODES.find((m) => m.id === depth) ?? MODES[1];

/** The composer's mode button: a small menu of the three modes, and a way to the model list. */
export function ModePicker({
  depth,
  single,
  onPick,
  onModels,
}: {
  depth: Depth;
  /** The name of the one model the user chose in settings, if they did. */
  single?: string;
  onPick: (depth: Depth) => void;
  onModels: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = modeOf(depth);
  return (
    <div className="mode-picker" ref={box}>
      <button
        type="button"
        className="model-control"
        aria-haspopup="menu"
        aria-expanded={open}
        title={single ? t("모델 바꾸기") : current.about()}
        onClick={() => setOpen((v) => !v)}
      >
        {single ? <SlidersHorizontal size={14} /> : <current.Icon size={14} />}
        {single ?? current.name()}
        {!single && current.beta && <em className="beta-tag">Beta</em>}
      </button>
      {open && (
        <div className="mode-menu" role="menu">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={!single && m.id === depth}
              onClick={() => {
                onPick(m.id);
                setOpen(false);
              }}
            >
              <m.Icon size={16} />
              <span>
                <strong>
                  {m.name()}
                  {m.beta && <em className="beta-tag">Beta</em>}
                </strong>
                <small>{m.about()}</small>
              </span>
              {!single && m.id === depth && <Check size={15} />}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="mode-menu-models"
            onClick={() => {
              setOpen(false);
              onModels();
            }}
          >
            <SlidersHorizontal size={16} />
            <span>
              <strong>{single ? t("직접 고른 모델: {name}", { name: single }) : t("모델 직접 고르기")}</strong>
              <small>{t("설정에서 한 모델만 쓰도록 정할 수 있습니다.")}</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
