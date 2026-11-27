// First run: there is nothing to answer with until a key is in. One box takes any provider's key;
// the app works out whose it is and checks it with that provider before saving.
import React, { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { t } from "./i18n";

const SOURCES: { host: "openrouter" | "groq" | "gemini" | "nvidia"; label: string; note: string }[] =
  [
    { host: "openrouter", label: "OpenRouter", note: "Nemotron Super" },
    { host: "groq", label: "Groq", note: "GPT-OSS 120B" },
    { host: "gemini", label: "Google AI Studio", note: "Gemini Flash" },
    { host: "nvidia", label: "NVIDIA", note: "Nemotron Super" },
  ];

export function KeySetup({ onAdded }: { onAdded: (message: string) => void }) {
  const bridge = window.auroraAI?.secrets;
  const web = !window.auroraAI?.code;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    if (!bridge?.add || !value.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await bridge.add(value);
      setValue("");
      onAdded(
        r.check === "ok"
          ? t("{provider} 키를 확인하고 저장했습니다.", { provider: r.provider })
          : t("{provider} 키를 저장했습니다. 이 회사는 미리 확인할 방법이 없어 첫 질문에서 확인됩니다.", {
              provider: r.provider,
            }),
      );
    } catch (e) {
      setError(
        String((e as Error)?.message ?? e).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="key-setup" aria-labelledby="key-setup-title">
      <KeyRound size={22} className="key-setup-icon" />
      <h1 id="key-setup-title">{t("API 키를 등록해 주세요")}</h1>
      <p>
        {t("질문에 답할 AI를 부르려면 키가 하나 필요합니다. 무료 키로 충분합니다.")}
      </p>
      <form
        className="key-paste"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          type="password"
          aria-label={t("API 키")}
          placeholder={t("키를 붙여 넣으세요")}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!value.trim() || busy}>
          {busy ? t("확인 중…") : t("등록")}
          {!busy && <ArrowRight size={15} />}
        </button>
      </form>
      {error ? (
        <p className="key-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="key-hint">
          {t("어느 회사 키인지는 알아서 알아봅니다. OpenAI·Anthropic 유료 키도 됩니다.")}
        </p>
      )}
      <div className="key-sources">
        <span>{t("무료 키 받기")}</span>
        {SOURCES.filter((s) => !(web && s.host === "nvidia")).map((s) => (
          <button key={s.host} type="button" onClick={() => void bridge?.openSignup(s.host)}>
            <strong>{s.label}</strong>
            <small>{s.note}</small>
          </button>
        ))}
      </div>
      <p className="key-where">
        {web
          ? t("키는 이 브라우저에만 저장되고, 질문할 때 브라우저에서 그 회사로 바로 갑니다.")
          : t("키는 이 기기의 키체인으로 암호화해 저장합니다.")}
      </p>
    </section>
  );
}
