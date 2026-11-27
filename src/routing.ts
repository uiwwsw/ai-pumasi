import catalog from "./catalog.json";
import weights from "./ensemble-weights.json";
import { modelName } from "./i18n";
import type { Tier } from "./domain";
export type Provider =
  "openai" | "anthropic" | "gemini" | "ollama" | "compat" | "auto";
export type Model = {
  id: string;
  name: string;
  provider: Provider;
  tier: Tier;
  free?: boolean;
  /** Free hosts that serve this model, and the model name each one uses. */
  hosts?: Record<string, string>;
};
export const models = (catalog as Model[]).map((m) => ({
  ...m,
  name: modelName(m.name),
}));
export const modelById = (id: string) => models.find((m) => m.id === id)!;
export const ROUTING_KEY = "aurora.routing.v1";
export type RoutingSettings = {
  analyzer: string;
  executor: string;
  live: boolean;
  team: boolean;
  lead: string;
  /** With the automatic lead: the user's own lead ranking. Empty = measured order. */
  leadOrder: string[];
  worker: string;
  /** Team mode hands its tasks to other people's apps first (Pumasi). */
  pumasi: boolean;
  pumasiCopies: number;
};
const weightOf = (id: string) =>
  (weights.models as Record<string, number>)[id] ?? weights.default ?? 0;
/** Free models that can lead with the automatic lead, in measured order (strongest first). */
export const leadCandidates = models
  .filter((m) => m.free === true && m.provider !== "auto" && m.provider !== "ollama")
  .sort((a, b) => weightOf(b.id) - weightOf(a.id));
/** The lead ranking to show: the user's order first, then the rest in measured order. */
export function leadRanking(order: string[]) {
  const ids = [...order, ...leadCandidates.map((m) => m.id)];
  return [...new Set(ids)]
    .map((id) => leadCandidates.find((m) => m.id === id))
    .filter((m): m is (typeof models)[number] => !!m);
}
const teamDefaults = {
  team: false,
  pumasi: false,
  pumasiCopies: 2,
  // The free model ranked first leads; no paid model is needed.
  lead: "auto-free",
  leadOrder: [] as string[],
  worker: "gemini-flash-latest",
};
export const presets: Record<"openai" | "anthropic", RoutingSettings> = {
  openai: {
    analyzer: "gpt-6-luna",
    executor: "auto-free",
    live: false,
    ...teamDefaults,
  },
  anthropic: {
    analyzer: "claude-haiku-5-5",
    executor: "claude-sonnet-5-5",
    live: false,
    ...teamDefaults,
  },
};
export function readRouting(raw: string | null): RoutingSettings {
  try {
    const d = JSON.parse(raw ?? "null");
    if (
      d &&
      models.some((m) => m.id === d.analyzer) &&
      models.some((m) => m.id === d.executor) &&
      typeof d.live === "boolean"
    )
      return {
        ...teamDefaults,
        ...d,
        team: d.team === true,
        pumasi: d.pumasi === true,
        pumasiCopies: [1, 2, 3].includes(d.pumasiCopies) ? d.pumasiCopies : 2,
        lead: models.some((m) => m.id === d.lead) ? d.lead : teamDefaults.lead,
        leadOrder: Array.isArray(d.leadOrder)
          ? [...new Set(d.leadOrder as unknown[])].filter(
              (id): id is string =>
                typeof id === "string" && leadCandidates.some((m) => m.id === id),
            )
          : [],
        worker: models.some((m) => m.id === d.worker)
          ? d.worker
          : teamDefaults.worker,
      };
  } catch {}
  return { ...presets.openai };
}
export type FreeHost = "nvidia" | "groq" | "openrouter" | "google" | "custom";
export type ProviderStatus = Record<Provider, boolean> & {
  /** Per free model: whether any host with a key can serve it now. */
  models?: Record<string, boolean>;
  hosts?: Partial<Record<FreeHost, boolean>>;
};
/** Whether this model can be called with the keys present. */
export function modelReady(id: string, status: ProviderStatus) {
  const m = modelById(id);
  if (!m) return false;
  if (m.provider === "compat") return !!(status.models?.[id] ?? status.compat);
  return !!status[m.provider];
}
export type SecretName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY"
  | "NVIDIA_API_KEY"
  | "GROQ_API_KEY"
  | "OPENROUTER_API_KEY"
  | "AURORA_OPENAI_COMPAT_KEY";
/** What the window may know about saved keys: set or not, and when. Never the value. */
export type SecretsState = {
  encryption: boolean;
  keys: Record<
    SecretName,
    { set: boolean; savedAt?: string | null; stale?: boolean }
  >;
  compatUrl: string;
  /** Web version: keys live in this browser's storage, not in an OS keychain. */
  browser?: boolean;
  /** Keys this version cannot use (a provider that refuses calls from web pages). */
  unusable?: SecretName[];
};
export type Completion = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  incomplete: boolean;
  /** With Auto: the model that actually answered. */
  modelId?: string;
};
export type Analysis = Completion & {
  summary: string;
  reason: string;
  recommendedModel: string;
};
export type AIRequest = {
  action: "analyze" | "execute";
  model: string;
  text: string;
  context: { role: "user" | "assistant"; text: string }[];
  maxOutputTokens: number;
};
export type TeamProgress =
  | { stage: "pumasi"; open: number; working: number; done: number; total: number }
  | {
      stage: "plan" | "work" | "review" | "merge" | "done";
      round?: number;
      index?: number;
      total?: number;
      title?: string;
      model?: string;
    }
  | {
      stage: "worker";
      taskId: string;
      title?: string;
      round?: number;
      state:
        | "waiting"
        | "running"
        | "retry"
        | "switch"
        | "substituted"
        | "done"
        | "failed";
      model?: string;
      from?: string;
      attempt?: number;
      startedAt?: number;
      timeoutMs?: number;
      elapsedMs?: number;
      reason?:
        | "timeout"
        | "rate-limit"
        | "server"
        | "network"
        | "error"
        | "empty"
        | "short"
        | "truncated";
      servedBy?: string;
      partial?: boolean;
      message?: string;
    };
export type TeamResult = {
  text: string;
  /** Tasks other people's apps answered. */
  pumasiTasks?: number;
  goal: string;
  tasks: { id: string; title: string; failed: boolean; incomplete: boolean }[];
  rounds: number;
  approved: boolean;
  warning: string;
  workersUsed: string[];
  usage: Record<"lead" | "worker", { in: number; out: number }>;
  lead: string;
  /** The model that actually led (with the automatic lead). */
  leadModel?: string;
  /** The runner-up's check, asked only when the lead was not sure. */
  secondOpinion?: { model: string; approved: boolean } | null;
  worker: string;
  substitutions?: { requested: string; servedBy: string | null }[];
};
/** Free hosts whose key a helper may lend to Pumasi. Paid keys are never lent. */
export type PumasiHost = "nvidia" | "groq" | "openrouter" | "google";
export const PUMASI_HOSTS: PumasiHost[] = ["nvidia", "openrouter", "groq", "google"];
export type PumasiState = {
  server: string;
  joined: boolean;
  donate: Partial<Record<PumasiHost, boolean>>;
  dailyCap: number;
  usedToday: number;
  /** Which hosts have a saved key on this device. */
  keys: Record<PumasiHost, boolean>;
  /** Points from the relay, when it answered. */
  me?: { credits: number; helped: number; used: number };
  /** Why the relay could not be reached, if it could not. */
  error?: string;
};
export type CodeFolder = { root: string; name: string };
/** What the code agent did, step by step. File text and command output come from the user's folder. */
export type AgentEvent =
  | { type: "thinking"; step: number }
  | { type: "draft"; text: string }
  | { type: "say"; text: string; model?: string }
  | { type: "tool"; id: number; kind: "list" | "read" | "search"; path?: string; query?: string; count?: number; lines?: number }
  | { type: "tool-error"; id: number; kind: string; arg: string; error: string }
  | { type: "edit"; id: number; path: string; before: string; after: string; existed?: boolean }
  | { type: "edit-done"; id: number; saved: boolean }
  | { type: "run"; id: number; command: string }
  | { type: "run-done"; id: number; code?: number | null; output?: string; declined?: boolean }
  | { type: "stopped" }
  | { type: "limit"; steps: number }
  | { type: "done"; usage: { in: number; out: number }; steps: number };
export type CodeEntry = { path: string; name: string; dir: boolean };
export type PumasiSlot = { slotId: string; size: number; postedAt: number };
/** What a helper's window may know: states and token counts, never the task or the result. */
export type PumasiProgress = {
  slotId: string;
  state: "claimed" | "working" | "done";
  tokens?: number;
};
export type AskResult = {
  text: string;
  mode: "direct" | "split" | "roles";
  effort: "low" | "mid" | "high";
  model?: string;
  incomplete?: boolean;
  parts?: { title: string; model: string | null; failed: boolean; skipped: boolean; incomplete: boolean }[];
  check?: { model: string; verdict: "right" | "wrong" | "unsure"; revised: boolean } | null;
  usage: Record<"route" | "work" | "check", { in: number; out: number }>;
};
/** What is happening right now while a question is being answered. */
export type AskProgress =
  | { stage: "route" }
  | { stage: "plan"; mode: AskResult["mode"]; effort: AskResult["effort"]; parts?: string[] }
  | {
      stage: "part";
      id: string;
      title: string;
      state: "waiting" | "running" | "retry" | "switch" | "substituted" | "done" | "failed" | "skipped";
      model?: string;
      from?: string;
      reason?: string;
      startedAt?: number;
      text?: string;
      partial?: boolean;
      message?: string;
    }
  /** The model's own reasoning so far for one part ("answer" when there is a single answer). */
  | { stage: "think"; id: string; text: string }
  | { stage: "check"; model: string }
  | { stage: "revise"; model: string }
  | { stage: "done" };
export interface AIBridge {
  /** Code mode: files inside the one folder the user picked. */
  code?: {
    open(): Promise<CodeFolder | null>;
    current(): Promise<CodeFolder | null>;
    list(rel: string): Promise<CodeEntry[]>;
    read(rel: string): Promise<{ path: string; text: string; size: number }>;
    run(payload: {
      text: string;
      history: { role: "user" | "assistant"; text: string }[];
      model?: string;
      autoOrder?: string[];
    }): Promise<{ usage: { in: number; out: number }; steps: number }>;
    answer(id: number, allow: boolean, all?: boolean): Promise<void>;
    undo(id: number): Promise<boolean>;
    gitStatus(): Promise<{ state: string; path: string }[] | null>;
    gitDiff(rel: string): Promise<string>;
    stop(): Promise<void>;
    onEvent(fn: (e: AgentEvent) => void): () => void;
  };
  pumasi?: {
    state(): Promise<PumasiState>;
    update(patch: {
      server?: string;
      donate?: Partial<Record<PumasiHost, boolean>>;
      dailyCap?: number;
    }): Promise<PumasiState>;
    join(invite: string): Promise<PumasiState>;
    open(): Promise<PumasiSlot[]>;
    help(slotId: string): Promise<{ tokens: number }>;
    onProgress(fn: (e: PumasiProgress) => void): () => void;
  };
  team?(payload: {
    lead: string;
    worker: string;
    text: string;
    context: AIRequest["context"];
    maxRounds?: number;
    /** Send tasks to other people's apps first; each task goes to this many helpers. */
    pumasi?: { copies: number };
    /** With lead "auto-free": the user's lead ranking. */
    leadOrder?: string[];
  }): Promise<TeamResult>;
  onTeamProgress?(fn: (e: TeamProgress) => void): () => void;
  onAnswerDelta?(fn: (text: string) => void): () => void;
  /** Ask a question; the app decides whether to answer directly, split it, or solve and check. */
  ask?(payload: {
    text: string;
    context: AIRequest["context"];
    model: string;
    autoOrder?: string[];
  }): Promise<AskResult>;
  askControl?(action: "stop" | "finish" | "skip", partId?: string): Promise<void>;
  onAskProgress?(fn: (e: AskProgress) => void): () => void;

  status(): Promise<ProviderStatus>;
  setLang?(lang: "ko" | "en"): Promise<void>;
  secrets?: {
    list(): Promise<SecretsState>;
    set(name: SecretName, value: string): Promise<SecretsState>;
    /** Sign in on openrouter.ai and keep the key it gives back (desktop: resolves when done). */
    openRouterLogin?(): Promise<SecretsState>;
    openRouterCancel?(): Promise<void>;
    /** Web: the outcome of a sign-in that just returned to this page, once. */
    openRouterResult?(): Promise<{ saved: boolean; error?: string } | null>;
    /** Paste any key: the provider is worked out from its shape and the key is checked first. */
    add?(value: string): Promise<{
      name: SecretName;
      provider: string;
      check: "ok" | "unknown";
      state: SecretsState;
    }>;
    remove(name: SecretName): Promise<SecretsState>;
    setCompatUrl(url: string): Promise<SecretsState>;
    openSignup(
      host: FreeHost | "gemini" | "openai" | "anthropic",
    ): Promise<void>;
  };
  request(payload: AIRequest): Promise<Completion | Analysis>;
}
declare global {
  interface Window {
    auroraAI?: AIBridge;
  }
}
