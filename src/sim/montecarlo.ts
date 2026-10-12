/**
 * Monte-Carlo runner (SPEC §11.2): one GSSK_Init per scenario variant, then
 * GSSK_Reset per run. Run i uses seed deriveSeed(scenario.seed, 'run', i)
 * for every sampled input, so a chunk of runs gives the same answers in any
 * worker, in any order (NFR-DET-001), and any run can be re-executed exactly
 * (FR-SIM-004).
 */
import { deriveSeed, parseSeed } from '../lib/prng.ts';
import {
  quantileSorted,
  QUANTILE_KEYS,
  QUANTILES,
  type QuantileKey,
} from '../forecast/ref/stats.ts';
import { makePlan, runOnce, wire, type Freeze, type RunSummary } from './controller.ts';
import type { GsskKernel } from './gssk.ts';
import type { Scenario, SpendingInput } from './model.ts';
import { modelgen } from './modelgen.ts';

export const DEFAULT_RUNS = 1000;
export const EXAMPLE_PATHS = 20;

export interface ChunkRequest {
  scenario: Scenario;
  spending: SpendingInput;
  /** Run indices [from, to). */
  from: number;
  to: number;
  freeze?: Freeze;
  /** Multiply every holding's opening value (freedom-number bisection). */
  holdingScale?: number;
  /** Record when real capital first reaches this (years to freedom). */
  crossing?: number;
  /** Keep whole capital paths (default: all runs of the chunk). */
  keepCapital?: boolean;
}

export interface ChunkResult {
  from: number;
  to: number;
  months: number;
  summaries: RunSummary[];
  /** Real capital per run per month, row-major [(to − from) × (months + 1)]. */
  capital: Float64Array | null;
  modelJson: string;
  ms: number;
}

export function runSeed(scenario: Scenario, i: number): bigint {
  return deriveSeed(parseSeed(scenario.seed), 'run', i);
}

export function runChunk(kernel: GsskKernel, req: ChunkRequest): ChunkResult {
  const t0 = performance.now();
  const { json, layout } = modelgen(req.scenario, { holdingScale: req.holdingScale });
  const plan = makePlan(req.scenario, req.spending, layout, { crossing: req.crossing });
  const inst = kernel.init(json);
  try {
    const w = wire(inst, layout);
    const n = req.to - req.from;
    const keep = req.keepCapital ?? true;
    const capital = keep ? new Float64Array(n * (layout.months + 1)) : null;
    const summaries: RunSummary[] = [];
    for (let i = req.from; i < req.to; i++) {
      if (i > req.from) inst.reset();
      const out = runOnce(plan, w, i, runSeed(req.scenario, i), req.freeze);
      summaries.push(out.summary);
      capital?.set(out.capital, (i - req.from) * (layout.months + 1));
    }
    return {
      from: req.from,
      to: req.to,
      months: layout.months,
      summaries,
      capital,
      modelJson: json,
      ms: performance.now() - t0,
    };
  } finally {
    inst.free();
  }
}

/** Split [0, runs) into `parts` contiguous chunks. */
export function chunks(runs: number, parts: number): [number, number][] {
  const p = Math.max(1, Math.min(parts, runs));
  const out: [number, number][] = [];
  for (let k = 0; k < p; k++) {
    const a = Math.floor((k * runs) / p);
    const b = Math.floor(((k + 1) * runs) / p);
    if (b > a) out.push([a, b]);
  }
  return out;
}

export interface SimResult {
  runs: number;
  months: number;
  pSuccess: number;
  invalidRuns: number;
  /** Real capital quantiles per month (index 0 = opening). */
  capital: Record<QuantileKey, number[]>;
  /** The first EXAMPLE_PATHS runs, whole. */
  examples: { run: number; success: boolean; capital: number[] }[];
  summaries: RunSummary[];
  maxDrift: number;
  ms: number;
}

/** Merge chunk results (in any order) into the scenario's metrics. */
export function combine(parts: ChunkResult[]): SimResult {
  const sorted = [...parts].sort((a, b) => a.from - b.from);
  const months = sorted[0]?.months ?? 0;
  const summaries = sorted.flatMap((p) => p.summaries);
  const runs = summaries.length;
  const width = months + 1;
  const capital = Object.fromEntries(QUANTILE_KEYS.map((k) => [k, [] as number[]])) as Record<
    QuantileKey,
    number[]
  >;
  const column = new Float64Array(runs);
  const rows = sorted.filter((p) => p.capital);
  if (rows.length === sorted.length) {
    for (let t = 0; t < width; t++) {
      let r = 0;
      for (const p of rows) {
        const c = p.capital!;
        const n = p.to - p.from;
        for (let i = 0; i < n; i++) column[r++] = c[i * width + t]!;
      }
      column.sort();
      QUANTILE_KEYS.forEach((k, qi) => capital[k].push(quantileSorted(column, QUANTILES[qi]!)));
    }
  }
  const examples: SimResult['examples'] = [];
  for (const p of rows) {
    for (let i = p.from; i < p.to && i < EXAMPLE_PATHS; i++) {
      const off = (i - p.from) * width;
      examples.push({
        run: i,
        success: p.summaries[i - p.from]!.success,
        capital: Array.from(p.capital!.subarray(off, off + width)),
      });
    }
  }
  const valid = summaries.filter((s) => s.valid);
  // With no valid run there is no result: say so rather than report 0 %.
  if (runs > 0 && !valid.length) throw new NoValidRunsError(runs);
  return {
    runs,
    months,
    pSuccess: valid.length ? valid.filter((s) => s.success).length / valid.length : 0,
    invalidRuns: runs - valid.length,
    capital,
    examples,
    summaries,
    maxDrift: summaries.reduce((m, s) => Math.max(m, s.maxDrift), 0),
    ms: parts.reduce((m, p) => Math.max(m, p.ms), 0),
  };
}

/** Every run failed the money-balance check: a fault in the inputs or the model, not a result. */
export class NoValidRunsError extends Error {
  constructor(runs: number) {
    super(
      `None of the ${runs.toLocaleString('en-AU')} simulated futures passed the money-balance check, so there is no result to show. This is a fault in the app, not a verdict on your plan.`
    );
    this.name = 'NoValidRunsError';
  }
}

/** Run everything in this thread (tests, and the worker's per-chunk entry). */
export function simulate(
  kernel: GsskKernel,
  scenario: Scenario,
  spending: SpendingInput,
  opts: { runs?: number; freeze?: Freeze; holdingScale?: number; crossing?: number } = {}
): SimResult {
  const runs = opts.runs ?? DEFAULT_RUNS;
  return combine([runChunk(kernel, { scenario, spending, from: 0, to: runs, ...opts })]);
}
