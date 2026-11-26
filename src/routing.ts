import catalog from "./catalog.json";
import type { Tier } from "./domain";
import type { UsageHistory } from "./usage";
export type Provider = "openai" | "anthropic" | "gemini" | "ollama";
export type Model = {
  id: string;
  name: string;
  provider: Provider;
  tier: Tier;
  free?: boolean;
};
export const models = catalog as Model[];
export const modelById = (id: string) => models.find((m) => m.id === id)!;
export const ROUTING_KEY = "aurora.routing.v1";
export type RoutingSettings = {
  analyzer: string;
  executor: string;
  live: boolean;
  team: boolean;
  lead: string;
  worker: string;
};
const teamDefaults = {
  team: false,
  lead: "claude-opus-5-5",
  worker: "gemini-flash-latest",
};
export const presets: Record<"openai" | "anthropic", RoutingSettings> = {
  openai: {
    analyzer: "gpt-6-luna",
    executor: "gpt-6.1-sol",
    live: false,
    ...teamDefaults,
    lead: "gpt-6-astra",
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
        lead: models.some((m) => m.id === d.lead) ? d.lead : teamDefaults.lead,
        worker: models.some((m) => m.id === d.worker)
          ? d.worker
          : teamDefaults.worker,
      };
  } catch {}
  return { ...presets.openai };
}
export type ProviderStatus = Record<Provider, boolean>;
export type Completion = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  incomplete: boolean;
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
  goal: string;
  tasks: { id: string; title: string; failed: boolean; incomplete: boolean }[];
  rounds: number;
  approved: boolean;
  warning: string;
  workersUsed: string[];
  usage: Record<"lead" | "worker", { in: number; out: number }>;
  lead: string;
  worker: string;
  substitutions?: { requested: string; servedBy: string | null }[];
};
export interface AIBridge {
  team?(payload: {
    lead: string;
    worker: string;
    text: string;
    context: AIRequest["context"];
    maxRounds?: number;
  }): Promise<TeamResult>;
  onTeamProgress?(fn: (e: TeamProgress) => void): () => void;
  usage?: {
    get(): Promise<UsageHistory>;
    setEnabled(enabled: boolean): Promise<UsageHistory>;
    clear(): Promise<UsageHistory>;
  };
  status(): Promise<ProviderStatus>;
  request(payload: AIRequest): Promise<Completion | Analysis>;
}
declare global {
  interface Window {
    auroraAI?: AIBridge;
  }
}
