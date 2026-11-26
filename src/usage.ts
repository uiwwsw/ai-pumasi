import { estimate, outputRanges } from "./domain";
import type { Estimate, Message, Tier } from "./domain";
import type { Model } from "./routing";

export type UsageKind =
  "execute" | "analyze" | "plan" | "work" | "review" | "merge";

export type UsageRecord = {
  model: string;
  kind: UsageKind;
  inputChars: number;
  inputTokens: number;
  outputTokens: number;
  at: number;
};

export type TeamRun = {
  lead: string;
  worker: string;
  plan: number;
  work: number;
  review: number;
  merge: number;
  at: number;
};

export type UsageHistory = {
  enabled: boolean;
  records: UsageRecord[];
  runs: TeamRun[];
};

export const MIN_SAMPLES = 5;

export function inputChars(
  prompt: string,
  context: { text: string }[],
): number {
  let total = prompt.length;
  for (const c of context) {
    total += c.text.length;
  }
  return total;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const n = sorted.length;
  const pos = (n - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export type CallGuess = {
  input: [number, number];
  output: [number, number];
  median: number;
  samples: number;
};

function linearRegression(
  x: number[],
  y: number[],
): { a: number; b: number } | null {
  const n = x.length;
  if (n < 2) return null;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumXX = x.reduce((a, b) => a + b * b, 0);
  const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

function calcPercent(
  total: [number, number],
  budget: number | null,
): [number, number] | null {
  return budget !== null && Number.isFinite(budget) && budget > 0
    ? [(total[0] / budget) * 100, (total[1] / budget) * 100]
    : null;
}

export function inferCall(
  history: UsageHistory | null,
  model: string,
  kind: UsageKind,
  chars: number | null,
  fallback: { input: number; output: [number, number] },
): CallGuess {
  if (!history || !history.enabled) {
    const median = Math.round((fallback.output[0] + fallback.output[1]) / 2);
    return {
      input: [fallback.input, fallback.input],
      output: fallback.output,
      median,
      samples: 0,
    };
  }

  const matching = history.records.filter(
    (r) => r.model === model && r.kind === kind,
  );

  if (matching.length < MIN_SAMPLES) {
    const median = Math.round((fallback.output[0] + fallback.output[1]) / 2);
    return {
      input: [fallback.input, fallback.input],
      output: fallback.output,
      median,
      samples: 0,
    };
  }

  const sorted = [...matching].sort((a, b) => a.at - b.at);
  const recent = sorted.slice(-200);
  const samples = recent.length;

  let inputRange: [number, number];

  if (chars !== null && chars > 0) {
    const x = recent.map((r) => r.inputChars);
    const y = recent.map((r) => r.inputTokens);

    const maxX = Math.max(...x);
    const minX = Math.min(...x);
    const meanX = x.reduce((a, b) => a + b, 0) / x.length;
    const rangeRatio = (maxX - minX) / meanX;

    const reg = linearRegression(x, y);
    const useRatio = !reg || rangeRatio < 0.1 || reg.b <= 0 || reg.a < 0;

    if (useRatio) {
      const sumTokens = y.reduce((a, b) => a + b, 0);
      const sumChars = x.reduce((a, b) => a + b, 0);
      const ratio = sumTokens / sumChars;
      const value = Math.max(1, Math.ceil(ratio * chars));
      inputRange = [value, value];
    } else {
      const value = Math.max(1, Math.ceil(reg.a + reg.b * chars));
      inputRange = [value, value];
    }
  } else {
    const inputTokensSorted = [...recent.map((r) => r.inputTokens)].sort(
      (a, b) => a - b,
    );
    inputRange = [
      Math.ceil(quantile(inputTokensSorted, 0.2)),
      Math.ceil(quantile(inputTokensSorted, 0.8)),
    ];
  }

  const outputTokensSorted = [...recent.map((r) => r.outputTokens)].sort(
    (a, b) => a - b,
  );
  const output: [number, number] = [
    Math.ceil(quantile(outputTokensSorted, 0.2)),
    Math.ceil(quantile(outputTokensSorted, 0.8)),
  ];
  const median = Math.ceil(quantile(outputTokensSorted, 0.5));

  return { input: inputRange, output, median, samples };
}

export type StageLine = {
  kind: UsageKind;
  role: "lead" | "worker";
  model: string;
  calls: [number, number];
  total: [number, number];
  samples: number;
};

export type Projection = Estimate & {
  median: number;
  basis: "history" | "default" | "mixed";
  samples: number;
  stages: StageLine[];
};

export function project(
  prompt: string,
  context: Message[],
  budget: number | null,
  model: Model,
  history: UsageHistory | null,
): Projection {
  const base = estimate(prompt, context, budget, model.tier);
  const chars = inputChars(prompt, context);
  const g = inferCall(history, model.id, "execute", chars, {
    input: base.input,
    output: base.output,
  });

  const input = g.input[0];
  const output = g.output;
  const total: [number, number] = [input + output[0], input + output[1]];
  const median = input + g.median;
  const basis = g.samples > 0 ? "history" : "default";

  const stages: StageLine[] = [
    {
      kind: "execute",
      role: "worker",
      model: model.id,
      calls: [1, 1],
      total,
      samples: g.samples,
    },
  ];

  return {
    tier: base.tier,
    reason: base.reason,
    input,
    output,
    total,
    percent: calcPercent(total, budget),
    median,
    basis,
    samples: g.samples,
    stages,
  };
}

export function projectTeam(
  prompt: string,
  context: Message[],
  budget: number | null,
  lead: Model,
  worker: Model,
  history: UsageHistory | null,
): Projection {
  const base = estimate(prompt, context, budget, lead.tier);
  const chars = inputChars(prompt, context);

  const plan = inferCall(history, lead.id, "plan", chars, {
    input: base.input + 150,
    output: [300, 1500],
  });
  const work = inferCall(history, worker.id, "work", null, {
    input: 600,
    output: outputRanges[worker.tier],
  });
  const review = inferCall(history, lead.id, "review", null, {
    input: 3000,
    output: [80, 400],
  });
  const merge = inferCall(history, worker.id, "merge", null, {
    input: 3000,
    output: outputRanges[worker.tier],
  });

  let planCalls: [number, number] = [1, 1];
  let workCalls: [number, number] = [2, 4];
  let reviewCalls: [number, number] = [1, 2];
  let mergeCalls: [number, number] = [0, 1];

  if (history && history.enabled && history.runs.length > 0) {
    const matchingRuns = history.runs.filter(
      (r) => r.lead === lead.id && r.worker === worker.id,
    );
    const runs =
      matchingRuns.length >= MIN_SAMPLES ? matchingRuns : history.runs;

    if (runs.length >= MIN_SAMPLES) {
      const workVals = runs.map((r) => r.work).sort((a, b) => a - b);
      const reviewVals = runs.map((r) => r.review).sort((a, b) => a - b);
      const mergeVals = runs.map((r) => r.merge).sort((a, b) => a - b);

      workCalls = [
        Math.floor(quantile(workVals, 0.2)),
        Math.ceil(quantile(workVals, 0.8)),
      ];
      reviewCalls = [
        Math.floor(quantile(reviewVals, 0.2)),
        Math.ceil(quantile(reviewVals, 0.8)),
      ];
      mergeCalls = [
        Math.floor(quantile(mergeVals, 0.2)),
        Math.ceil(quantile(mergeVals, 0.8)),
      ];
    }
  }

  const stagePlans: {
    kind: UsageKind;
    role: "lead" | "worker";
    model: string;
    calls: [number, number];
    guess: CallGuess;
  }[] = [
    {
      kind: "plan",
      role: "lead",
      model: lead.id,
      calls: planCalls,
      guess: plan,
    },
    {
      kind: "work",
      role: "worker",
      model: worker.id,
      calls: workCalls,
      guess: work,
    },
    {
      kind: "review",
      role: "lead",
      model: lead.id,
      calls: reviewCalls,
      guess: review,
    },
    {
      kind: "merge",
      role: "worker",
      model: worker.id,
      calls: mergeCalls,
      guess: merge,
    },
  ];

  const stages: StageLine[] = stagePlans.map((s) => {
    const c0 = s.calls[0];
    const c1 = s.calls[1];
    const in0 = s.guess.input[0];
    const out0 = s.guess.output[0];
    const in1 = s.guess.input[1];
    const out1 = s.guess.output[1];
    return {
      kind: s.kind,
      role: s.role,
      model: s.model,
      calls: s.calls,
      total: [c0 * (in0 + out0), c1 * (in1 + out1)],
      samples: s.guess.samples,
    };
  });

  // input = Σ calls0*in0, output = [Σ calls0*out0, Σ calls1*out1], total = Σ stage.total
  let inputSum = 0;
  let outputSum0 = 0;
  let outputSum1 = 0;
  let medianSum = 0;
  let totalSamples = 0;

  for (const s of stagePlans) {
    const c0 = s.calls[0];
    const c1 = s.calls[1];
    inputSum += c0 * s.guess.input[0];
    outputSum0 += c0 * s.guess.output[0];
    outputSum1 += c1 * s.guess.output[1];
    const avgCalls = (c0 + c1) / 2;
    medianSum += avgCalls * (s.guess.input[0] + s.guess.median);
    totalSamples += s.guess.samples;
  }

  const input = inputSum;
  const output: [number, number] = [outputSum0, outputSum1];
  // total = Σ stage.total = [Σ calls0*(in0+out0), Σ calls1*(in1+out1)]
  const total: [number, number] = [
    stages.reduce((sum, s) => sum + s.total[0], 0),
    stages.reduce((sum, s) => sum + s.total[1], 0),
  ];
  const allSamplesZero = stages.every((s) => s.samples === 0);
  const basis: "history" | "default" | "mixed" = allSamplesZero
    ? "default"
    : stages.every((s) => s.samples > 0)
      ? "history"
      : "mixed";

  const percent = calcPercent(total, budget);

  return {
    tier: base.tier,
    reason: base.reason,
    input,
    output,
    total,
    percent,
    median: medianSum,
    basis,
    samples: totalSamples,
    stages,
  };
}
