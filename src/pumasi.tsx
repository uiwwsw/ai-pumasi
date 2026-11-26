import React, { useEffect, useState } from "react";
import { t } from "./i18n";
import type {
  PumasiHost,
  PumasiState,
  PumasiSlot,
  PumasiProgress,
} from "./routing";
import { PUMASI_HOSTS } from "./routing";

const HOST_LABELS: Record<PumasiHost, string> = {
  nvidia: "NVIDIA",
  openrouter: "OpenRouter",
  groq: "Groq",
  google: "Gemini (Google AI Studio)",
};

export function PumasiPanel() {
  const bridge = window.auroraAI?.pumasi;
  const [state, setState] = useState<PumasiState | null>(null);
  const [slots, setSlots] = useState<PumasiSlot[]>([]);
  const [helping, setHelping] = useState(false);
  const [message, setMessage] = useState("");
  const [dailyCapValue, setDailyCapValue] = useState("");
  const [serverValue, setServerValue] = useState("");

  const fail = (e: unknown) =>
    setMessage(
      String((e as Error)?.message ?? e).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        "",
      ),
    );

  useEffect(() => {
    if (!bridge) return;
    bridge.state().then(setState).catch(fail);
    const unsub = bridge.onProgress((e: PumasiProgress) => {
      if (e.state === "claimed") {
        setMessage(t("맡았습니다. 올린 사람의 작업을 기다리는 중"));
      } else if (e.state === "working") {
        setMessage(t("작업 처리 중"));
      } else if (e.state === "done") {
        setMessage(t("완료 · 토큰 {tokens}개 · 점수가 쌓였습니다", { tokens: e.tokens ?? 0 }));
        bridge.state().then(setState).catch(fail);
        bridge.open().then(setSlots).catch(fail);
      }
    });
    return () => unsub();
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !state?.joined) return;
    bridge.open().then(setSlots).catch(fail);
  }, [bridge, state?.joined]);

  if (!bridge) {
    return (
      <p className="small-copy">
        {t("품앗이는 데스크톱 앱에서만 쓸 수 있습니다.")}
      </p>
    );
  }

  const handleJoin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = form.elements.namedItem("invite") as HTMLInputElement;
    if (!code.value.trim()) return;
    try {
      const res = await bridge.join(code.value.trim());
      setState(res);
      setMessage(t("가입했습니다."));
      form.reset();
    } catch (e) {
      fail(e);
    }
  };

  const handleDonateChange = async (host: PumasiHost, checked: boolean) => {
    try {
      const res = await bridge.update({
        donate: { ...state?.donate, [host]: checked },
      });
      setState(res);
    } catch (e) {
      fail(e);
    }
  };

  const handleDailyCapSave = async () => {
    const n = Number(dailyCapValue);
    if (!Number.isFinite(n) || n < 0) return;
    try {
      const res = await bridge.update({ dailyCap: n });
      setState(res);
      setMessage(t("저장했습니다."));
    } catch (e) {
      fail(e);
    }
  };

  const handleServerSave = async () => {
    try {
      const res = await bridge.update({ server: serverValue });
      setState(res);
      setMessage(t("저장했습니다."));
    } catch (e) {
      fail(e);
    }
  };

  const handleRefresh = async () => {
    try {
      const list = await bridge.open();
      setSlots(list);
    } catch (e) {
      fail(e);
    }
  };

  const handleHelp = async (slotId: string) => {
    if (helping) return;
    setHelping(true);
    try {
      await bridge.help(slotId);
      const [newState, newSlots] = await Promise.all([
        bridge.state(),
        bridge.open(),
      ]);
      setState(newState);
      setSlots(newSlots);
    } catch (e) {
      fail(e);
    } finally {
      setHelping(false);
    }
  };

  return (
    <section className="secret-settings pumasi-panel" aria-label={t("품앗이")}>
      <p className="small-copy">
        {t(
          "함께하기를 누르면 내 앱이 다른 사람 팀의 작업 모델 한 명이 되어, 내 키와 토큰으로 작업 하나를 처리하고 결과만 넘깁니다. 작업 글과 결과는 암호화되어 이 화면에도 보이지 않습니다.",
        )}
      </p>

      {state?.error && (
        <p className="secret-warning" role="alert">
          {state.error}
        </p>
      )}

      {state?.me && (
        <p className="small-copy">
          {t("점수 {credits} · 도운 작업 {helped}개 · 쓴 토큰 {used}", state.me)}
        </p>
      )}

      {state?.joined && (
        <>
          <h4>{t("도움을 기다리는 작업")}</h4>
          <div className="secret-row">
            <div className="secret-form">
              <button type="button" onClick={handleRefresh}>
                {t("새로고침")}
              </button>
            </div>
          </div>
          {slots.length === 0 ? (
            <p className="small-copy">
              {t("지금 도움을 기다리는 작업이 없습니다.")}
            </p>
          ) : (
            slots.map((slot) => (
              <div className="secret-row" key={slot.slotId}>
                <div className="secret-head">
                  <span>
                    {t("작업 · 약 {chars}자 · {min}분 전", {
                      chars: slot.size,
                      min: Math.max(0, Math.round((Date.now() - slot.postedAt) / 60000)),
                    })}
                  </span>
                </div>
                <div className="secret-actions">
                  <button
                    type="button"
                    disabled={helping}
                    onClick={() => handleHelp(slot.slotId)}
                  >
                    {t("함께하기")}
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {!state?.joined && (
        <form className="secret-row" onSubmit={handleJoin}>
          <label className="secret-head" htmlFor="invite">
            <strong>{t("초대 코드")}</strong>
          </label>
          <div className="secret-form">
            <input
              id="invite"
              name="invite"
              type="text"
              placeholder={t("초대 코드")}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button type="submit">{t("가입")}</button>
          </div>
        </form>
      )}

      <h4>{t("빌려줄 무료 키")}</h4>
      <p className="small-copy">
        {t(
          "유료 키는 빌려주지 않습니다. 제공자 약관이 다른 사람의 요청 처리를 허용하는지 확인한 뒤 켜세요.",
        )}
      </p>
      {state && (
        <>
          {PUMASI_HOSTS.map((host) => (
            <div className="secret-row" key={host}>
              <div className="secret-head">
                <label>
                  <input
                    type="checkbox"
                    checked={state.donate[host] === true}
                    onChange={(e) => handleDonateChange(host, e.target.checked)}
                    disabled={!state.keys[host]}
                  />
                  <strong>{HOST_LABELS[host]}</strong>
                </label>
                {!state.keys[host] && <small>{t("키 없음")}</small>}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="secret-row">
        <label className="secret-head" htmlFor="daily-cap">
          <strong>{t("하루 기부 한도 (토큰)")}</strong>
        </label>
        <div className="secret-form">
          <input
            id="daily-cap"
            type="number"
            min="0"
            value={dailyCapValue}
            onChange={(e) => setDailyCapValue(e.target.value)}
            placeholder={state?.dailyCap.toString() ?? ""}
          />
          <button type="button" onClick={handleDailyCapSave}>
            {t("저장")}
          </button>
        </div>
      </div>
      {state && (
        <p className="small-copy">
          {t("오늘 {used} / {cap} 토큰", {
            used: state.usedToday,
            cap: state.dailyCap,
          })}
        </p>
      )}

      <div className="secret-row">
        <label className="secret-head" htmlFor="pumasi-server">
          <strong>{t("품앗이 서버")}</strong>
        </label>
        <div className="secret-form">
          <input
            id="pumasi-server"
            type="text"
            value={serverValue}
            onChange={(e) => setServerValue(e.target.value)}
            placeholder={state?.server ?? ""}
          />
          <button type="button" onClick={handleServerSave}>
            {t("저장")}
          </button>
        </div>
      </div>

      {message && (
        <p className="small-copy" role="status">
          {message}
        </p>
      )}
    </section>
  );
}