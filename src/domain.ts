import type { EnsembleResult } from "./routing";
import { t } from "./i18n";
export type Tier = "light" | "standard" | "advanced";
export const tierNames: Record<Tier, string> = {
  light: t("경량"),
  standard: t("표준"),
  advanced: t("고성능"),
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: string;
  live?: boolean;
  /** Bundle vote details shown folded under the answer. */
  ensemble?: Omit<EnsembleResult, "text">;
};
export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  tier: Tier;
};
export type Bundle = Chat & {
  status: "active" | "grouped" | "archived" | "trashed";
};
export type Workspace = {
  version: 2;
  mode: "auto" | "legacy";
  bundles: Bundle[];
  legacyChats: Chat[];
  save: boolean;
};
export const STORAGE_KEY = "aurora.workspace.v2";
export const LEGACY_KEY = "aurora.workspace.v1";
export function emptyWorkspace(): Workspace {
  return {
    version: 2,
    mode: "auto",
    bundles: [],
    legacyChats: [],
    save: false,
  };
}
export function remainingPercent(used: number | null): number | null {
  return used === null || !Number.isFinite(used)
    ? null
    : Math.max(0, Math.min(100, 100 - used));
}
export function resetText(at: number | null, now: number): string {
  if (at === null) return t("초기화 시각 확인 안 됨");
  const minutes = Math.ceil((at - now) / 60000);
  if (minutes <= 0) return t("초기화 확인 필요");
  if (minutes >= 1440)
    return t("{d}일 {h}시간 후 초기화", {
      d: Math.floor(minutes / 1440),
      h: Math.floor((minutes % 1440) / 60),
    });
  return minutes >= 60
    ? t("{h}시간 {m}분 후 초기화", {
        h: Math.floor(minutes / 60),
        m: minutes % 60,
      })
    : t("{m}분 후 초기화", { m: minutes });
}
export function organize(
  bundles: Bundle[],
  id: string,
  action: "grouped" | "archived" | "trashed",
): Bundle[] {
  return bundles.map((b) => (b.id === id ? { ...b, status: action } : b));
}
export function activeContext(bundles: Bundle[]): Message[] {
  return bundles
    .filter((b) => b.status === "active")
    .flatMap((b) => b.messages);
}
function validChat(item: unknown): item is Chat {
  if (!item || typeof item !== "object") return false;
  const c = item as Chat;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    ["light", "standard", "advanced"].includes(c.tier) &&
    Array.isArray(c.messages) &&
    c.messages.every(
      (m) =>
        m &&
        typeof m.id === "string" &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.text === "string",
    )
  );
}
export function parseStoredChats(raw: string | null): Chat[] {
  try {
    const data: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(data) ? data.filter(validChat) : [];
  } catch {
    return [];
  }
}
export function restoreWorkspace(
  raw: string | null,
  legacy: string | null,
): Workspace {
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (
        d.version === 2 &&
        ["auto", "legacy"].includes(d.mode) &&
        Array.isArray(d.bundles) &&
        d.bundles.every(
          (b: Bundle) =>
            validChat(b) &&
            ["active", "grouped", "archived", "trashed"].includes(b.status),
        ) &&
        Array.isArray(d.legacyChats) &&
        d.legacyChats.every(validChat) &&
        typeof d.save === "boolean"
      ) {
        // Older versions kept a planning token budget here; it is no longer used.
        const { budget: _unused, ...rest } = d;
        return rest;
      }
    } catch {
      /* Keep migration source intact when storage is corrupt. */
    }
  }
  const old = parseStoredChats(legacy);
  return {
    ...emptyWorkspace(),
    legacyChats: old,
    save: old.length > 0,
    mode: old.length ? "legacy" : "auto",
  };
}
export function makePreview(): string {
  return t(
    "웹 데모라 AI에 보내지 않았습니다. 데스크톱 앱에 키를 넣으면 실제 모델이 답합니다.",
  );
}
