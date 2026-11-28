import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Square,
  Paperclip,
  FileText,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings2,
  Undo2,
  Users,
  X,
  Download,
} from "lucide-react";
import {
  Chat,
  LEGACY_KEY,
  STORAGE_KEY,
  Tier,
  Workspace,
  activeContext,
  makePreview,
  readAttachment,
  withFiles,
  ATTACH_TOTAL,
  type Attachment,
  restoreWorkspace,
} from "./domain";
import {
  models,
  modelById,
  leadRanking,
  readRouting,
  ROUTING_KEY,
  type RoutingSettings,
  modelReady,
  type ProviderStatus,
  type TeamResult,
  type Completion,
} from "./routing";
import { SecretSettings } from "./secrets";
import { PumasiPanel } from "./pumasi";
import { CodeWorkspace } from "./code-view";
import { KeySetup } from "./key-setup";
import {
  AskProgressView,
  applyProgress,
  emptyRun,
  finishedText,
  howLine,
  trailOf,
  clock,
  type AskRun,
} from "./ask-progress";
import { appName, getLang, setLang, t, type Lang } from "./i18n";
import "./style.css";
import { installWebBridge } from "./web-bridge";
import { Markdown } from "./markdown";
import { CrewRoster, ModelToken } from "./crew";
import { ModePicker } from "./modes";
import { runCode } from "./code-sandbox";
import { CopyButton, ShareButton, conversationMarkdown } from "./message-actions";
// In a browser there is no desktop main process: the web version provides the same bridge.
installWebBridge();
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
const statusNames = {
  active: t("진행 중"),
  grouped: t("묶음"),
  archived: t("보관"),
  trashed: t("휴지통"),
};
type Pending = {
  text: string;
  modelId: string;
  selected: Tier;
  files?: Attachment[];
};
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
    let saved: RoutingSettings;
    try {
      saved = readRouting(localStorage.getItem(ROUTING_KEY));
    } catch {
      saved = readRouting(null);
    }
    // The desktop app always calls real models; the browser demo never does.
    const live = !!window.auroraAI;
    return {
      ...saved,
      executor: saved.live ? saved.executor : "auto-free",
      live,
    };
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
  const [aiError, setAIErrorRaw] = useState("");
  // Electron prefixes errors from the main process; show only the message itself.
  const setAIError = (message: string) =>
    setAIErrorRaw(
      message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
    );
  // Until the first status read, nothing is known about keys: don't flash the key setup screen.
  const [statusLoaded, setStatusLoaded] = useState(false);
  const refreshStatus = () =>
    window.auroraAI
      ?.status()
      .then((s) => {
        setProviderStatus(s);
        setStatusLoaded(true);
      })
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
  // The question being answered right now, shown in the conversation until the answer lands.
  const [sending, setSending] = useState<string | null>(null);
  // Files waiting to go with the next question.
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  // The answer so far while it streams in.
  const [streamed, setStreamed] = useState("");
  // Tokens the provider reported for the last answer. Nothing is guessed before sending.
  const [lastUsage, setLastUsage] = useState<{
    model: string;
    input: number;
    output: number;
  } | null>(null);
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
    "settings" | "pumasi" | "help" | null
  >(null);
  // "Ask for help": a question waiting for the user's OK, then for another user's app to answer.
  const [help, setHelp] = useState<{
    question: string;
    waiting: boolean;
    working?: number;
  } | null>(null);
  // The desktop app's main process sends programs here to be run in the sandboxed frame.
  useEffect(() => window.auroraAI?.onRunCode?.(runCode), []);
  // Requests from other users that this app could help with: shown as a count on Pitch in.
  const [waitingRequests, setWaitingRequests] = useState(0);
  useEffect(() => {
    const bridge = window.auroraAI?.pumasi;
    if (!bridge) return;
    let alive = true;
    const check = async () => {
      try {
        const joined = (await bridge.state()).joined;
        const n = joined ? (await bridge.open()).length : 0;
        if (alive) setWaitingRequests(n);
      } catch {
        // The relay is unreachable: show nothing rather than an error nobody asked for.
      }
    };
    void check();
    const id = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  // What the user has to spend on help: earned by helping others, spent by asking.
  const [points, setPoints] = useState<{ joined: boolean; credits?: number } | null>(null);
  const openHelp = (question: string) => {
    if (help?.waiting) return setNotice(t("이미 도움을 요청하는 중입니다."));
    setHelp({ question, waiting: false });
    setDialog("help");
    setPoints(null);
    window.auroraAI?.pumasi
      ?.state()
      .then((st) => setPoints({ joined: st.joined, credits: st.me?.credits }))
      .catch(() => setPoints(null));
  };
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
  // The sidebar search box filters the conversation list as you type.
  const [search, setSearch] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"current" | "archived" | "trashed">(
    "current",
  );
  const [theme, setTheme] = useState("light");
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const [workers, setWorkers] = useState<Record<string, WorkerRow>>({});
  // What the app is doing with the current question (deciding, parts, checking).
  const [run, setRun] = useState<AskRun>(emptyRun());
  const stoppedByUser = useRef(false);
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
  const shareTitle = auto ? t("하나의 대화") : (legacyChat?.title ?? t("새 세션"));
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
  }, [messages.length, sending]);
  // Follow a streaming answer only while the reader is already at the bottom.
  useEffect(() => {
    const box = end.current?.closest(".conversation");
    if (!streamed || !box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 160)
      end.current?.scrollIntoView({ block: "end" });
  }, [streamed]);
  // When the work is laid out (how it is split, who checks), bring it into view.
  useEffect(() => {
    if (sending) end.current?.scrollIntoView({ block: "end" });
  }, [sending, run.stage, run.parts.length]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (busyRef.current) return;
      if (e.key === "Escape") {
        setDialog(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!dialog) return;
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
  }, [dialog]);
  // Attached files travel with their message, so later questions still see them.
  function context() {
    return (auto ? activeContext(workspace.bundles) : (legacyChat?.messages ?? [])).map(
      (m) => (m.files?.length ? { ...m, text: withFiles(m) } : m),
    );
  }
  async function attach(list: FileList | File[] | null) {
    if (!list) return;
    setAIError("");
    const added: Attachment[] = [];
    for (const file of Array.from(list)) {
      try {
        added.push(await readAttachment(file));
      } catch (error) {
        setAIError(error instanceof Error ? error.message : String(error));
      }
    }
    setFiles((now) => {
      const next = [...now];
      for (const f of added) {
        const total = next.reduce((n, x) => n + x.text.length, 0) + f.text.length;
        if (total > ATTACH_TOTAL) {
          setAIError(t("첨부는 한 질문에 모두 합쳐 40만 자까지입니다."));
          break;
        }
        next.push(f);
      }
      return next;
    });
  }
  // Enter sends. No confirmation step: the model comes from settings (Auto by default).
  function review() {
    const text = draft.trim();
    if (!text || busyRef.current) return;
    setAIError("");
    const model = modelById(routing.executor);
    void proceed({
      text,
      modelId: model.id,
      selected: model.tier,
      files: files.length ? files : undefined,
    });
  }
  async function proceed(p: Pending) {
    if (busyRef.current) return;
    setSending(p.text);
    // The question moves into the conversation right away; a failure puts it back.
    setDraft("");
    setFiles([]);
    // What the model reads: the question with any attached files.
    const asked = withFiles(p);
    let completion: Completion | null = null;
    let team: TeamResult | null = null;
    let how = "";
    let trail: ReturnType<typeof trailOf>;
    if (routing.live && routing.team && routing.pumasi && window.auroraAI?.team) {
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
            t("팀 모드 · Pitch in {done}/{total} 완료 · 돕는 중 {working} · 기다리는 자리 {open}", e),
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
          text: asked,
          context: context(),
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
                ? t(" · Pitch in으로 받은 작업 {count}개", { count: team.pumasiTasks })
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
        setSending(null);
        setDraft(p.text);
        setFiles(p.files ?? []);
        return;
      } finally {
        off?.();
        busyRef.current = false;
        setBusy(false);
      }
    } else if (routing.live) {
      if (!window.auroraAI) {
        setAIError(t("Electron 앱에서 실행해 주세요."));
        setSending(null);
        setDraft(p.text);
        setFiles(p.files ?? []);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setAIError("");
      setStreamed("");
      setRun(emptyRun());
      stoppedByUser.current = false;
      const off = window.auroraAI.onAnswerDelta?.(setStreamed);
      const offProgress = window.auroraAI.onAskProgress?.((e) =>
        setRun((r) => applyProgress(r, e)),
      );
      try {
        if (window.auroraAI.ask) {
          // The app decides how to work: answer directly, split into parts, or solve and check.
          const askedAt = Date.now();
          const r = await window.auroraAI.ask({
            text: asked,
            context: context(),
            model: p.modelId,
            autoOrder: routing.leadOrder.length ? routing.leadOrder : undefined,
            // The modes apply when the app picks the models, not to a model chosen by hand.
            depth: p.modelId === "auto-free" ? routing.depth : undefined,
          });
          // How it was produced and how long it took.
          how = `${howLine(r)} · ${clock(Date.now() - askedAt)}`;
          trail = trailOf(r);
          completion = {
            text: r.text,
            model: r.model ?? p.modelId,
            modelId: r.model,
            inputTokens: r.usage.route.in + r.usage.work.in + r.usage.check.in,
            outputTokens: r.usage.route.out + r.usage.work.out + r.usage.check.out,
            incomplete: !!r.incomplete,
          };
        } else
          completion = await window.auroraAI.request({
            action: "execute",
            model: p.modelId,
            text: asked,
            context: context(),
            maxOutputTokens: 4096,
          });
      } catch (error) {
        if (stoppedByUser.current) setNotice(t("중지했습니다."));
        else
          setAIError(
            error instanceof Error ? error.message : t("API 실행에 실패했습니다."),
          );
        setSending(null);
        setDraft(p.text);
        setFiles(p.files ?? []);
        return;
      } finally {
        off?.();
        offProgress?.();
        setStreamed("");
        setRun(emptyRun());
        busyRef.current = false;
        setBusy(false);
      }
    }
    if (
      completion &&
      typeof completion.inputTokens === "number" &&
      typeof completion.outputTokens === "number"
    )
      setLastUsage({
        model: team
          ? t("팀 합계")
          : modelById(completion.modelId ?? p.modelId).name,
        input: completion.inputTokens,
        output: completion.outputTokens,
      });
    const next = [
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        text: p.text,
        ...(p.files ? { files: p.files } : {}),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        text:
          team
            ? completion!.text
            : completion
              ? completion.incomplete
                ? t("{text}\n\n—\n출력 한도에 닿아 답이 중간에 끊겼을 수 있습니다.", {
                    text: completion.text,
                  })
                : completion.text
              : makePreview(),
        live: !!completion,
        model: completion?.modelId ?? p.modelId,
        ...(how ? { how } : {}),
        ...(trail ? { trail } : {}),
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
      const organized = w.bundles;
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
    setFilter("current");
    setDraft("");
    setSending(null);
    input.current?.focus();
  }
  /** An answer can be sent out for help with the question right before it. */
  const helpFor = (list: Chat["messages"], i: number) => {
    const asked = list[i].role === "assistant" && list[i - 1]?.role === "user" ? list[i - 1].text : "";
    return asked ? () => openHelp(asked) : undefined;
  };
  /** Add one answer to the conversation that is open now. */
  function appendAnswer(message: Chat["messages"][number]) {
    setWorkspace((w) => {
      if (w.mode === "legacy")
        return {
          ...w,
          legacyChats: w.legacyChats.map((c) =>
            c.id === legacyId ? { ...c, messages: [...c.messages, message] } : c,
          ),
        };
      const current = w.bundles.findLast((b) => b.status === "active");
      return {
        ...w,
        bundles: w.bundles.map((b) =>
          b.id === current?.id ? { ...b, messages: [...b.messages, message] } : b,
        ),
      };
    });
  }
  async function sendHelp() {
    const bridge = window.auroraAI?.pumasi;
    if (!help || !bridge) return;
    const question = help.question;
    setDialog(null);
    setHelp({ question, waiting: true });
    const off = bridge.onAskProgress((e) =>
      setHelp((h) => (h?.waiting ? { ...h, working: e.working } : h)),
    );
    const askedAt = Date.now();
    try {
      const r = await bridge.ask(question);
      appendAnswer({
        id: crypto.randomUUID(),
        role: "assistant",
        text: r.text,
        live: true,
        how: `${t("다른 사용자의 Pumasi Agent가 도운 답")} · ${clock(Date.now() - askedAt)}`,
      });
    } catch (error) {
      setNotice(
        String((error as Error)?.message ?? error).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
    } finally {
      off();
      setHelp(null);
    }
  }
  function switchMode(mode: Workspace["mode"]) {
    setWorkspace((w) => ({ ...w, mode }));
    setFilter("current");
    setNotice(
      mode === "legacy"
        ? t("세션 모드: 대화를 세션으로 나눠 직접 관리합니다.")
        : t("하나의 대화 모드: 대화 하나를 계속 이어갑니다."),
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
  // No key that can answer yet: show the key setup instead of a message box that cannot work.
  const needsKey =
    routing.live &&
    statusLoaded &&
    !modelReady(routing.executor, providerStatus) &&
    !(routing.team && modelReady(routing.worker, providerStatus));
  const query = search.trim().toLowerCase();
  const sideItems: Chat[] = (auto ? visible : workspace.legacyChats).filter(
    (c) =>
      !query ||
      `${c.title} ${c.messages.map((m) => m.text).join(" ")}`.toLowerCase().includes(query),
  );
  return (
    <div
      className={`app ${sidebar ? "" : "sidebar-closed"} ${usageOpen ? "" : "usage-closed"} ${MAC_WINDOW ? "mac-window" : ""}`}
    >
      <aside className="sidebar" aria-label={t("사이드바")}>
        <div className="window-space" />
        <div className="brand">
          {/* The app icon: three overlapping circles and a spark. */}
          <svg className="brand-mark" viewBox="0 0 1024 1024" aria-hidden="true">
            <rect x="18" y="18" width="988" height="988" rx="222" fill="currentColor" />
            <g fill="none" stroke="#fffdf6" strokeWidth="58">
              <circle cx="404" cy="604" r="168" />
              <circle cx="620" cy="604" r="168" />
              <circle cx="512" cy="418" r="168" />
            </g>
            <path d="M776 178l25 70 70 25-70 25-25 70-25-70-70-25 70-25z" fill="#e2ebcf" />
          </svg>
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
              <MessageSquare size={17} />
              <span>{t("하나의 대화")}</span>
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
        </nav>
        {appMode === "chat" && (
          <>
        <label className="side-search">
          <Search size={14} />
          <input
            ref={searchBox}
            type="search"
            aria-label={t("대화 검색")}
            placeholder={t("대화 검색")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
          />
          {!search && <kbd>⌘K</kbd>}
        </label>
        {!auto && (
          <div className="section-label">
            <span>{t("세션")}</span>
            <span>{sideItems.length}</span>
          </div>
        )}
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
              {query
                ? t("찾는 대화가 없습니다.")
                : auto
                  ? t("아직 대화가 없습니다.")
                  : t("아직 세션이 없습니다.")}
            </div>
          )}
        </div>
          </>
        )}
        <div className="sidebar-bottom">
          <button className="account" onClick={() => setDialog("settings")}>
            <span>
              <strong>{auto ? t("하나의 대화") : t("세션 모드")}</strong>
              <small>{t("모드 및 데이터 설정")}</small>
            </span>
            {waitingRequests > 0 && (
              <span className="nav-count" title={t("도움을 기다리는 요청 {n}개", { n: waitingRequests })}>
                {waitingRequests}
              </span>
            )}
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
            {appMode === "chat" && messages.length > 0 && (
              // The whole conversation as text: the system share sheet where there is one,
              // otherwise the clipboard.
              <ShareButton
                title={shareTitle}
                text={conversationMarkdown(shareTitle, messages)}
              />
            )}
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
        {needsKey ? (
          <div className="conversation">
            <KeySetup
              onAdded={(message) => {
                setNotice(message);
                void refreshStatus();
              }}
            />
          </div>
        ) : appMode === "code" ? (
          <CodeWorkspace />
        ) : (
          <>
        {workerBoard()}
        <div className="conversation">
          {!messages.length && !sending && !aiError ? (
            <section className="welcome">
              <h1>
                {auto && filter === "current"
                  ? t("무엇을 도와드릴까요?")
                  : auto
                    ? `${t(filter === "archived" ? "보관한" : "휴지통의")} ${t("작업이 없습니다.")}`
                    : t("무엇을 도와드릴까요?")}
              </h1>
              {filter === "current" && (
                <>
                  <p>
                    {t(
                      "질문을 보고 일하는 방식을 정합니다. 양이 많으면 나눠서 동시에 풀고, 계산이 많은 문제는 프로그램을 써서 실행한 값으로 답합니다.",
                    )}
                  </p>
                  <CrewRoster
                    status={providerStatus}
                    order={routing.leadOrder}
                    onAdd={() => setDialog("settings")}
                  />
                </>
              )}
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
                      {b.messages.map((m, i) => (
                        <MessageView key={m.id} message={m} onHelp={helpFor(b.messages, i)} />
                      ))}
                    </section>
                  ))
                : messages.map((m, i) => (
                    <MessageView key={m.id} message={m} onHelp={helpFor(messages, i)} />
                  ))}
              {sending && (
                <>
                  <MessageView
                    message={{ id: "sending", role: "user", text: sending }}
                  />
                  <AskProgressView
                    run={run}
                    writing={Boolean(streamed)}
                    onSkip={(id) => void window.auroraAI?.askControl?.("skip", id)}
                    onFinish={() => void window.auroraAI?.askControl?.("finish")}
                    onHelp={() => openHelp(sending)}
                  />
                  {streamed || finishedText(run) ? (
                    // Finished parts show right away; a single answer shows as it is written.
                    <article className="message assistant">
                      <div className="message-text"><Markdown text={finishedText(run) || streamed} /></div>
                    </article>
                  ) : null}
                </>
              )}
              {aiError && !sending && (
                <p className="api-error" role="alert">
                  {aiError}
                </p>
              )}
              <div ref={end} />
            </section>
          )}
        </div>
        <div className="composer-area">
          {help?.waiting && (
            <p className="help-waiting" role="status">
              <Users size={14} />
              <span>
                {help.working
                  ? t("다른 사용자의 Pumasi Agent가 푸는 중입니다.")
                  : t("도와줄 사람을 기다리는 중입니다.")}
              </span>
              <button type="button" onClick={() => void window.auroraAI?.pumasi?.askCancel()}>
                {t("요청 거두기")}
              </button>
            </p>
          )}
          <div
            className="composer"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void attach(e.dataTransfer.files);
            }}
          >
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
            {files.length > 0 && (
              <div className="attach-chips">
                {files.map((f, i) => (
                  <span className="attach-chip" key={`${f.name}-${i}`}>
                    <FileText size={12} />
                    {f.name}
                    <button
                      type="button"
                      aria-label={t("{name} 빼기", { name: f.name })}
                      onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-toolbar">
              <button
                type="button"
                className="icon-button attach-button"
                aria-label={t("파일 붙이기")}
                title={t("텍스트 파일을 붙입니다. 코드, 문서, 로그, CSV 등")}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={15} />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = "";
                }}
              />
              <ModePicker
                depth={routing.depth}
                single={routing.executor === "auto-free" ? undefined : modelById(routing.executor).name}
                onPick={(depth) => setRouting((r) => ({ ...r, executor: "auto-free", depth }))}
                onModels={() => setDialog("settings")}
              />
              {busy && window.auroraAI?.askControl ? (
                <button
                  className="send-button"
                  aria-label={t("중지")}
                  onClick={() => {
                    stoppedByUser.current = true;
                    void window.auroraAI?.askControl?.("stop");
                  }}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label={t("보내기")}
                  disabled={!draft.trim() || busy}
                  onClick={review}
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-footnote">
            <span>{t("Enter 보내기 · Shift + Enter 줄바꿈")}</span>
          </div>
        </div>
          </>
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
            <div className="data-source">
              <span className="source-dot" />
              {routing.live
                ? t("API 키 모드")
                : t("미리보기 · API 호출 꺼짐")}
            </div>
            <section className="usage-card">
              <div className="usage-card-title">
                <span>{t("마지막 응답")}</span>
              </div>
              {lastUsage ? (
                <>
                  <div className="usage-number">
                    {(lastUsage.input + lastUsage.output).toLocaleString()}
                    <small>{t("토큰")}</small>
                  </div>
                  <p className="small-copy">
                    {t("{model} · 입력 {input} / 출력 {output}. 제공자가 알려 준 숫자입니다.", {
                      model: lastUsage.model,
                      input: lastUsage.input.toLocaleString(),
                      output: lastUsage.output.toLocaleString(),
                    })}
                  </p>
                </>
              ) : (
                <p className="small-copy">
                  {t("응답을 받으면 실제로 쓴 토큰이 여기에 나옵니다. 보내기 전에는 예상하지 않습니다.")}
                </p>
              )}
            </section>
            <div className="next-section">
              <div>
                <strong>{t("문맥")}</strong>
                <p>
                  {t("묶거나 보관한 작업은 다음 요청의")}
                  <br />
                  {t("문맥에서 제외합니다.")}
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
              {t("모드 설정")}
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
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busyRef.current) {
              setDialog(null);
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <header>
              <h2 id="dialog-title">
                {dialog === "pumasi" ? t("Pitch in") : dialog === "help" ? t("Ask for help") : t("설정")}
              </h2>
              <button
                className="icon-button"
                aria-label={t("닫기")}
                disabled={busy}
                onClick={() => {
                  setDialog(null);
                }}
              >
                <X size={18} />
              </button>
            </header>
            {dialog === "help" ? (
              window.auroraAI?.pumasi ? (
                <div className="help-confirm">
                  <p>
                    <strong>{t("이 문제를 다른 사람과 공유하게 됩니다.")}</strong>{" "}
                    {t("다른 사용자가 자기 AI를 써서 도와주게 됩니다. 괜찮나요?")}
                  </p>
                  <p className="small-copy">
                    {t("아래 질문만 나갑니다. 첨부 파일과 앞선 대화는 보내지 않습니다. 이름이나 연락처는 지우고 보내세요.")}
                  </p>
                  <textarea
                    aria-label={t("공유할 질문")}
                    value={help?.question ?? ""}
                    onChange={(e) => setHelp((h) => (h ? { ...h, question: e.target.value } : h))}
                    rows={6}
                  />
                  <p className="small-copy">
                    {t("도와줄 사람이 받으면 그 사람의 Pumasi Agent가 풀어서 답을 돌려줍니다. 10분쯤 걸릴 수 있고, 아무도 받지 않으면 알려 드립니다.")}
                  </p>
                  {points && (
                    <p className="small-copy help-points">
                      {!points.joined
                        ? t("먼저 설정의 \"다른 사용자 돕기\"에서 가입해야 요청할 수 있습니다.")
                        : (points.credits ?? 0) > 0
                          ? t("내 점수 {n}. 도움을 받으면 쓴 만큼 줄고, 다른 사람을 도우면 그만큼 쌓입니다.", { n: (points.credits ?? 0).toLocaleString() })
                          : t("점수가 없습니다. 다른 사람을 도우면 점수가 쌓이고, 그만큼 도움을 요청할 수 있습니다.")}
                    </p>
                  )}
                  <div className="help-confirm-actions">
                    <button type="button" onClick={() => setDialog(null)}>
                      {t("취소")}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!help?.question.trim() || points?.joined === false || points?.credits === 0}
                      onClick={() => void sendHelp()}
                    >
                      {t("공유하고 도움 요청")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="desktop-only">
                  <p>{t("도움 요청은 데스크톱 앱에서만 쓸 수 있습니다.")}</p>
                  <a
                    className="primary-button"
                    href="https://yatko.app/uiwwsw/pumasi-agent"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={16} />
                    {t("데스크톱 앱 받기")}
                  </a>
                </div>
              )
            ) : dialog === "pumasi" ? (
              window.auroraAI?.pumasi ? (
                <PumasiPanel />
              ) : (
                <div className="desktop-only">
                  <p>
                    {t(
                      "Pitch in은 데스크톱 앱에서만 쓸 수 있습니다. 다른 사람의 작업을 받아 푸는 일은 앱이 켜져 있는 동안 내 컴퓨터에서 돌아갑니다.",
                    )}
                  </p>
                  <a
                    className="primary-button"
                    href="https://yatko.app/uiwwsw/pumasi-agent"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={16} />
                    {t("데스크톱 앱 받기")}
                  </a>
                </div>
              )
            ) : (
              <>
                <SecretSettings
                  status={providerStatus}
                  onChanged={() => void refreshStatus()}
                />
                {window.auroraAI?.pumasi && (
                  <details className="routing-settings">
                    <summary>
                      {t("다른 사용자 돕기")}
                      <small>
                        {waitingRequests > 0
                          ? t("도움을 기다리는 요청 {n}개", { n: waitingRequests })
                          : t("도움 요청을 주고받으려면 여기서 가입합니다. 도울 때는 내가 고른 무료 키만 씁니다.")}
                      </small>
                    </summary>
                    <PumasiPanel />
                  </details>
                )}
                <details className="routing-settings">
                  <summary>
                    {t("고급: 모델과 팀")}
                    <small>
                      {t("그대로 두면 알아서 고릅니다. 무료 모델이 먼저 답하고, 무료 한도가 모두 막히면 넣어 둔 유료 키를 씁니다.")}
                    </small>
                  </summary>
                  <label className="setting-row">
                    <span>
                      <strong>{t("답할 모델")}</strong>
                      <small>
                        {t("Pumasi mode는 가장 효율적인 구성으로 여러 모델을 조합해 씁니다. 쉬운 질문은 한 모델이 답하고, 필요할 때 여러 모델이 함께 풉니다. 한 모델만 쓰려면 여기서 고르세요.")}
                      </small>
                    </span>
                    <select
                      aria-label={t("답할 모델")}
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
                        {t("리더가 요청을 작업 여러 개로 나누고 작업 모델이 처리합니다. 토큰을 훨씬 많이 씁니다.")}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={t("팀 모드")}
                      checked={routing.team}
                      onChange={(e) =>
                        setRouting((r) => ({ ...r, team: e.target.checked }))
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
                      <strong>{t("Pitch in에 맡기기")}</strong>
                      <small>
                        {t("팀 모드의 작업을 다른 사람의 앱이 그 사람의 키로 처리합니다. 5분 안에 아무도 돕지 않은 작업은 내 작업 모델이 합니다. 작업 글은 모르는 사람의 AI가 읽으니 개인 정보는 넣지 마세요.")}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={t("Pitch in에 맡기기")}
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
                  <p className="small-copy">
                    {t("OpenAI 키 {openai} · Claude 키 {anthropic} · Gemini 키 {gemini} · 무료 제공자 {compat}. 키는 아래 API 키에서 넣거나 환경 변수로 줄 수 있습니다. 모델 접근 권한은 실제 호출 시 확인됩니다. 모델 설정은 대화 저장과 별도로 이 기기에 유지됩니다.", {
                      openai: providerStatus.openai ? t("감지됨 (미검증)") : t("없음"),
                      anthropic: providerStatus.anthropic ? t("감지됨 (미검증)") : t("없음"),
                      gemini: providerStatus.gemini ? t("감지됨 (미검증)") : t("없음"),
                      compat: providerStatus.compat ? t("연결됨 (미검증)") : t("없음"),
                    })}
                  </p>
                </details>
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
                    <option value="auto">{t("하나의 대화")}</option>
                    <option value="legacy">{t("세션 모드")}</option>
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
function MessageView({
  message,
  onHelp,
}: {
  message: Chat["messages"][number];
  /** Share the question behind this answer with other users. */
  onHelp?: () => void;
}) {
  if (message.role === "user")
    return (
      <article className="message user">
        <div className="message-text">{message.text}</div>
        {message.files?.length ? (
          <div className="attach-chips in-message">
            {message.files.map((f, i) => (
              <span className="attach-chip" key={`${f.name}-${i}`}>
                <FileText size={12} />
                {f.name}
              </span>
            ))}
          </div>
        ) : null}
      </article>
    );
  // Above the answer: who worked on it. Several models: the steps open on a click.
  const crew = [
    ...new Set(
      (message.trail?.map((s) => s.model) ?? [message.model]).filter((id): id is string => !!id),
    ),
  ];
  const line = message.live
    ? message.how || (message.model && modelById(message.model)?.name) || t("API 응답")
    : t("로컬 미리보기");
  const who = (
    <>
      {crew.length > 0 && (
        <span className="token-stack">
          {crew.map((id) => (
            <ModelToken key={id} id={id} />
          ))}
        </span>
      )}
      <span>{line}</span>
    </>
  );
  return (
    <article className="message assistant">
      {message.trail?.length ? (
        <details className="trail">
          <summary className="message-meta">{who}</summary>
          <ol>
            {message.trail.map((s, i) => (
              <li key={i}>
                <ModelToken id={s.model} />
                <span className="trail-label">{s.label}</span>
                <span className="trail-note">
                  {[s.model ? modelById(s.model)?.name : "", s.note].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <div className="message-meta">{who}</div>
      )}
      <div className="message-text">
        <Markdown text={message.text} />
      </div>
      <div className="message-actions">
        <CopyButton text={message.text} label={t("답 복사")} />
        {onHelp && (
          <button
            type="button"
            className="msg-action with-label"
            title={t("이 질문을 다른 사용자에게 보내 도움을 받습니다.")}
            onClick={onHelp}
          >
            <Users size={14} />
            {t("Ask for help")}
          </button>
        )}
      </div>
    </article>
  );
}
// The macOS desktop window draws its close, minimise and zoom buttons over the top-left corner.
const MAC_WINDOW = /Electron/.test(navigator.userAgent) && /Mac/.test(navigator.userAgent);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
