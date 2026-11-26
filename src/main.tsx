import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
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
  presets,
  readRouting,
  ROUTING_KEY,
  type RoutingSettings,
  type ProviderStatus,
  type TeamResult,
  type Analysis,
  type Completion,
} from "./routing";
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
  active: "진행 중",
  grouped: "묶음",
  archived: "보관",
  trashed: "휴지통",
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
  execute: "실행",
  analyze: "분석",
  plan: "계획",
  work: "작업",
  review: "검토",
  merge: "합치기",
};
const calls = ([a, b]: [number, number]) =>
  a === b ? `${a}회` : `${a}–${b}회`;
/** Where a number came from: the user's own past responses or the fixed tier assumption. */
function basisText(p: Projection): string {
  if (p.basis === "history")
    return p.stages.length > 1
      ? `단계별 실제 기록 ${p.samples.toLocaleString()}건 기준`
      : `이 모델의 실제 기록 ${p.samples.toLocaleString()}건 기준`;
  if (p.basis === "mixed") {
    const known = p.stages.filter((s) => s.samples > 0).length;
    return `단계 ${p.stages.length}개 중 ${known}개는 실제 기록, 나머지는 기본 가정`;
  }
  return p.stages.length > 1
    ? "기본 가정 · 단계별로 같은 모델 기록이 5건 모이면 실제 사용량으로 바뀝니다"
    : "기본 가정 · 같은 모델 기록이 5건 모이면 실제 사용량으로 바뀝니다";
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
    | "failed";
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
        return "시간 초과";
      case "rate-limit":
        return "무료 한도";
      case "server":
        return "서버 오류";
      case "network":
        return "연결 실패";
      case "error":
        return "오류";
      case "empty":
        return "빈 답";
      case "short":
        return "너무 짧은 답";
      case "truncated":
        return "답이 잘림";
      default:
        return "";
    }
  };
  if (w.state === "waiting") return "대기";
  if (w.state === "running") {
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - (w.startedAt ?? Date.now())) / 1000),
    );
    let txt = `${model} · ${elapsed}초째`;
    if (w.attempt === 2) txt += " · 재시도";
    if (w.timeoutMs && elapsed > w.timeoutMs / 2000) txt += " · 느림";
    return txt;
  }
  if (w.state === "retry") return `${model} 다시 시키는 중 · ${getReason()}`;
  if (w.state === "switch")
    return `${w.from ? modelById(w.from).name : "모델"} → ${model}로 교체`;
  if (w.state === "substituted")
    return `${model} 요청, ${w.servedBy ?? "다른 모델"}가 답함`;
  if (w.state === "done") {
    const txt = w.partial ? `일부만 받음 · ${model}` : `완료 · ${model}`;
    return w.servedBy ? `${txt} · ${w.servedBy}가 대신 답함` : txt;
  }
  if (w.state === "failed") return `실패 · ${getReason()}`;
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
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [aiError, setAIError] = useState("");
  useEffect(() => {
    window.auroraAI
      ?.status()
      .then(setProviderStatus)
      .catch(() => setAIError("API 키 설정 상태를 확인하지 못했습니다."));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(ROUTING_KEY, JSON.stringify(routing));
    } catch {
      setAIError("모델 설정을 저장하지 못했습니다.");
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
  const [usageOpen, setUsageOpen] = useState(
    () => !window.matchMedia("(max-width: 680px)").matches,
  );
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
  const [dialog, setDialog] = useState<"search" | "settings" | null>(null);
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
        aria-label="주니어 진행 상황"
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
        `내부 분석 · ${modelById(result.model).name} · 입력 ${result.inputTokens ?? "미확인"} / 출력 ${result.outputTokens ?? "미확인"} 토큰 사용`,
      );
    } catch (error) {
      setAIError(
        error instanceof Error ? error.message : "내부 분석에 실패했습니다.",
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
    if (routing.live && routing.team && window.auroraAI?.team) {
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
        setNotice(
          e.stage === "plan"
            ? `팀 모드 · ${modelById(routing.lead).name}가 작업을 나누는 중`
            : e.stage === "work"
              ? `팀 모드 · ${e.round}회차 ${e.index}/${e.total} · ${modelById(routing.worker).name}: ${e.title}`
              : e.stage === "review"
                ? `팀 모드 · ${modelById(routing.lead).name}가 ${e.round}회차 결과 검수 중`
                : e.stage === "merge"
                  ? `팀 모드 · ${modelById(routing.worker).name}가 결과를 합치는 중`
                  : "팀 모드 · 완료",
        );
      });
      try {
        team = await window.auroraAI.team({
          lead: routing.lead,
          worker: routing.worker,
          text: p.text,
          context: context(p.decision),
        });
        completion = {
          text: `${team.text}\n\n—\n팀 모드 · 선임 ${modelById(team.lead).name} 입력 ${team.usage.lead.in} / 출력 ${team.usage.lead.out} · 주니어 ${team.workersUsed.map((id) => modelById(id).name).join(", ") || modelById(team.worker).name} 입력 ${team.usage.worker.in} / 출력 ${team.usage.worker.out} 토큰 · 작업 ${team.tasks.length}개 · ${team.rounds}회차${team.approved ? " · 선임 승인" : ""}${team.tasks.some((t) => t.failed) ? ` · 실패 작업 ${team.tasks.filter((t) => t.failed).length}개` : ""}${team.tasks.some((t) => t.incomplete) ? " · 일부 작업 출력 상한 도달" : ""}${team.warning ? `\n주의: ${team.warning}` : ""}${[...new Set((team.substitutions ?? []).map((s) => `\n주의: ${modelById(s.requested).name} 대신 ${s.servedBy ?? "다른 모델"}가 답했습니다.`))].join("")}`,
          model: team.lead,
          inputTokens: team.usage.lead.in + team.usage.worker.in,
          outputTokens: team.usage.lead.out + team.usage.worker.out,
          incomplete: false,
        };
      } catch (error) {
        setAIError(
          error instanceof Error
            ? error.message
            : "팀 모드 실행에 실패했습니다.",
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
        setAIError("Electron 앱에서 실행해 주세요.");
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
          error instanceof Error ? error.message : "API 실행에 실패했습니다.",
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
        text: team
          ? completion!.text
          : completion
            ? `${completion.text}\n\n—\n${modelById(p.modelId).name} · 실제 입력 ${completion.inputTokens ?? "미확인"} / 출력 ${completion.outputTokens ?? "미확인"} 토큰${completion.incomplete ? " · 생성 상한 도달: 미완성일 수 있음" : ""}`
            : `${makePreview(p.text, p.selected)}\n선택한 실행 모델: ${modelById(p.modelId).name}`,
        live: !!completion,
        model: p.modelId,
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
          ? "이전 작업을 휴지통으로 옮겼습니다. 복원할 수 있습니다."
          : "이전 작업을 정리했습니다. 대화 흐름은 계속 이어집니다.",
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
        ? "레거시 모드: 직접 세션을 관리합니다. 자동 정리는 꺼집니다."
        : "자동 정리 모드: 하나의 대화 흐름을 이어갑니다.",
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
      "작업 묶음을 복원했습니다. 새 요청의 문맥에는 자동 포함하지 않습니다.",
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
      <aside className="sidebar" aria-label="사이드바">
        <div className="window-space" />
        <div className="brand">
          <span className="brand-mark">
            a<span>✦</span>
          </span>
          <strong>Aurora</strong>
          <button
            className="icon-button"
            aria-label="사이드바 접기"
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
              <span>하나의 대화</span>
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
              <span>새 세션</span>
            </button>
          )}
          <button
            className="nav-item"
            aria-label="대화 검색"
            onClick={() => setDialog("search")}
          >
            <Search size={17} />
            <span>대화 검색</span>
            <kbd>⌘ K</kbd>
          </button>
        </nav>
        <div className="section-label">
          <span>{auto ? "정리된 작업" : "직접 관리하는 세션"}</span>
          <span>{sideItems.length}</span>
        </div>
        {auto && (
          <div className="filter-tabs" aria-label="작업 상태">
            {(["current", "archived", "trashed"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "current"
                  ? "작업"
                  : f === "archived"
                    ? "보관"
                    : "휴지통"}
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
              {auto ? "대화는 하나로 이어집니다." : "아직 세션이 없습니다."}
              <br />
              <span>
                {auto
                  ? "정리가 필요할 때 제안할게요."
                  : "새 세션에서 시작하세요."}
              </span>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="mode-note">
            <Sparkles size={14} />
            <span>
              {auto ? "정리 제안 켜짐" : "자동 정리 꺼짐"}
              <small>
                {auto ? "현재 로컬 규칙 기반" : "세션을 직접 관리합니다"}
              </small>
            </span>
          </div>
          <button className="account" onClick={() => setDialog("settings")}>
            <span className="avatar">A</span>
            <span>
              <strong>{auto ? "자동 정리 모드" : "레거시 모드"}</strong>
              <small>모드 및 데이터 설정</small>
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
                aria-label="사이드바 열기"
                onClick={() => setSidebar(true)}
              >
                <Menu size={18} />
              </button>
            )}
            <span>Aurora</span>
            <ChevronRight size={13} />
            <strong>
              {auto ? "하나의 대화" : (legacyChat?.title ?? "새 세션")}
            </strong>
          </div>
          <div className="top-actions">
            <span className="preview-badge">
              <span />
              {routing.live ? "API 모드" : "로컬 미리보기"}
            </span>
            <button
              className="icon-button"
              aria-label="사용량 패널 전환"
              onClick={() => setUsageOpen((v) => !v)}
            >
              <PanelRight size={17} />
            </button>
          </div>
        </header>
        {notice && (
          <div className="inline-notice" role="status">
            {notice}
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              <X size={13} />
            </button>
          </div>
        )}
        {workerBoard()}
        <div className="conversation">
          {!messages.length ? (
            <section className="welcome">
              <div className="welcome-symbol">
                <Sparkles size={27} strokeWidth={1.25} />
              </div>
              <div className="eyebrow">ONE FLOW. LESS FRICTION.</div>
              <h1>
                {auto && filter === "current"
                  ? "대화는 하나로, 생각은 자유롭게."
                  : auto
                    ? `${filter === "archived" ? "보관한" : "휴지통의"} 작업이 없습니다.`
                    : "무엇부터 시작할까요?"}
              </h1>
              <p>
                {auto
                  ? "세션을 나누지 않아도 괜찮아요. 정리가 필요할 때 제안할게요."
                  : "세션을 직접 나누고 관리하는 익숙한 작업 공간입니다."}
              </p>
              <div className="prompt-grid">
                {[
                  ["글을 간결하게 요약해 줘", "가볍게 정리하기", "요약 · 번역"],
                  [
                    "코드의 문제를 찾아 해결 방법을 제안해 줘",
                    "함께 문제 풀기",
                    "코드 · 분석",
                  ],
                  [
                    "동기화 아키텍처를 설계해 줘",
                    "깊이 생각하기",
                    "설계 · 추론",
                  ],
                ].map(([text, title, note]) => (
                  <button
                    key={title}
                    className="prompt-card"
                    onClick={() => {
                      setDraft(text);
                      setFilter("current");
                      input.current?.focus();
                    }}
                  >
                    <Sparkles size={17} />
                    <strong>
                      {title}
                      <ArrowUpRight size={14} />
                    </strong>
                    <span>{note}</span>
                  </button>
                ))}
              </div>
              <div className="welcome-note">
                전송 전에 추천 모델과 예상 소모량을 확인하세요.
              </div>
            </section>
          ) : (
            <section className="messages" aria-label="대화 내용">
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
                            복원
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
              <span>{tierNames[preview.tier]} 추천</span>
              <span>약 {range(preview.total)} 토큰</span>
              <span>
                {preview.percent
                  ? `설정 예산 ${percentage(preview.percent)}`
                  : "계정 한도 % 추정 불가"}
              </span>
            </div>
          )}
          <div className="composer">
            <textarea
              ref={input}
              aria-label="메시지"
              placeholder="계속 이야기하세요. 정리는 함께 할게요."
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
                <Sparkles size={14} />
                <span>요청별 모델 추천</span>
                <span className="toolbar-divider" />
                <span>실행 전 확인</span>
              </div>
              <button
                className="send-button"
                aria-label="요청 검토"
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
                ? "선택한 제공자 API로 전송 · 사용량 발생"
                : "외부 전송 없음 · 로컬 미리보기"}
            </span>
            <span>Enter 검토 · Shift + Enter 줄바꿈</span>
          </div>
        </div>
        <footer className="statusbar">
          <span>
            <span className="status-dot" />
            {auto ? "하나의 대화 · 자동 정리" : "레거시 · 직접 세션 관리"}
          </span>
          <span>{workspace.save ? "이 기기에 저장 중" : "대화 저장 꺼짐"}</span>
        </footer>
      </main>
      {usageOpen && (
        <aside className="usage-panel" aria-label="사용량">
          <div className="usage-heading">
            <span>
              <Activity size={16} />
              모델과 사용량
            </span>
            <button
              className="icon-button"
              aria-label="사용량 닫기"
              onClick={() => setUsageOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="usage-scroll">
            <div className="usage-intro">
              <div className="eyebrow">THE RIGHT MODEL. ENOUGH ROOM.</div>
              <h2>
                시작하기 전에,
                <br />
                얼마나 쓸까요?
              </h2>
              <p>
                요청과 현재 문맥을 기준으로
                <br />
                모델 등급과 토큰 범위를 제안합니다.
              </p>
            </div>
            <div className="data-source">
              <span className="source-dot" />
              {routing.live
                ? "API 키 모드 · 잔여 한도 미연결"
                : "미리보기 · API 호출 꺼짐"}
            </div>
            <section className="usage-card">
              <div className="usage-card-title">
                <span>실제 계정 잔여 한도</span>
                <span>ACCOUNT</span>
              </div>
              <div className="usage-number">
                —<small>연결 전</small>
              </div>
              <p className="small-copy">
                확인되지 않은 잔여량은 표시하지 않습니다.
              </p>
            </section>
            <section className="usage-card">
              <div className="usage-card-title">
                <span>이번 요청 예상</span>
                <span>ESTIMATE</span>
              </div>
              <div className="estimate-total">
                {preview ? range(preview.total) : "—"}
                <small>토큰 · 입력 + 출력</small>
              </div>
              <div className="budget-value">
                {preview?.percent
                  ? percentage(preview.percent)
                  : "퍼센트 추정 불가"}
              </div>
              <p className="small-copy">
                {workspace.budget
                  ? "직접 설정한 토큰 예산 대비 비율입니다. 계정 한도가 아닙니다."
                  : "토큰 예산을 설정하면 예산 대비 비율을 볼 수 있습니다."}
              </p>
            </section>
            <div className="usage-explanation">
              <CircleHelp size={15} />
              <p>
                {preview?.basis === "history"
                  ? "이 기기에 남은 실제 사용 기록으로 계산한 범위입니다."
                  : preview?.basis === "mixed"
                    ? "기록이 있는 단계는 실제 사용량, 없는 단계는 등급별 가정으로 계산했습니다."
                    : "문자 수와 모델 등급별 출력 가정으로 계산한 범위입니다. 같은 모델로 5번 이상 실행하면 실제 사용량으로 바뀝니다."}{" "}
                재시도 비용은 포함하지 않습니다.
              </p>
            </div>
            <div className="next-section">
              <div>
                <strong>문맥도 필요한 만큼만.</strong>
                <p>
                  묶거나 보관한 작업은 다음 요청의
                  <br />
                  예상 문맥에서 제외합니다.
                  <br />
                  현재 문맥 {context().length}개 메시지
                </p>
              </div>
            </div>
            <button
              className="usage-settings"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={14} />
              모드 및 예산 설정
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="panel-footer">
            <span className="status-dot" />
            {routing.live
              ? "키 감지는 접근 검증과 다릅니다"
              : "설정에서 내부·실행 모델 선택"}
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
                  ? "실행 전에 확인해 주세요"
                  : dialog === "search"
                    ? "대화 검색"
                    : "워크스페이스 설정"}
              </h2>
              <button
                className="icon-button"
                aria-label="닫기"
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
                      정리 제안 <span className="sample-tag">로컬 규칙</span>
                    </div>
                    <strong>{pending.proposal.reason}</strong>
                    <p>이전 작업을 묶을까요, 버릴까요, 보관할까요?</p>
                    <div className="decision-grid">
                      {(
                        [
                          ["grouped", "묶기", Layers],
                          ["trashed", "버리기", Trash2],
                          ["archived", "보관하기", Archive],
                          ["continue", "계속 이어가기", MessageSquare],
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
                      버리기는 휴지통 이동입니다. 모든 선택은 아래 진행 버튼을
                      눌러야 적용됩니다.
                    </small>
                  </section>
                )}
                <div className="recommendation-title">
                  <Sparkles size={17} />
                  <strong>{tierNames[planned!.tier]} 모델 추천</strong>
                </div>
                <p className="review-reason">{planned!.reason}</p>
                <div className="estimate-breakdown">
                  <div>
                    <span>입력 · 문맥 포함</span>
                    <strong>약 {planned!.input.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>예상 출력</span>
                    <strong>{range(planned!.output)}</strong>
                  </div>
                  <div>
                    <span>합계 토큰</span>
                    <strong>{range(planned!.total)}</strong>
                  </div>
                  <div>
                    <span>이번 요청의 예산 사용</span>
                    <strong>
                      {planned!.percent
                        ? `약 ${percentage(planned!.percent)}`
                        : "추정 불가"}
                    </strong>
                  </div>
                </div>
                <p className={`estimate-basis is-${planned!.basis}`}>
                  {basisText(planned!)}
                </p>
                {teamRun && (
                  <ol
                    className="stage-estimate"
                    aria-label="팀 모드 단계별 예상"
                  >
                    {planned!.stages.map((st) => (
                      <li key={st.kind}>
                        <span>
                          {stageNames[st.kind]} ·{" "}
                          {st.role === "lead" ? "총괄 모델" : "작업 모델"}{" "}
                          {modelById(st.model).name} · {calls(st.calls)}
                        </span>
                        <span>
                          {range(st.total)}
                          <small>
                            {st.samples > 0
                              ? `기록 ${st.samples}건`
                              : "기본 가정"}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <section className="internal-model">
                  <strong>
                    내부 분석 · {modelById(routing.analyzer).name}
                  </strong>
                  <p>
                    요청과 현재 문맥을 분석 제공자에게 전송합니다. 분석도 별도로
                    과금되며 실제 작업은 실행하지 않습니다.
                  </p>
                  <button
                    disabled={
                      busy ||
                      !routing.live ||
                      !providerStatus[modelById(routing.analyzer).provider]
                    }
                    onClick={analyze}
                  >
                    {busy ? "요청 처리 중…" : "내부 모델로 분석"}
                  </button>
                  {!routing.live && (
                    <small>
                      현재는 로컬 규칙 추천입니다. API 모드를 켜야 내부 모델을
                      호출합니다.
                    </small>
                  )}
                  {pending.analysis && (
                    <div className="analysis-result">
                      <strong>AI 분석</strong>
                      <p>{pending.analysis.summary}</p>
                      <p>{pending.analysis.reason}</p>
                      <p>
                        추천:{" "}
                        {modelById(pending.analysis.recommendedModel).name} ·
                        선택은 아래에서 직접 변경하세요.
                      </p>
                      <small>
                        분석 사용량: 입력{" "}
                        {pending.analysis.inputTokens ?? "미확인"} / 출력{" "}
                        {pending.analysis.outputTokens ?? "미확인"} 토큰
                      </small>
                    </div>
                  )}
                </section>
                <label className="review-model">
                  이번 요청의 실행 모델
                  <select
                    aria-label="이번 요청 모델"
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
                    aria-label="모델별 예상 비교"
                  >
                    <p>
                      실제 기록이 5건 이상인 모델은 그 기록으로, 나머지는 등급별
                      출력 가정으로 계산합니다.
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
                            {range(e.total)} 토큰
                            {e.samples > 0 && ` · 기록 ${e.samples}건`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="small-copy">
                  실제 계정 한도 대비 %는 추정할 수 없습니다. 예상은 품질·비용을
                  보장하지 않습니다. API 실행은 생성 상한 4,096토큰이며
                  입력·내부 분석은 별도입니다. 현재 텍스트 답변만 지원하며 파일
                  수정·셸 실행은 하지 않습니다.
                </p>
                {aiError && (
                  <p className="api-error" role="alert">
                    {aiError}
                  </p>
                )}
                {busy && workerBoard(" in-dialog")}
                <div className="review-actions">
                  <button disabled={busy} onClick={() => setPending(null)}>
                    다시 작성
                  </button>
                  <button
                    className="primary-action"
                    disabled={
                      busy ||
                      !pending.decision ||
                      (routing.live &&
                        !providerStatus[modelById(pending.modelId).provider])
                    }
                    onClick={proceed}
                  >
                    {busy
                      ? "요청 처리 중…"
                      : routing.live
                        ? "선택한 모델로 API 실행"
                        : "이 모델로 미리보기"}
                  </button>
                </div>
              </>
            ) : dialog === "search" ? (
              <>
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label="대화 검색어"
                    placeholder="작업 제목이나 메시지로 검색"
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
                  aria-label="모델 기본 설정"
                >
                  <h3>모델 기본 설정</h3>
                  <div className="preset-buttons">
                    <button
                      onClick={() =>
                        setRouting({ ...presets.openai, live: routing.live })
                      }
                    >
                      OpenAI 기본값
                    </button>
                    <button
                      onClick={() =>
                        setRouting({ ...presets.anthropic, live: routing.live })
                      }
                    >
                      Claude 기본값
                    </button>
                  </div>
                  <label className="setting-row">
                    <span>
                      <strong>내부 분석 모델</strong>
                      <small>
                        요청 분류·추천에 사용. 실행 모델과 독립적입니다.
                      </small>
                    </span>
                    <select
                      aria-label="내부 분석 모델"
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
                      <strong>기본 실행 모델</strong>
                      <small>
                        새 요청의 초기값. 요청마다 다시 선택할 수 있습니다.
                      </small>
                    </span>
                    <select
                      aria-label="기본 실행 모델"
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
                      <strong>팀 모드</strong>
                      <small>
                        비싼 모델은 나누기와 검수만, 실제 작업은 싼 모델이
                        합니다. 실제 API 사용이 켜져 있어야 동작합니다.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="팀 모드"
                      checked={routing.team}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, team: e.target.checked }))
                      }
                    />
                  </label>
                  <label className="setting-row">
                    <span>
                      <strong>선임 모델</strong>
                      <small>작업을 나누고 결과를 검수합니다.</small>
                    </span>
                    <select
                      aria-label="선임 모델"
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
                  <label className="setting-row">
                    <span>
                      <strong>주니어 모델</strong>
                      <small>
                        나눠진 작업 하나씩만 받습니다. 대화 전체는 보내지
                        않습니다.
                      </small>
                    </span>
                    <select
                      aria-label="주니어 모델"
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
                      <strong>실제 API 사용</strong>
                      <small>
                        분석·실행 버튼을 누르면 선택한 제공자로 요청을
                        전송합니다.
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
                    OpenAI 키{" "}
                    {providerStatus.openai ? "감지됨 (미검증)" : "없음"} ·
                    Claude 키{" "}
                    {providerStatus.anthropic ? "감지됨 (미검증)" : "없음"} ·
                    Gemini 키{" "}
                    {providerStatus.gemini ? "감지됨 (미검증)" : "없음"}. 키는
                    .env 또는 환경변수로 설정하고 앱을 재시작하세요. 모델 접근
                    권한은 실제 호출 시 확인됩니다. 모델 설정은 대화 저장과
                    별도로 이 기기에 유지됩니다.
                  </p>
                </section>
                <label className="setting-row">
                  <span>
                    <strong>대화 관리 모드</strong>
                    <small>
                      모드별 대화는 각각 유지됩니다. 전환해도 삭제되지 않습니다.
                    </small>
                  </span>
                  <select
                    aria-label="대화 관리 모드"
                    value={workspace.mode}
                    onChange={(e) =>
                      switchMode(e.target.value as Workspace["mode"])
                    }
                  >
                    <option value="auto">자동 정리</option>
                    <option value="legacy">레거시</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>화면 테마</strong>
                    <small>현재 창에 적용합니다.</small>
                  </span>
                  <select
                    aria-label="화면 테마"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="light">라이트</option>
                    <option value="dark">다크</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>이 기기에 대화 저장</strong>
                    <small>
                      끄면 저장 사본을 지웁니다. 현재 창의 대화는 유지됩니다.
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
                        <strong>실제 사용량으로 예상 보정</strong>
                        <small>
                          응답이 끝날 때마다 모델, 요청 종류, 글자 수, 토큰 수만
                          이 기기에 남깁니다. 대화 내용과 키는 남기지 않으며
                          대화 저장 설정과 별개입니다.
                        </small>
                      </label>
                      <small>
                        {history?.records.length
                          ? `지금 기록 ${history.records.length.toLocaleString()}건`
                          : "아직 기록 없음"}
                        {confirmClear ? (
                          <>
                            {" · 모두 지울까요? "}
                            <button
                              type="button"
                              className="text-button is-danger"
                              onClick={() => {
                                setConfirmClear(false);
                                window.auroraAI?.usage
                                  ?.clear()
                                  .then(setHistory)
                                  .catch(() =>
                                    setAIError(
                                      "사용 기록을 지우지 못했습니다.",
                                    ),
                                  );
                              }}
                            >
                              기록 지우기
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setConfirmClear(false)}
                            >
                              그대로 두기
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
                                사용 기록 지우기
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
                            setAIError("사용 기록 설정을 바꾸지 못했습니다."),
                          )
                      }
                    />
                  </div>
                )}
                <label className="setting-row">
                  <span>
                    <strong>계획용 토큰 예산</strong>
                    <small>
                      예: 100000. 계정 한도와 무관한 개인 예산입니다.
                    </small>
                  </span>
                  <input
                    aria-label="계획용 토큰 예산"
                    className="budget-input"
                    type="number"
                    min="1"
                    max="1000000000"
                    placeholder="미설정"
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
                    자동 정리는 로컬 규칙으로 동작합니다. 내부 분석과 실행
                    모델은 API 모드에서 별도로 호출합니다.
                    <br />
                    계정 잔여 한도와 전체 작업 예산 강제 제한은 미연결입니다.
                  </span>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {storageError && (
        <div className="toast" role="alert">
          저장하지 못했습니다. 창을 닫기 전에 내용을 복사해 주세요.
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
            <span className="assistant-symbol">✦</span>Aurora
            <span className="sample-tag">
              {message.live ? "API 응답" : "로컬 미리보기"}
            </span>
          </>
        ) : (
          "나"
        )}
      </div>
      <div className="message-text">{message.text}</div>
    </article>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
