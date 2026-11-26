// Code mode, in the window: how a proposed change differs from the file on disk.

export type DiffLine = {
  kind: "same" | "add" | "del";
  text: string;
};

export function diffLines(
  before: string,
  after: string,
  maxLines = 1500
): { lines: DiffLine[]; added: number; removed: number; truncated: boolean } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  if (beforeLines.length > 0 && beforeLines[beforeLines.length - 1] === "") {
    beforeLines.pop();
  }
  if (afterLines.length > 0 && afterLines[afterLines.length - 1] === "") {
    afterLines.pop();
  }

  // Most edits touch a few lines: diff only the middle that differs, so the table stays small.
  let head = 0;
  while (
    head < beforeLines.length &&
    head < afterLines.length &&
    beforeLines[head] === afterLines[head]
  )
    head++;
  let tail = 0;
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  )
    tail++;
  const prefix = beforeLines.slice(0, head);
  const suffix = beforeLines.slice(beforeLines.length - tail);
  beforeLines.splice(beforeLines.length - tail, tail);
  beforeLines.splice(0, head);
  afterLines.splice(afterLines.length - tail, tail);
  afterLines.splice(0, head);
  const m = beforeLines.length;
  const n = afterLines.length;
  const same = (text: string) => ({ kind: "same" as const, text });
  // Too much changed for a line table: show the changed middle as removed, then added.
  if (m > maxLines || n > maxLines)
    return {
      lines: [
        ...prefix.map(same),
        ...beforeLines.map((text) => ({ kind: "del" as const, text })),
        ...afterLines.map((text) => ({ kind: "add" as const, text })),
        ...suffix.map(same),
      ],
      added: n,
      removed: m,
      truncated: true,
    };

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = m;
  let j = n;
  let added = 0;
  let removed = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      lines.unshift({ kind: "same", text: beforeLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.unshift({ kind: "add", text: afterLines[j - 1] });
      added++;
      j--;
    } else {
      lines.unshift({ kind: "del", text: beforeLines[i - 1] });
      removed++;
      i--;
    }
  }

  return {
    lines: [
      ...prefix.map((text) => ({ kind: "same" as const, text })),
      ...lines,
      ...suffix.map((text) => ({ kind: "same" as const, text })),
    ],
    added,
    removed,
    truncated: false,
  };
}