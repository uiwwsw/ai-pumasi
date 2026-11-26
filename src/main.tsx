import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Folder,
  Layers,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  Bundle,
  Chat,
  LEGACY_KEY,
  Proposal,
  STORAGE_KEY,
  Tier,
  Workspace,
  activeContext,
  makePreview,
  organize,
  propose,
  restoreWorkspace,
  tierNames,
} from "./domain";
import {
  models,
  modelById,
  leadRanking,
  presets,
  readRouting,
  ROUTING_KEY,
  type RoutingSettings,
  type ProviderStatus,
  modelReady,
  type TeamResult,
  type Analysis,
  type Completion,
} from "./routing";
import {
  EnsembleDetails,
  EnsembleSettings,
  bundleReady,
  ensembleMessage,
} from "./ensemble";
import { SecretSettings } from "./secrets";
import { PumasiPanel } from "./pumasi";
import { CodeWorkspace } from "./code-view";
import { appName, getLang, setLang, t, type Lang } from "./i18n";
import {
  project,
  projectTeam,
  type Projection,
  type StageLine,
  type UsageHistory,
} from "./usage";
import "./style.css";
function readSaved(): Workspace {
  try {
    return restoreWorkspace(
      localStorage.getItem(STORAGE_KEY),
      localStorage.getItem(LEGACY_KEY),
    );
  } catch {
    return restoreWorkspace(null, null);
  }
}
const range = (numbers: [number, number]) =>
  numbers.map((n) => Math.ceil(n).toLocaleString()).join("–");
const percentage = (numbers: [number, number]) =>
  numbers.map((n) => (n < 0.1 ? "<0.1" : n.toFixed(1))).join("–") + "%";
const statusNames = {
  active: t("진행 중"),
  grouped: t("묶음"),
  archived: t("보관"),
  trashed: t("휴지통"),
};
type Pending = {
  text: string;
  modelId: string;
  analysis?: Analysis;
  selected: Tier;
  proposal: Proposal | null;
  decision: "grouped" | "archived" | "trashed" | "continue" | null;
};
const stageNames: Record<StageLine["kind"], string> = {
  execute: t("실행"),
  analyze: t("분석"),
  plan: t("계획"),
  work: t("작업"),
  review: t("검토"),
  merge: t("합치기"),
};
const calls = ([a, b]: [number, number]) =>
  a === b ? t("{a}회", { a }) : t("{a}–{b}회", { a, b });
/** Where a number came from: the user's own past responses or the fixed tier assumption. */
function basisText(p: Projection): string {
  if (p.basis === "history")
    return p.stages.length > 1
      ? t("단계별 실제 기록 {samples}건 기준", {
          samples: p.samples.toLocaleString(),
        })
      : t("이 모델의 실제 기록 {samples}건 기준", {
          samples: p.samples.toLocaleString(),
        });
  if (p.basis === "mixed") {
    const known = p.stages.filter((s) => s.samples > 0).length;
    return t("단계 {total}개 중 {known}개는 실제 기록, 나머지는 기본 가정", {
      total: p.stages.length,
      known,
    });
  }
  return p.stages.length > 1
    ? t(
        "기본 가정 · 단계별로 같은 모델 기록이 5건 모이면 실제 사용량으로 바뀝니다",
      )
    : t("기본 가정 · 같은 모델 기록이 5건 모이면 실제 사용량으로 바뀝니다");
}
type WorkerRow = {
  taskId: string;
  title?: string;
  state:
    | "waiting"
    | "running"
    | "retry"
    | "switch"
    | "substituted"
    | "done"
    | "failed"
    | "stopped";
  model?: string;
  startedAt?: number;
  attempt?: number;
  reason?: string;
  servedBy?: string;
  note?: string;
  from?: string;
  timeoutMs?: number;
  partial?: boolean;
};

function workerLabel(w: WorkerRow): string {
  const model = w.model ? modelById(w.model).name : w.taskId;
  const getReason = () => {
    switch (w.reason) {
      case "timeout":
        return t("시간 초과");
      case "rate-limit":
        return t("무료 한도");
      case "server":
        return t("서버 오류");
      case "network":
        return t("연결 실패");
      case "error":
        return t("오류");
      case "empty":
        return t("빈 답");
      case "short":
        return t("너무 짧은 답");
      case "truncated":
        return t("답이 잘림");
      default:
        return "";
    }
  };
  if (w.state === "waiting") return t("대기");
  if (w.state === "running") {
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - (w.startedAt ?? Date.now())) / 1000),
    );
    let txt = t("{model} · {elapsed}초째", { model, elapsed });
    if (w.attempt === 2) txt += t(" · 재시도");
    if (w.timeoutMs && elapsed > w.timeoutMs / 2000) txt += t(" · 느림");
    return txt;
  }
  if (w.state === "retry") return t("{model} 다시 시키는 중 · {reason}", { model, reason: getReason() });
  if (w.state === "switch")
    return t("{from} → {model}로 교체", {
      from: w.from ? modelById(w.from).name : t("모델"),
      model,
    });
  if (w.state === "substituted")
    return t("{model} 요청, {servedBy}가 답함", {
      model,
      servedBy: w.servedBy ?? t("다른 모델"),
    });
  if (w.state === "done") {
    const txt = w.partial
      ? t("일부만 받음 · {model}", { model })
      : t("완료 · {model}", { model });
    return w.servedBy
      ? t("{txt} · {servedBy}가 대신 답함", { txt, servedBy: w.servedBy })
      : txt;
  }
  if (w.state === "failed") return t("실패 · {reason}", { reason: getReason() });
  if (w.state === "stopped") return t("답이 이미 정해져 기다리지 않음");
  return model;
}

function App() {
  const [workspace, setWorkspace] = useState(readSaved);
  const [legacyId, setLegacyId] = useState<string | null>(
    () => readSaved().legacyChats[0]?.id ?? null,
  );
  const [draft, setDraft] = useState("");
  const [routing, setRouting] = useState<RoutingSettings>(() => {
    try {
      return readRouting(localStorage.getItem(ROUTING_KEY));
    } catch {
      return readRouting(null);
    }
  });
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    openai: false,
    anthropic: false,
    gemini: false,
    ollama: false,
    compat: false,
    auto: false,
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [aiError, setAIError] = useState("");
  const refreshStatus = () =>
    window.auroraAI
      ?.status()
      .then(setProviderStatus)
      .catch(() => setAIError(t("API 키 설정 상태를 확인하지 못했습니다.")));
  useEffect(() => {
    void refreshStatus();
    void window.auroraAI?.setLang?.(getLang());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(ROUTING_KEY, JSON.stringify(routing));
    } catch {
      setAIError(t("모델 설정을 저장하지 못했습니다."));
    }
  }, [routing]);
  const [pending, setPending] = useState<Pending | null>(null);
  // Past token counts from the main process; null outside Electron or before the first read.
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const refreshHistory = () =>
    window.auroraAI?.usage
      ?.get()
      .then(setHistory)
      .catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);
  const teamRun = routing.live && routing.team;
  function forecast(
    text: string,
    ctx: Chat["messages"],
    modelId: string,
  ): Projection {
    return teamRun
      ? projectTeam(
          text,
          ctx,
          workspace.budget,
          modelById(routing.lead),
          modelById(routing.worker),
          history,
        )
      : project(text, ctx, workspace.budget, modelById(modelId), history);
  }
  const [sidebar, setSidebar] = useState(
    () => !window.matchMedia("(max-width: 680px)").matches,
  );
  const [usageOpen, setUsageOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const collapse = () => {
      if (media.matches) {
        setSidebar(false);
        setUsageOpen(false);
      }
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, []);
  const [dialog, setDialog] = useState<
    "search" | "settings" | "pumasi" | null
  >(null);
  // Chat: questions and answers. Code: work on files in one folder (beta).
  const [appMode, setAppMode] = useState<"chat" | "code">(() => {
    try {
      return localStorage.getItem("aurora.mode") === "code" ? "code" : "chat";
    } catch {
      return "chat";
    }
  });
  const switchAppMode = (m: "chat" | "code") => {
    setAppMode(m);
    try {
      localStorage.setItem("aurora.mode", m);
    } catch {}
  };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"current" | "archived" | "trashed">(
    "current",
  );
  const [theme, setTheme] = useState("light");
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const [workers, setWorkers] = useState<Record<string, WorkerRow>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (busy && Object.values(workers).some((w) => w.state === "running")) {
      const id = setTimeout(() => {
        setTick((t) => t + 1);
      }, 1000);
      return () => clearTimeout(id);
    }
  }, [busy, workers, tick]);
  const boardRef = useRef<HTMLOListElement>(null);
  const workerCount = Object.keys(workers).length;
  useEffect(() => {
    // Bring the in-dialog board into view once when tasks appear, not on every tick.
    if (busy && workerCount)
      boardRef.current?.scrollIntoView({ block: "nearest" });
  }, [busy, workerCount]);
  // Shown in the main view and, while a run is in progress, inside the confirm dialog that covers it.
  const workerBoard = (extra = "") =>
    Object.keys(workers).length > 0 && (
      <ol
        ref={extra ? boardRef : undefined}
        className={`worker-board${extra}`}
        aria-label={t("작업 진행 상황")}
        aria-live="polite"
      >
        {Object.values(workers).map((w) => (
          <li key={w.taskId} className={`worker-row is-${w.state}`}>
            <span className="worker-title">{w.title ?? w.taskId}</span>
            <span className="worker-state">{workerLabel(w)}</span>
          </li>
        ))}
      </ol>
    );
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const auto = workspace.mode === "auto";
  const legacyChat = workspace.legacyChats.find((c) => c.id === legacyId);
  const visible = workspace.bundles.filter((b) =>
    filter === "current"
      ? b.status === "active" || b.status === "grouped"
      : b.status === filter,
  );
  const messages = auto
    ? visible.flatMap((b) => b.messages)
    : (legacyChat?.messages ?? []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    try {
      if (workspace.save)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_KEY);
      }
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [workspace]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (busyRef.current) return;
      if (e.key === "Escape") {
        setDialog(null);
        setPending(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setDialog("search");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!dialog && !pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    modal?.querySelector<HTMLElement>("input,select,button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modal) return;
      const controls = [
        ...modal.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [dialog, !!pending]);
  function context(decision: Pending["decision"] = null) {
    return auto
      ? activeContext(
          decision && decision !== "continue"
            ? workspace.bundles.filter(
                (b) => b.id !== pending?.proposal?.bundleId,
              )
            : workspace.bundles,
        )
      : (legacyChat?.messages ?? []);
  }
  function review() {
    const text = draft.trim();
    if (!text || pending) return;
    const suggestion = auto ? propose(workspace.bundles, text) : null;
    setAIError("");
    const initial = modelById(routing.executor);
    setPending({
      text,
      modelId: initial.id,
      selected: initial.tier,
      proposal: suggestion,
      decision: suggestion ? null : "continue",
    });
  }
  function chooseDecision(decision: Pending["decision"]) {
    if (!pending) return;
    setPending({ ...pending, decision });
  }
  async function analyze() {
    if (!pending || busyRef.current || !window.auroraAI) return;
    busyRef.current = true;
    setBusy(true);
    setAIError("");
    try {
      const result = (await window.auroraAI.request({
        action: "analyze",
        model: routing.analyzer,
        text: pending.text,
        context: context(pending.decision),
        maxOutputTokens: 2048,
      })) as Analysis;
      setPending((p) => (p ? { ...p, analysis: result } : p));
      setNotice(
        t("내부 분석 · {model} · 입력 {input} / 출력 {output} 토큰 사용", {
          model: modelById(result.model).name,
          input: result.inputTokens ?? t("미확인"),
          output: result.outputTokens ?? t("미확인"),
        }),
      );
    } catch (error) {
      setAIError(
        error instanceof Error ? error.message : t("내부 분석에 실패했습니다."),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      refreshHistory();
    }
  }
  async function proceed() {
    if (!pending || !pending.decision || busyRef.current) return;
    const p = pending;
    let completion: Completion | null = null;
    let team: TeamResult | null = null;
    let bundle: ReturnType<typeof ensembleMessage> | null = null;
    if (
      routing.live &&
      bundleReady(routing, providerStatus) &&
      window.auroraAI?.ensemble
    ) {
      busyRef.current = true;
      setBusy(true);
      setAIError("");
      setWorkers({});
      const picked = routing.ensembleModels.filter((id) =>
        modelReady(id, providerStatus),
      );
      setNotice(t("묶음 투표 · {count}개 모델에 동시에 묻는 중", { count: picked.length }));
      const off = window.auroraAI.onTeamProgress?.((e) => {
        if (e.stage === "worker")
          setWorkers((prev) => ({
            ...prev,
            [e.taskId]: {
              ...prev[e.taskId],
              ...(e.state === "running"
                ? { servedBy: undefined, reason: undefined, partial: undefined }
                : {}),
              ...e,
            },
          }));
        else if (e.stage === "merge" && e.model)
          setNotice(t("묶음 투표 · {model}가 답을 합치는 중", { model: modelById(e.model).name }));
        else if (e.stage === "done") setNotice(t("묶음 투표 · 완료"));
      });
      try {
        const r = await window.auroraAI.ensemble({
          models: picked,
          text: p.text,
          context: context(p.decision),
        });
        bundle = ensembleMessage(r);
        setNotice(t("묶음 투표 · 완료"));
        completion = {
          text: bundle.text,
          model: r.writer,
          inputTokens: r.usage.total.in,
          outputTokens: r.usage.total.out,
          incomplete: false,
        };
      } catch (error) {
        setAIError(
          error instanceof Error
            ? error.message
            : t("묶음 투표 실행에 실패했습니다."),
        );
        return;
      } finally {
        off?.();
        busyRef.current = false;
        setBusy(false);
      }
    } else if (routing.live && routing.team && window.auroraAI?.team) {
      busyRef.current = true;
      setBusy(true);
      setAIError("");
      setWorkers({});
      const off = window.auroraAI.onTeamProgress?.((e) => {
        if (e.stage === "worker") {
          setWorkers((prev) => ({
            ...prev,
            // A fresh attempt starts clean: no stale reason or substitute from the last one.
            [e.taskId]: {
              ...prev[e.taskId],
              ...(e.state === "running"
                ? { servedBy: undefined, reason: undefined, partial: undefined }
                : {}),
              ...e,
            },
          }));
          return;
        }
        if (e.stage === "pumasi") {
          setNotice(
            t("팀 모드 · 품앗이 {done}/{total} 완료 · 돕는 중 {working} · 기다리는 자리 {open}", e),
          );
          return;
        }
        setNotice(
          e.stage === "plan"
            ? t("팀 모드 · {lead}가 작업을 나누는 중", { lead: modelById(routing.lead).name })
            : e.stage === "work"
              ? t("팀 모드 · {round}회차 {index}/{total} · {worker}: {title}", {
                  round: e.round ?? 0,
                  index: e.index ?? 0,
                  total: e.total ?? 0,
                  worker: modelById(routing.worker).name,
                  title: e.title ?? "",
                })
              : e.stage === "review"
                ? t("팀 모드 · {lead}가 {round}회차 결과 검수 중", {
                    lead: modelById(routing.lead).name,
                    round: e.round ?? 0,
                  })
                : e.stage === "merge"
                  ? t("팀 모드 · {worker}가 결과를 합치는 중", {
                      worker: modelById(routing.worker).name,
                    })
                  : t("팀 모드 · 완료"),
        );
      });
      try {
        team = await window.auroraAI.team({
          lead: routing.lead,
          worker: routing.worker,
          text: p.text,
          context: context(p.decision),
          pumasi: routing.pumasi ? { copies: routing.pumasiCopies } : undefined,
          leadOrder: routing.lead === "auto-free" ? routing.leadOrder : undefined,
        });
        completion = {
          text: t(
            "{text}\n\n—\n팀 모드 · 총괄 {lead} 입력 {leadIn} / 출력 {leadOut} · 작업 {workers} 입력 {workerIn} / 출력 {workerOut} 토큰 · 작업 {taskCount}개 · {rounds}회차{pumasi}{approved}{failed}{incomplete}{warning}{substitutions}",
            {
              text: team.text,
              lead: team.leadModel
                ? (models.find((m) => m.id === team!.leadModel)?.name ?? team.leadModel)
                : modelById(team.lead).name,
              leadIn: team.usage.lead.in,
              leadOut: team.usage.lead.out,
              workers:
                (team.workersUsed.map((id) => modelById(id).name).join(", ") ||
                  modelById(team.worker).name) ?? "",
              workerIn: team.usage.worker.in,
              workerOut: team.usage.worker.out,
              taskCount: team.tasks.length,
              rounds: team.rounds,
              pumasi: team.pumasiTasks
                ? t(" · 품앗이로 받은 작업 {count}개", { count: team.pumasiTasks })
                : "",
              approved:
                (team.approved ? t(" · 총괄 모델 승인") : "") +
                (team.secondOpinion
                  ? t(" · 확신이 없어 {name}이(가) 한 번 더 확인", {
                      name:
                        models.find((m) => m.id === team!.secondOpinion!.model)?.name ??
                        team.secondOpinion.model,
                    })
                  : ""),
              failed: team.tasks.some((t) => t.failed)
                ? t(" · 실패 작업 {count}개", {
                    count: team.tasks.filter((t) => t.failed).length,
                  })
                : "",
              incomplete: team.tasks.some((t) => t.incomplete)
                ? t(" · 일부 작업 출력 상한 도달")
                : "",
              warning: team.warning ? t("\n주의: {warning}", { warning: team.warning }) : "",
              substitutions: [...new Set((team.substitutions ?? []).map((s) =>
                t("\n주의: {requested} 대신 {servedBy}가 답했습니다.", {
                  requested: modelById(s.requested).name,
                  servedBy: s.servedBy ?? t("다른 모델"),
                })
              ))].join(""),
            },
          ),
          model: team.lead,
          inputTokens: team.usage.lead.in + team.usage.worker.in,
          outputTokens: team.usage.lead.out + team.usage.worker.out,
          incomplete: false,
        };
      } catch (error) {
        setAIError(
          error instanceof Error
            ? error.message
            : t("팀 모드 실행에 실패했습니다."),
        );
        return;
      } finally {
        off?.();
        busyRef.current = false;
        setBusy(false);
        refreshHistory();
      }
    } else if (routing.live) {
      if (!window.auroraAI) {
        setAIError(t("Electron 앱에서 실행해 주세요."));
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setAIError("");
      try {
        completion = await window.auroraAI.request({
          action: "execute",
          model: p.modelId,
          text: p.text,
          context: context(p.decision),
          maxOutputTokens: 4096,
        });
      } catch (error) {
        setAIError(
          error instanceof Error ? error.message : t("API 실행에 실패했습니다."),
        );
        return;
      } finally {
        busyRef.current = false;
        setBusy(false);
        refreshHistory();
      }
    }
    const next = [
      { id: crypto.randomUUID(), role: "user" as const, text: p.text },
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        text:
          team || bundle
            ? completion!.text
            : completion
              ? t(
                  "{text}\n\n—\n{model} · 실제 입력 {input} / 출력 {output} 토큰{incomplete}",
                  {
                    text: completion.text,
                    model: modelById(p.modelId).name,
                    input: completion.inputTokens ?? t("미확인"),
                    output: completion.outputTokens ?? t("미확인"),
                    incomplete: completion.incomplete
                      ? t(" · 생성 상한 도달: 미완성일 수 있음")
                      : "",
                  },
                )
              : t("{preview}\n선택한 실행 모델: {model}", {
                  preview: makePreview(p.text, p.selected),
                  model: modelById(p.modelId).name,
                }),
        live: !!completion,
        model: bundle?.model ?? p.modelId,
        ...(bundle ? { ensemble: bundle.ensemble } : {}),
      },
    ];
    const newId = crypto.randomUUID();
    setWorkspace((w) => {
      if (w.mode === "legacy") {
        const found = w.legacyChats.some((c) => c.id === legacyId);
        return {
          ...w,
          legacyChats: found
            ? w.legacyChats.map((c) =>
                c.id === legacyId
                  ? {
                      ...c,
                      messages: [...c.messages, ...next],
                      tier: p.selected,
                    }
                  : c,
              )
            : [
                ...w.legacyChats,
                {
                  id: newId,
                  title: p.text.slice(0, 38),
                  messages: next,
                  tier: p.selected,
                },
              ],
        };
      }
      const organized =
        p.proposal && p.decision !== "continue"
          ? organize(
              w.bundles,
              p.proposal.bundleId,
              p.decision as "grouped" | "archived" | "trashed",
            )
          : w.bundles;
      const current = organized.findLast((b) => b.status === "active");
      return {
        ...w,
        bundles: current
          ? organized.map((b) =>
              b.id === current.id
                ? { ...b, messages: [...b.messages, ...next], tier: p.selected }
                : b,
            )
          : [
              ...organized,
              {
                id: newId,
                title: p.text.slice(0, 38),
                messages: next,
                tier: p.selected,
                status: "active",
              },
            ],
      };
    });
    if (!auto && !legacyChat) setLegacyId(newId);
    if (p.proposal && p.decision !== "continue")
      setNotice(
        p.decision === "trashed"
          ? t("이전 작업을 휴지통으로 옮겼습니다. 복원할 수 있습니다.")
          : t("이전 작업을 정리했습니다. 대화 흐름은 계속 이어집니다."),
      );
    setFilter("current");
    setDraft("");
    setPending(null);
    input.current?.focus();
  }
  function switchMode(mode: Workspace["mode"]) {
    setWorkspace((w) => ({ ...w, mode }));
    setPending(null);
    setFilter("current");
    setNotice(
      mode === "legacy"
        ? t("레거시 모드: 직접 세션을 관리합니다. 자동 정리는 꺼집니다.")
        : t("자동 정리 모드: 하나의 대화 흐름을 이어갑니다."),
    );
  }
  function jump(id: string) {
    setFilter("current");
    setDialog(null);
    requestAnimationFrame(() =>
      document
        .getElementById(`bundle-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  function restore(id: string) {
    setWorkspace((w) => ({
      ...w,
      bundles: w.bundles.map((b) =>
        b.id === id ? { ...b, status: "grouped" } : b,
      ),
    }));
    setNotice(
      t("작업 묶음을 복원했습니다. 새 요청의 문맥에는 자동 포함하지 않습니다."),
    );
  }
  const preview = draft.trim()
    ? forecast(draft, context(), routing.executor)
    : null;
  const planned = pending
    ? forecast(pending.text, context(pending.decision), pending.modelId)
    : null;
  const sideItems: Chat[] = auto ? visible : workspace.legacyChats;
  return (
    <div
      className={`app ${sidebar ? "" : "sidebar-closed"} ${usageOpen ? "" : "usage-closed"}`}
    >
      <aside className="sidebar" aria-label={t("사이드바")}>
        <div className="window-space" />
        <div className="brand">
          <span className="brand-mark">
            품<span>✦</span>
          </span>
          <strong>{appName()}</strong>
          <button
            className="icon-button"
            aria-label={t("사이드바 접기")}
            onClick={() => setSidebar(false)}
          >
            <PanelLeft size={17} />
          </button>
        </div>
        <nav className="primary-nav">
          {auto ? (
            <button
              className="nav-item selected"
              onClick={() => {
                setFilter("current");
                input.current?.focus();
              }}
            >
              <Sparkles size={17} />
              <span>{t("하나의 대화")}</span>
              <span className="sample-tag">AUTO</span>
            </button>
          ) : (
            <button
              className="nav-item selected"
              onClick={() => {
                setLegacyId(null);
                setDraft("");
              }}
            >
              <Plus size={17} />
              <span>{t("새 세션")}</span>
            </button>
          )}
          <button
            className="nav-item"
            aria-label={t("대화 검색")}
            onClick={() => setDialog("search")}
          >
            <Search size={17} />
            <span>{t("대화 검색")}</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="nav-item"
            aria-label={t("함께하기")}
            onClick={() => setDialog("pumasi")}
          >
            <Users size={17} />
            <span>{t("함께하기")}</span>
          </button>
        </nav>
        {appMode === "chat" && (
          <>
        <div className="section-label">
          <span>{auto ? t("정리된 작업") : t("직접 관리하는 세션")}</span>
          <span>{sideItems.length}</span>
        </div>
        {auto && (
          <div className="filter-tabs" aria-label={t("작업 상태")}>
            {(["current", "archived", "trashed"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "current"
                  ? t("작업")
                  : f === "archived"
                    ? t("보관")
                    : t("휴지통")}
              </button>
            ))}
          </div>
        )}
        <div className="chat-list">
          {sideItems.length ? (
            sideItems.map((c) => (
              <button
                key={c.id}
                className={`chat-item ${!auto && legacyId === c.id ? "active" : ""}`}
                onClick={() =>
                  auto
                    ? filter === "current"
                      ? jump(c.id)
                      : document
                          .getElementById(`bundle-${c.id}`)
                          ?.scrollIntoView({ behavior: "smooth" })
                    : (setLegacyId(c.id), setDraft(""))
                }
              >
                {auto ? <Layers size={14} /> : <MessageSquare size={14} />}
                <span>{c.title}</span>
              </button>
            ))
          ) : (
            <div className="empty-history">
              {auto ? t("아직 대화가 없습니다.") : t("아직 세션이 없습니다.")}
            </div>
          )}
        </div>
          </>
        )}
        <div className="sidebar-bottom">
          <button className="account" onClick={() => setDialog("settings")}>
            <span className="avatar">A</span>
            <span>
              <strong>{auto ? t("자동 정리 모드") : t("레거시 모드")}</strong>
              <small>{t("모드 및 데이터 설정")}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            {!sidebar && (
              <button
                className="icon-button"
                aria-label={t("사이드바 열기")}
                onClick={() => setSidebar(true)}
              >
                <Menu size={18} />
              </button>
            )}
            <span>{appName()}</span>
            <ChevronRight size={13} />
            <strong>
              {appMode === "code"
                ? t("코드")
                : auto
                  ? t("하나의 대화")
                  : (legacyChat?.title ?? t("새 세션"))}
            </strong>
          </div>
          <div className="mode-switch" role="tablist" aria-label={t("모드")}>
            {(["chat", "code"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={appMode === m}
                className={appMode === m ? "active" : ""}
                onClick={() => switchAppMode(m)}
              >
                {m === "chat" ? t("채팅") : t("코드")}
                {m === "code" && <span className="beta-tag">Beta</span>}
              </button>
            ))}
          </div>
          <div className="top-actions">
            <span className="preview-badge">
              <span />
              {routing.live ? t("API 모드") : t("로컬 미리보기")}
            </span>
            {appMode === "chat" && (
              <button
                className="icon-button"
                aria-label={t("사용량 패널 전환")}
                aria-pressed={usageOpen}
                onClick={() => setUsageOpen((v) => !v)}
              >
                <PanelRight size={17} />
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="inline-notice" role="status">
            {notice}
            <button aria-label={t("알림 닫기")} onClick={() => setNotice("")}>
              <X size={13} />
            </button>
          </div>
        )}
        {appMode === "code" ? (
          <CodeWorkspace />
        ) : (
          <>
        {workerBoard()}
        <div className="conversation">
          {!messages.length ? (
            <section className="welcome">
              <h1>
                {auto && filter === "current"
                  ? t("무엇을 도와드릴까요?")
                  : auto
                    ? `${t(filter === "archived" ? "보관한" : "휴지통의")} ${t("작업이 없습니다.")}`
                    : t("무엇을 도와드릴까요?")}
              </h1>
            </section>
          ) : (
            <section className="messages" aria-label={t("대화 내용")}>
              {auto
                ? visible.map((b) => (
                    <section
                      className="bundle"
                      id={`bundle-${b.id}`}
                      key={b.id}
                    >
                      <div className="bundle-heading">
                        <Layers size={14} />
                        <strong>{b.title}</strong>
                        <span className="sample-tag">
                          {statusNames[b.status]}
                        </span>
                        {(b.status === "archived" ||
                          b.status === "trashed") && (
                          <button onClick={() => restore(b.id)}>
                            <Undo2 size={13} />
                            {t("복원")}
                          </button>
                        )}
                      </div>
                      {b.messages.map((m) => (
                        <MessageView key={m.id} message={m} />
                      ))}
                    </section>
                  ))
                : messages.map((m) => <MessageView key={m.id} message={m} />)}
              <div ref={end} />
            </section>
          )}
        </div>
        <div className="composer-area">
          {preview && (
            <div className="draft-estimate" aria-live="polite">
              <Sparkles size={13} />
              <span>{t("{tier} 추천", { tier: tierNames[preview.tier] })}</span>
              <span>{t("약 {tokens} 토큰", { tokens: range(preview.total) })}</span>
              <span>
                {preview.percent
                  ? t("설정 예산 {percent}", { percent: percentage(preview.percent) })
                  : t("계정 한도 % 추정 불가")}
              </span>
            </div>
          )}
          <div className="composer">
            <textarea
              ref={input}
              aria-label={t("메시지")}
              placeholder={t("메시지를 입력하세요")}
              maxLength={20000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  review();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="model-control">
                <span>{t("모델 자동 추천 · 보내기 전에 확인")}</span>
              </div>
              <button
                type="button"
                className={`together-toggle ${routing.team && routing.pumasi ? "on" : ""}`}
                aria-pressed={routing.team && routing.pumasi}
                title={t("켜면 팀 모드로 실행하고, 리더가 나눈 작업을 다른 사람 앱이 먼저 맡습니다.")}
                onClick={() =>
                  setRouting((r) =>
                    r.team && r.pumasi
                      ? { ...r, pumasi: false }
                      : { ...r, team: true, pumasi: true },
                  )
                }
              >
                <Users size={14} />
                {t("함께하기")}
              </button>
              <button
                className="send-button"
                aria-label={t("요청 검토")}
                disabled={!draft.trim()}
                onClick={review}
              >
                <ArrowUp size={19} />
              </button>
            </div>
          </div>
          <div className="composer-footnote">
            <span>
              <span className="status-dot" />
              {routing.live
                ? t("선택한 제공자 API로 전송 · 사용량 발생")
                : t("외부 전송 없음 · 로컬 미리보기")}
            </span>
            <span>{t("Enter 검토 · Shift + Enter 줄바꿈")}</span>
          </div>
        </div>
          </>
        )}
        {appMode === "chat" && (
        <footer className="statusbar">
          <span>
            <span className="status-dot" />
            {auto
              ? t("하나의 대화 · 자동 정리")
              : t("레거시 · 직접 세션 관리")}
          </span>
          <span>{workspace.save ? t("이 기기에 저장 중") : t("대화 저장 꺼짐")}</span>
        </footer>
        )}
      </main>
      {usageOpen && appMode === "chat" && (
        <aside className="usage-panel" aria-label={t("사용량")}>
          <div className="usage-heading">
            <span>
              <Activity size={16} />
              {t("모델과 사용량")}
            </span>
            <button
              className="icon-button"
              aria-label={t("사용량 닫기")}
              onClick={() => setUsageOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="usage-scroll">
            <div className="usage-intro">
              <p>{t("보내기 전에 요청과 문맥을 보고 모델 등급과 예상 토큰을 보여 줍니다.")}</p>
            </div>
            <div className="data-source">
              <span className="source-dot" />
              {routing.live
                ? t("API 키 모드 · 잔여 한도 미연결")
                : t("미리보기 · API 호출 꺼짐")}
            </div>
            <section className="usage-card">
              <div className="usage-card-title">
                <span>{t("실제 계정 잔여 한도")}</span>
                <span>ACCOUNT</span>
              </div>
              <div className="usage-number">
                —<small>{t("연결 전")}</small>
              </div>
              <p className="small-copy">
                {t("확인되지 않은 잔여량은 표시하지 않습니다.")}
              </p>
            </section>
            <section className="usage-card">
              <div className="usage-card-title">
                <span>{t("이번 요청 예상")}</span>
                <span>ESTIMATE</span>
              </div>
              <div className="estimate-total">
                {preview ? range(preview.total) : "—"}
                <small>{t("토큰 · 입력 + 출력")}</small>
              </div>
              <div className="budget-value">
                {preview?.percent
                  ? percentage(preview.percent)
                  : t("퍼센트 추정 불가")}
              </div>
              <p className="small-copy">
                {workspace.budget
                  ? t("직접 설정한 토큰 예산 대비 비율입니다. 계정 한도가 아닙니다.")
                  : t("토큰 예산을 설정하면 예산 대비 비율을 볼 수 있습니다.")}
              </p>
            </section>
            <div className="usage-explanation">
              <CircleHelp size={15} />
              <p>
                {preview?.basis === "history"
                  ? t("이 기기에 남은 실제 사용 기록으로 계산한 범위입니다.")
                  : preview?.basis === "mixed"
                    ? t("기록이 있는 단계는 실제 사용량, 없는 단계는 등급별 가정으로 계산했습니다.")
                    : t("문자 수와 모델 등급별 출력 가정으로 계산한 범위입니다. 같은 모델로 5번 이상 실행하면 실제 사용량으로 바뀝니다.")}{" "}
                {t("재시도 비용은 포함하지 않습니다.")}
              </p>
            </div>
            <div className="next-section">
              <div>
                <strong>{t("문맥")}</strong>
                <p>
                  {t("묶거나 보관한 작업은 다음 요청의")}
                  <br />
                  {t("예상 문맥에서 제외합니다.")}
                  <br />
                  {t("현재 문맥 {count}개 메시지", { count: context().length })}
                </p>
              </div>
            </div>
            <button
              className="usage-settings"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={14} />
              {t("모드 및 예산 설정")}
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="panel-footer">
            <span className="status-dot" />
            {routing.live
              ? t("키 감지는 접근 검증과 다릅니다")
              : t("설정에서 내부·실행 모델 선택")}
          </div>
        </aside>
      )}
      {(dialog || pending) && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busyRef.current) {
              setDialog(null);
              setPending(null);
            }
          }}
        >
          <section
            className={`modal ${pending ? "review-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <header>
              <h2 id="dialog-title">
                {pending
                  ? t("실행 전에 확인해 주세요")
                  : dialog === "search"
                    ? t("대화 검색")
                    : dialog === "pumasi"
                      ? t("함께하기")
                      : t("워크스페이스 설정")}
              </h2>
              <button
                className="icon-button"
                aria-label={t("닫기")}
                disabled={busy}
                onClick={() => {
                  setDialog(null);
                  setPending(null);
                }}
              >
                <X size={18} />
              </button>
            </header>
            {pending ? (
              <>
                <div className="request-summary">{pending.text}</div>
                {pending.proposal && (
                  <section className="organize-proposal">
                    <div className="proposal-label">
                      <Sparkles size={15} />
                      {t("정리 제안")} <span className="sample-tag">{t("로컬 규칙")}</span>
                    </div>
                    <strong>{pending.proposal.reason}</strong>
                    <p>{t("이전 작업을 묶을까요, 버릴까요, 보관할까요?")}</p>
                    <div className="decision-grid">
                      {(
                        [
                          ["grouped", t("묶기"), Layers],
                          ["trashed", t("버리기"), Trash2],
                          ["archived", t("보관하기"), Archive],
                          ["continue", t("계속 이어가기"), MessageSquare],
                        ] as const
                      ).map(([action, label, Icon]) => (
                        <button
                          key={action}
                          disabled={busy}
                          aria-pressed={pending.decision === action}
                          onClick={() => chooseDecision(action)}
                        >
                          <Icon size={15} />
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>
                      {t("버리기는 휴지통 이동입니다. 모든 선택은 아래 진행 버튼을 눌러야 적용됩니다.")}
                    </small>
                  </section>
                )}
                <div className="recommendation-title">
                  <Sparkles size={17} />
                  <strong>{t("{tier} 모델 추천", { tier: tierNames[planned!.tier] })}</strong>
                </div>
                <p className="review-reason">{planned!.reason}</p>
                <div className="estimate-breakdown">
                  <div>
                    <span>{t("입력 · 문맥 포함")}</span>
                    <strong>{t("약 {count}", { count: planned!.input.toLocaleString() })}</strong>
                  </div>
                  <div>
                    <span>{t("예상 출력")}</span>
                    <strong>{range(planned!.output)}</strong>
                  </div>
                  <div>
                    <span>{t("합계 토큰")}</span>
                    <strong>{range(planned!.total)}</strong>
                  </div>
                  <div>
                    <span>{t("이번 요청의 예산 사용")}</span>
                    <strong>
                      {planned!.percent
                        ? t("약 {percent}", { percent: percentage(planned!.percent) })
                        : t("추정 불가")}
                    </strong>
                  </div>
                </div>
                <p className={`estimate-basis is-${planned!.basis}`}>
                  {basisText(planned!)}
                </p>
                {teamRun && (
                  <ol
                    className="stage-estimate"
                    aria-label={t("팀 모드 단계별 예상")}
                  >
                    {planned!.stages.map((st) => (
                      <li key={st.kind}>
                        <span>
                          {stageNames[st.kind]} ·{" "}
                          {t(st.role === "lead" ? "총괄 모델" : "작업 모델")}{" "}
                          {modelById(st.model).name} · {calls(st.calls)}
                        </span>
                        <span>
                          {range(st.total)}
                          <small>
                            {st.samples > 0
                              ? t("기록 {count}건", { count: st.samples })
                              : t("기본 가정")}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <section className="internal-model">
                  <strong>
                    {t("내부 분석")} · {modelById(routing.analyzer).name}
                  </strong>
                  <p>
                    {t("요청과 현재 문맥을 분석 제공자에게 전송합니다. 분석도 별도로 과금되며 실제 작업은 실행하지 않습니다.")}
                  </p>
                  <button
                    disabled={
                      busy ||
                      !routing.live ||
                      !modelReady(routing.analyzer, providerStatus)
                    }
                    onClick={analyze}
                  >
                    {busy ? t("요청 처리 중…") : t("내부 모델로 분석")}
                  </button>
                  {!routing.live && (
                    <small>
                      {t("현재는 로컬 규칙 추천입니다. API 모드를 켜야 내부 모델을 호출합니다.")}
                    </small>
                  )}
                  {pending.analysis && (
                    <div className="analysis-result">
                      <strong>{t("AI 분석")}</strong>
                      <p>{pending.analysis.summary}</p>
                      <p>{pending.analysis.reason}</p>
                      <p>
                        {t("추천:")}{" "}
                        {modelById(pending.analysis.recommendedModel).name} ·
                        {t("선택은 아래에서 직접 변경하세요.")}
                      </p>
                      <small>
                        {t("분석 사용량: 입력 {input} / 출력 {output} 토큰", {
                          input: pending.analysis.inputTokens ?? t("미확인"),
                          output: pending.analysis.outputTokens ?? t("미확인"),
                        })}
                      </small>
                    </div>
                  )}
                </section>
                <label className="review-model">
                  {t("이번 요청의 실행 모델")}
                  <select
                    aria-label={t("이번 요청 모델")}
                    disabled={busy}
                    value={pending.modelId}
                    onChange={(e) => {
                      const model = modelById(e.target.value);
                      setPending({
                        ...pending,
                        modelId: model.id,
                        selected: model.tier,
                      });
                    }}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {tierNames[m.tier]}
                      </option>
                    ))}
                  </select>
                </label>
                {!teamRun && (
                  <div
                    className="model-comparison"
                    aria-label={t("모델별 예상 비교")}
                  >
                    <p>
                      {t("실제 기록이 5건 이상인 모델은 그 기록으로, 나머지는 등급별 출력 가정으로 계산합니다.")}
                    </p>
                    {models.map((m) => {
                      const e = project(
                        pending.text,
                        context(pending.decision),
                        workspace.budget,
                        m,
                        history,
                      );
                      return (
                        <button
                          disabled={busy}
                          key={m.id}
                          aria-pressed={pending.modelId === m.id}
                          onClick={() =>
                            setPending({
                              ...pending,
                              modelId: m.id,
                              selected: m.tier,
                            })
                          }
                        >
                          <span>{m.name}</span>
                          <span>
                            {t("{tokens} 토큰", { tokens: range(e.total) })}
                            {e.samples > 0 && t(" · 기록 {count}건", { count: e.samples })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="small-copy">
                  {t("실제 계정 한도 대비 %는 추정할 수 없습니다. 예상은 품질·비용을 보장하지 않습니다. API 실행은 생성 상한 4,096토큰이며 입력·내부 분석은 별도입니다. 현재 텍스트 답변만 지원하며 파일 수정·셸 실행은 하지 않습니다.")}
                </p>
                {aiError && (
                  <p className="api-error" role="alert">
                    {aiError}
                  </p>
                )}
                {busy && workerBoard(" in-dialog")}
                <div className="review-actions">
                  <button disabled={busy} onClick={() => setPending(null)}>
                    {t("다시 작성")}
                  </button>
                  <button
                    className="primary-action"
                    disabled={
                      busy ||
                      !pending.decision ||
                      (routing.live &&
                        !bundleReady(routing, providerStatus) &&
                        !modelReady(pending.modelId, providerStatus))
                    }
                    onClick={proceed}
                  >
                    {busy
                      ? t("요청 처리 중…")
                      : routing.live && bundleReady(routing, providerStatus)
                        ? t("묶은 모델로 API 실행")
                        : routing.live
                          ? t("선택한 모델로 API 실행")
                          : t("이 모델로 미리보기")}
                  </button>
                </div>
              </>
            ) : dialog === "pumasi" ? (
              <PumasiPanel />
            ) : dialog === "search" ? (
              <>
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label={t("대화 검색어")}
                    placeholder={t("작업 제목이나 메시지로 검색")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="search-results">
                  {(auto
                    ? workspace.bundles.filter(
                        (b) => b.status === "active" || b.status === "grouped",
                      )
                    : workspace.legacyChats
                  )
                    .filter((c) =>
                      `${c.title} ${c.messages.map((m) => m.text).join(" ")}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          if (auto) jump(c.id);
                          else {
                            setLegacyId(c.id);
                            setDialog(null);
                          }
                        }}
                      >
                        <MessageSquare size={15} />
                        <span>{c.title}</span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <>
                <section
                  className="routing-settings"
                  aria-label={t("모델 기본 설정")}
                >
                  <h3>{t("모델 기본 설정")}</h3>
                  <div className="preset-buttons">
                    <button
                      onClick={() =>
                        setRouting({ ...presets.openai, live: routing.live })
                      }
                    >
                      {t("OpenAI 기본값")}
                    </button>
                    <button
                      onClick={() =>
                        setRouting({ ...presets.anthropic, live: routing.live })
                      }
                    >
                      {t("Claude 기본값")}
                    </button>
                  </div>
                  <label className="setting-row">
                    <span>
                      <strong>{t("내부 분석 모델")}</strong>
                      <small>
                        {t("요청 분류·추천에 사용. 실행 모델과 독립적입니다.")}
                      </small>
                    </span>
                    <select
                      aria-label={t("내부 분석 모델")}
                      value={routing.analyzer}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, analyzer: e.target.value }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-row">
                    <span>
                      <strong>{t("기본 실행 모델")}</strong>
                      <small>
                        {t("새 요청의 초기값. 요청마다 다시 선택할 수 있습니다.")}
                      </small>
                    </span>
                    <select
                      aria-label={t("기본 실행 모델")}
                      value={routing.executor}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, executor: e.target.value }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-row">
                    <span>
                      <strong>{t("팀 모드")}</strong>
                      <small>
                        {t("비싼 모델은 나누기와 검수만, 실제 작업은 싼 모델이 합니다. 실제 API 사용이 켜져 있어야 동작합니다.")}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={t("팀 모드")}
                      checked={routing.team}
                      onChange={(e) =>
                        setRouting((r) => ({
                          ...r,
                          team: e.target.checked,
                          ensemble: e.target.checked ? false : r.ensemble,
                        }))
                      }
                    />
                  </label>
                  <label className="setting-row">
                    <span>
                      <strong>{t("총괄 모델")}</strong>
                      <small>{t("작업을 나누고 결과를 검수합니다.")}</small>
                    </span>
                    <select
                      aria-label={t("총괄 모델")}
                      value={routing.lead}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, lead: e.target.value }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {routing.lead === "auto-free" && (
                    <div className="setting-row lead-order">
                      <span>
                        <strong>{t("리더 순서")}</strong>
                        <small>
                          {t(
                            "측정한 실력 순서입니다. 1등이 한도에 걸리면 다음 순위가 이어받고, 끝낼지는 리더가 정합니다. 리더가 확신하지 못할 때만 2등이 한 번 더 봅니다.",
                          )}
                        </small>
                      </span>
                      <ol>
                        {leadRanking(routing.leadOrder).map((m, i, all) => (
                          <li key={m.id}>
                            <span>{m.name}</span>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("{name} 위로", { name: m.name })}
                              disabled={i === 0}
                              onClick={() => {
                                const ids = all.map((x) => x.id);
                                [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                                setRouting((r) => ({ ...r, leadOrder: ids }));
                              }}
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("{name} 아래로", { name: m.name })}
                              disabled={i === all.length - 1}
                              onClick={() => {
                                const ids = all.map((x) => x.id);
                                [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                                setRouting((r) => ({ ...r, leadOrder: ids }));
                              }}
                            >
                              <ChevronDown size={14} />
                            </button>
                          </li>
                        ))}
                      </ol>
                      {routing.leadOrder.length > 0 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setRouting((r) => ({ ...r, leadOrder: [] }))}
                        >
                          {t("측정 순서로 되돌리기")}
                        </button>
                      )}
                    </div>
                  )}
                  <label className="setting-row">
                    <span>
                      <strong>{t("작업 모델")}</strong>
                      <small>
                        {t("나눠진 작업 하나씩만 받습니다. 대화 전체는 보내지 않습니다.")}
                      </small>
                    </span>
                    <select
                      aria-label={t("작업 모델")}
                      value={routing.worker}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, worker: e.target.value }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting-row">
                    <span>
                      <strong>{t("품앗이에 맡기기")}</strong>
                      <small>
                        {t("팀 모드의 작업을 다른 사람의 앱이 그 사람의 키로 처리합니다. 5분 안에 아무도 돕지 않은 작업은 내 작업 모델이 합니다. 작업 글은 모르는 사람의 AI가 읽으니 개인 정보는 넣지 마세요.")}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={t("품앗이에 맡기기")}
                      checked={routing.pumasi}
                      disabled={!routing.team}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, pumasi: e.target.checked }))
                      }
                    />
                  </label>
                  {routing.team && routing.pumasi && (
                    <label className="setting-row">
                      <span>
                        <strong>{t("작업당 돕는 사람")}</strong>
                        <small>
                          {t("2명 이상이면 두 결과를 비교해 더 나은 쪽을 씁니다. 엉터리 결과를 거르는 데 필요합니다.")}
                        </small>
                      </span>
                      <select
                        aria-label={t("작업당 돕는 사람")}
                        value={routing.pumasiCopies}
                        onChange={(e) =>
                          setRouting((r) => ({ ...r, pumasiCopies: Number(e.target.value) }))
                        }
                      >
                        {[1, 2, 3].map((n) => (
                          <option key={n} value={n}>
                            {t("{count}명", { count: n })}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <EnsembleSettings
                    routing={routing}
                    setRouting={setRouting}
                    status={providerStatus}
                  />
                  <label className="setting-row">
                    <span>
                      <strong>{t("실제 API 사용")}</strong>
                      <small>
                        {t("분석·실행 버튼을 누르면 선택한 제공자로 요청을 전송합니다.")}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={routing.live}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, live: e.target.checked }))
                      }
                    />
                  </label>
                  <p className="small-copy">
                    {t("OpenAI 키 {openai} · Claude 키 {anthropic} · Gemini 키 {gemini} · 무료 제공자 {compat}. 키는 아래 API 키에서 넣거나 환경 변수로 줄 수 있습니다. 모델 접근 권한은 실제 호출 시 확인됩니다. 모델 설정은 대화 저장과 별도로 이 기기에 유지됩니다.", {
                      openai: providerStatus.openai ? t("감지됨 (미검증)") : t("없음"),
                      anthropic: providerStatus.anthropic ? t("감지됨 (미검증)") : t("없음"),
                      gemini: providerStatus.gemini ? t("감지됨 (미검증)") : t("없음"),
                      compat: providerStatus.compat ? t("연결됨 (미검증)") : t("없음"),
                    })}
                  </p>
                </section>
                <SecretSettings
                  status={providerStatus}
                  onChanged={() => void refreshStatus()}
                />
                <label className="setting-row">
                  <span>
                    <strong>{t("화면 언어")}</strong>
                    <small>
                      {t(
                        "바꾸면 화면을 다시 불러옵니다. 대화와 설정은 그대로입니다.",
                      )}
                    </small>
                  </span>
                  <select
                    aria-label={t("화면 언어")}
                    value={getLang()}
                    onChange={(e) => setLang(e.target.value as Lang)}
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>{t("대화 관리 모드")}</strong>
                    <small>
                      {t("모드별 대화는 각각 유지됩니다. 전환해도 삭제되지 않습니다.")}
                    </small>
                  </span>
                  <select
                    aria-label={t("대화 관리 모드")}
                    value={workspace.mode}
                    onChange={(e) =>
                      switchMode(e.target.value as Workspace["mode"])
                    }
                  >
                    <option value="auto">{t("자동 정리")}</option>
                    <option value="legacy">{t("레거시")}</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>{t("화면 테마")}</strong>
                    <small>{t("현재 창에 적용합니다.")}</small>
                  </span>
                  <select
                    aria-label={t("화면 테마")}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="light">{t("라이트")}</option>
                    <option value="dark">{t("다크")}</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>{t("이 기기에 대화 저장")}</strong>
                    <small>
                      {t("끄면 저장 사본을 지웁니다. 현재 창의 대화는 유지됩니다.")}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={workspace.save}
                    onChange={(e) =>
                      setWorkspace((w) => ({ ...w, save: e.target.checked }))
                    }
                  />
                </label>
                {window.auroraAI?.usage && (
                  <div className="setting-row usage-learning">
                    <span>
                      <label htmlFor="usage-learning">
                        <strong>{t("실제 사용량으로 예상 보정")}</strong>
                        <small>
                          {t("응답이 끝날 때마다 모델, 요청 종류, 글자 수, 토큰 수만 이 기기에 남깁니다. 대화 내용과 키는 남기지 않으며 대화 저장 설정과 별개입니다.")}
                        </small>
                      </label>
                      <small>
                        {history?.records.length
                          ? t("지금 기록 {count}건", { count: history.records.length.toLocaleString() })
                          : t("아직 기록 없음")}
                        {confirmClear ? (
                          <>
                            {" · "}
                            {t("모두 지울까요?")}
                            <button
                              type="button"
                              className="text-button is-danger"
                              onClick={() => {
                                setConfirmClear(false);
                                window.auroraAI?.usage
                                  ?.clear()
                                  .then(setHistory)
                                  .catch(() =>
                                    setAIError(t("사용 기록을 지우지 못했습니다.")),
                                  );
                              }}
                            >
                              {t("기록 지우기")}
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setConfirmClear(false)}
                            >
                              {t("그대로 두기")}
                            </button>
                          </>
                        ) : (
                          !!history?.records.length && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setConfirmClear(true)}
                              >
                                {t("사용 기록 지우기")}
                              </button>
                            </>
                          )
                        )}
                      </small>
                    </span>
                    <input
                      id="usage-learning"
                      type="checkbox"
                      checked={history?.enabled ?? true}
                      onChange={(e) =>
                        window.auroraAI?.usage
                          ?.setEnabled(e.target.checked)
                          .then(setHistory)
                          .catch(() =>
                            setAIError(t("사용 기록 설정을 바꾸지 못했습니다.")),
                          )
                      }
                    />
                  </div>
                )}
                <label className="setting-row">
                  <span>
                    <strong>{t("계획용 토큰 예산")}</strong>
                    <small>
                      {t("예: 100000. 계정 한도와 무관한 개인 예산입니다.")}
                    </small>
                  </span>
                  <input
                    aria-label={t("계획용 토큰 예산")}
                    className="budget-input"
                    type="number"
                    min="1"
                    max="1000000000"
                    placeholder={t("미설정")}
                    value={workspace.budget ?? ""}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setWorkspace((w) => ({
                        ...w,
                        budget:
                          Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : null,
                      }));
                    }}
                  />
                </label>
                <div className="connection-info">
                  <Check size={16} />
                  <span>
                    {t("자동 정리는 로컬 규칙으로 동작합니다. 내부 분석과 실행 모델은 API 모드에서 별도로 호출합니다.")}
                    <br />
                    {t("계정 잔여 한도와 전체 작업 예산 강제 제한은 미연결입니다.")}
                  </span>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {storageError && (
        <div className="toast" role="alert">
          {t("저장하지 못했습니다. 창을 닫기 전에 내용을 복사해 주세요.")}
        </div>
      )}
    </div>
  );
}
function MessageView({ message }: { message: Chat["messages"][number] }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-author">
        {message.role === "assistant" ? (
          <>
            <span className="assistant-symbol">✦</span>
            {appName()}
            <span className="sample-tag">
              {message.live ? t("API 응답") : t("로컬 미리보기")}
            </span>
          </>
        ) : (
          t("나")
        )}
      </div>
      <div className="message-text">{message.text}</div>
      {message.ensemble && <EnsembleDetails ensemble={message.ensemble} />}
    </article>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
