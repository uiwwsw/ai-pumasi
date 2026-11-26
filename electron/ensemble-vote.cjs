// Answer extraction, normalization and the weighted vote for bundle mode.
// Ported from bench/reasoning/solve.mjs (tally, normFor) so the app votes the way the bench did.
const TABLE = require("../src/ensemble-weights.json");

const ANSWER_LINE =
  /^\s*[*_#>\-\s]*(?:정답|최종\s*답|answer|final\s*answer)\s*[*_]*\s*[:：]\s*(.+)$/i;
// Longer units first so "시간" is not read as "간" after stripping "시".
const UNITS = [
  "입니다",
  "이다",
  "시간",
  "명",
  "개",
  "원",
  "분",
  "초",
  "번",
  "점",
  "살",
  "일",
  "년",
  "회",
  "다",
];

/** The last boxed{...} content with balanced braces, or "". */
function lastBoxed(text) {
  const at = text.lastIndexOf("\\boxed{");
  if (at < 0) return "";
  const start = at + 7;
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0)
      return text.slice(start, i).trim();
  }
  return "";
}

/** The final answer a reply commits to: its last "정답:" line, else its last boxed{}, else "". */
function extractAnswer(text) {
  const s = String(text ?? "");
  let found = null;
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(ANSWER_LINE);
    if (m) found = m[1];
  }
  if (found === null) return lastBoxed(s);
  return found
    .trim()
    .replace(/[.。]+$/, "")
    .replace(/^[*_`\s]+|[*_`\s]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim();
}

/** A comparison key: two answers with the same key count as the same vote. */
function normalizeAnswer(s) {
  let r = String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/\$/g, "");
  const letter = r.match(/^\(?([a-e])\)?\.?$/) ?? r.match(/^\(?([a-e])\)\s+\S/);
  if (letter) return letter[1];
  r = r.replace(/[\s*`<>"'“”‘’]/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "");
  for (const u of UNITS)
    if (r.length > u.length && r.endsWith(u)) {
      r = r.slice(0, -u.length);
      break;
    }
  r = r.replace(/[.。]+$/, "");
  if (/^-?\d+$/.test(r)) {
    const neg = r.startsWith("-");
    r = (neg ? "-" : "") + r.replace(/^-?0+(?=\d)/, "").replace(/^-/, "");
  } else if (/^-?\d+\.\d+$/.test(r))
    r = r.replace(/0+$/, "").replace(/\.$/, "");
  return r;
}

/** Measured weight of a model, or the table's small default for models never measured. */
function weightOf(modelId, table = TABLE) {
  const w = table?.models?.[modelId];
  if (Number.isFinite(w) && w >= 0) return w;
  return Number.isFinite(table?.default) ? table.default : 0.1;
}

/**
 * Weighted vote over normalized answers. Ties go to more votes, then to the earlier model.
 * @param {{model:string, answer:string, failed?:boolean}[]} runs in the user's order
 */
function tally(runs, { weight = weightOf } = {}) {
  const groups = new Map();
  let voters = 0;
  (runs ?? []).forEach((r, i) => {
    if (!r || r.failed || !String(r.answer ?? "").trim()) return;
    voters++;
    const key = normalizeAnswer(r.answer);
    const g = groups.get(key) ?? {
      key,
      answer: r.answer,
      models: [],
      count: 0,
      score: 0,
      first: i,
    };
    g.models.push(r.model);
    g.count++;
    g.score += weight(r.model);
    groups.set(key, g);
  });
  const sorted = [...groups.values()].sort(
    (a, b) => b.score - a.score || b.count - a.count || a.first - b.first,
  );
  const win = sorted[0];
  return {
    answer: win?.answer ?? "",
    key: win?.key ?? "",
    agree: win?.count ?? 0,
    voters,
    score: win ? Number(win.score.toFixed(3)) : 0,
    groups: sorted,
  };
}

module.exports = { extractAnswer, normalizeAnswer, weightOf, tally };
