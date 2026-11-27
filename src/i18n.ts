// UI language. Korean source strings are the keys; English comes from src/i18n/en-*.json.
// Placeholders look like {name} and are filled from the second argument.
import main from "./i18n/en-main.json";
import ensemble from "./i18n/en-ensemble.json";
import secrets from "./i18n/en-secrets.json";
import domain from "./i18n/en-domain.json";
import electron from "./i18n/en-electron.json";
import pumasi from "./i18n/en-pumasi.json";
import code from "./i18n/en-code.json";

export type Lang = "ko" | "en";
export const LANG_KEY = "aurora.lang";
const EN: Record<string, string> = {
  ...electron,
  ...pumasi,
  ...code,
  ...domain,
  ...secrets,
  ...ensemble,
  ...main,
};

function detect(): Lang {
  // Outside a window (tests, build scripts) the Korean source text is used.
  if (typeof window === "undefined") return "ko";
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {}
  const nav = typeof navigator === "undefined" ? "ko" : navigator.language;
  return /^ko\b/i.test(nav ?? "") ? "ko" : "en";
}
let lang: Lang = detect();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export const getLang = () => lang;
/** Save the choice and reload so every screen is drawn in the new language. */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {}
  lang = next;
  if (typeof location !== "undefined") location.reload();
}
export function t(ko: string, vars?: Record<string, string | number>) {
  const s = lang === "en" ? (EN[ko] ?? ko) : ko;
  return vars
    ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
    : s;
}
export const appName = () => (lang === "en" ? "Pumasi Agent" : "품앗이 에이전트");

/** Model names from the catalog in the current language: "(무료)" -> "(free)" and so on. */
export function modelName(name: string) {
  if (lang !== "en") return name;
  return name
    .replace(/^자동$/, "Auto")
    .replace("(무료 한도)", "(free tier)")
    .replace("Ollama 로컬", "Ollama local")
    .replace("(무료)", "(free)");
}

// The desktop window takes its title from the UI language; the web pages keep their own.
if (typeof document !== "undefined" && typeof window !== "undefined" && window.auroraAI)
  document.title = appName();
