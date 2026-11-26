// Settings section for API keys. Write-only: a saved key is never read back into the window.
import React, { useEffect, useState } from "react";
import { t } from "./i18n";
import type {
  FreeHost,
  ProviderStatus,
  SecretName,
  SecretsState,
} from "./routing";

type Signup = FreeHost | "gemini" | "openai" | "anthropic";
type Row = {
  name: SecretName;
  label: string;
  hint: string;
  /** What this key unlocks, in plain words. */
  gives: string;
  signup?: Signup;
  envFlag?: (s: ProviderStatus) => boolean;
};
const FREE: Row[] = [
  {
    name: "NVIDIA_API_KEY",
    label: "NVIDIA",
    hint: t("nvapi-로 시작"),
    gives: t("Nemotron Super·Ultra·Lightning 무료"),
    signup: "nvidia",
    envFlag: (s) => !!s.hosts?.nvidia,
  },
  {
    name: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    hint: t("sk-or-로 시작"),
    gives: t("Nemotron 무료 예비 경로"),
    signup: "openrouter",
    envFlag: (s) => !!s.hosts?.openrouter,
  },
  {
    name: "GROQ_API_KEY",
    label: "Groq",
    hint: t("gsk_로 시작"),
    gives: t("GPT-OSS 120B 무료"),
    signup: "groq",
    envFlag: (s) => !!s.hosts?.groq,
  },
  {
    name: "GEMINI_API_KEY",
    label: "Gemini (Google AI Studio)",
    hint: t("AIza로 시작"),
    gives: t("Gemini Flash·Flash Lite 무료 한도"),
    signup: "gemini",
    envFlag: (s) => s.gemini,
  },
];
const PAID: Row[] = [
  {
    name: "OPENAI_API_KEY",
    label: "OpenAI",
    hint: t("sk-로 시작"),
    gives: t("GPT 모델 (유료)"),
    signup: "openai",
    envFlag: (s) => s.openai,
  },
  {
    name: "ANTHROPIC_API_KEY",
    label: "Claude (Anthropic)",
    hint: t("sk-ant-로 시작"),
    gives: t("Claude 모델 (유료)"),
    signup: "anthropic",
    envFlag: (s) => s.anthropic,
  },
];
const CUSTOM: Row = {
  name: "AURORA_OPENAI_COMPAT_KEY",
  label: t("직접 넣은 서버"),
  hint: t("서버에서 받은 키"),
  gives: t("아래 주소의 OpenAI 호환 서버"),
};

const day = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : t("{month}월 {day}일 저장", {
        month: d.getMonth() + 1,
        day: d.getDate(),
      });
};

export function SecretSettings({
  status,
  onChanged,
}: {
  status: ProviderStatus;
  onChanged: () => void;
}) {
  const bridge = window.auroraAI?.secrets;
  const [state, setState] = useState<SecretsState | null>(null);
  const [editing, setEditing] = useState<SecretName | null>(null);
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    bridge
      ?.list()
      .then((s) => {
        setState(s);
        setUrl(s.compatUrl);
      })
      .catch(() => setMessage(t("키 상태를 읽지 못했습니다.")));
  }, []);

  if (!bridge) {
    return (
      <p className="small-copy">
        {t("API 키는 데스크톱 앱에서만 저장할 수 있습니다.")}{" "}
        {t("웹 데모에서는 키를 받지 않습니다.")}
      </p>
    );
  }

  const done = (s: SecretsState, text: string) => {
    setState(s);
    setUrl(s.compatUrl);
    setMessage(text);
    onChanged();
  };
  const fail = (e: unknown) =>
    setMessage(
      String((e as Error)?.message ?? e).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        "",
      ),
    );

  const save = async (name: SecretName, label: string) => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      done(
        await bridge.set(name, draft),
        t("{label} 키를 암호화해 저장했습니다.", { label }),
      );
      setEditing(null);
    } catch (e) {
      fail(e);
    } finally {
      // The typed key does not stay in the window after the attempt.
      setDraft("");
      setSaving(false);
    }
  };
  const remove = async (name: SecretName, label: string) => {
    try {
      done(await bridge.remove(name), t("{label} 키를 지웠습니다.", { label }));
    } catch (e) {
      fail(e);
    }
  };
  const saveUrl = async () => {
    try {
      const before = state?.keys.AURORA_OPENAI_COMPAT_KEY.set;
      const s = await bridge.setCompatUrl(url);
      done(
        s,
        before && !s.keys.AURORA_OPENAI_COMPAT_KEY.set
          ? t(
              "주소가 바뀌어 저장된 호환 서버 키를 지웠습니다. 새 주소의 키를 다시 넣으세요.",
            )
          : t("호환 서버 주소를 저장했습니다."),
      );
    } catch (e) {
      fail(e);
    }
  };

  const renderRow = (row: Row) => {
    const saved = state?.keys[row.name];
    const fromEnv = !saved?.set && !!row.envFlag?.(status);
    const label = saved?.set
      ? t("저장됨 · {date}", { date: day(saved.savedAt) })
      : saved?.stale
        ? t("저장된 키를 열 수 없어 다시 넣어야 합니다")
        : fromEnv
          ? t("환경 변수에서 사용 중")
          : t("없음");
    return (
      <div className="secret-row" key={row.name}>
        <div className="secret-head">
          <strong>{row.label}</strong>
          <small>{row.gives}</small>
          <small className={saved?.set ? "on" : ""}>{label}</small>
        </div>
        {editing === row.name ? (
          <form
            className="secret-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(row.name, row.label);
            }}
          >
            <input
              type="password"
              aria-label={t("{label} API 키", { label: row.label })}
              placeholder={row.hint}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              disabled={!draft.trim() || saving || state?.encryption === false}
            >
              {t("저장")}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setDraft("");
                setEditing(null);
              }}
            >
              {t("취소")}
            </button>
          </form>
        ) : (
          <div className="secret-actions">
            <button
              type="button"
              disabled={state?.encryption === false}
              onClick={() => {
                setDraft("");
                setMessage("");
                setEditing(row.name);
              }}
            >
              {saved?.set ? t("바꾸기") : t("키 넣기")}
            </button>
            {saved?.set ? (
              <button
                type="button"
                className="quiet"
                onClick={() => void remove(row.name, row.label)}
              >
                {t("지우기")}
              </button>
            ) : (
              row.signup && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    void bridge.openSignup(row.signup!).catch(fail)
                  }
                >
                  {t("키 받기")}
                </button>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="secret-settings" aria-label={t("API 키")}>
      <h3>{t("API 키")}</h3>
      <p className="small-copy">
        {t(
          "키는 이 기기의 키체인으로 암호화해 저장하고, 모델을 부를 때만 앱 내부에서 꺼내 씁니다.",
        )}{" "}
        {t(
          "저장한 키는 화면에 다시 보이지 않고, 모델에게 보내는 글이나 기록에도 들어가지 않습니다.",
        )}
      </p>
      {state && !state.encryption && (
        <p className="secret-warning" role="alert">
          {t(
            "이 기기에서는 키 암호화를 쓸 수 없어 키를 저장하지 않습니다. 환경 변수로 넣어 주세요.",
          )}
        </p>
      )}
      <h4>{t("무료 모델 제공자")}</h4>
      <p className="small-copy">
        {t("키를 하나 이상 넣으면 무료 모델을 쓸 수 있습니다.")}{" "}
        {t(
          "같은 모델을 여러 곳에서 주면, 한 곳이 한도에 걸렸을 때 앱이 알아서 다른 곳으로 넘깁니다.",
        )}{" "}
        {t("키는 각 회사에서 무료로 받습니다.")}
      </p>
      {FREE.map(renderRow)}
      <h4>{t("유료 모델")}</h4>
      {PAID.map(renderRow)}
      <h4>{t("직접 넣은 서버")}</h4>
      {renderRow(CUSTOM)}
      <form
        className="secret-row secret-url"
        onSubmit={(e) => {
          e.preventDefault();
          void saveUrl();
        }}
      >
        <label className="secret-head" htmlFor="compat-url">
          <strong>{t("OpenAI 호환 서버 주소")}</strong>
          <small>
            {t(
              "예: OpenRouter, NVIDIA. 주소를 바꾸면 저장된 호환 서버 키는 지워집니다.",
            )}
          </small>
        </label>
        <div className="secret-form">
          <input
            id="compat-url"
            type="url"
            placeholder="https://…/v1/chat/completions"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" disabled={url === (state?.compatUrl ?? "")}>
            {t("저장")}
          </button>
        </div>
      </form>
      {message && (
        <p className="small-copy" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
