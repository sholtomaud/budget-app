/**
 * "Run my plan" (FR-OPT-002, FR-OPT-007, ADR 0032): one step that does what
 * the Freedom screen's separate buttons did, in order of how quickly each
 * part answers, and keeps a dated record of every run.
 *
 *   1. the chance of success (the main simulation);
 *   2. the plan checks (ADR 0026);
 *   3. the chance at the other tiers;
 *   4. what drives shortfalls;
 *   5. the freedom number at the target, and the years to reach it;
 *   6. the earliest freedom date, with a safer and a spend-less plan (ADR 0031).
 *
 * The Freedom screen and the AI's run_my_plan tool both call `runFullPlan`,
 * so they give the same answer. Records hold results, not the simulated
 * paths: the capital fan is kept yearly. They live in the vault with the
 * household (export, delete-all), the newest 20.
 */
import { roughAmount } from '../api/redact.ts';
import { chanceWords, dollars, percent } from '../assistant/phrases.ts';
import { canonicalJson, sha256Hex } from '../lib/hash.ts';
import type { DataView } from '../data/service.ts';
import { earliestFreedom, type EarliestPlanId } from '../optimise/earliest.ts';
import type { FreedomSetup } from '../sim/inputs.ts';
import {
  deterministicFreedom,
  p90Freedom,
  projectRunway,
  shortfallDrivers,
  yearsToFreedom,
} from '../sim/metrics.ts';
import type { Scenario, SpendingInput } from '../sim/model.ts';
import { evaluator, inputsFor, runIdOf } from './freedom-inputs.ts';
import { planChecks } from './insights.ts';
import { poolRunner, runPool, type PoolResult, type RunRecord } from './sim-pool.ts';
import { sim } from './workers.ts';

export const PLAN_STEPS = [
  'chance',
  'checks',
  'tiers',
  'drivers',
  'freedom-number',
  'earliest',
] as const;
export type PlanStep = (typeof PLAN_STEPS)[number];

export const STEP_WORDS: Record<PlanStep, [running: string, done: string]> = {
  chance: ['Running your plan', 'Ran your plan'],
  checks: ['Checking your settings', 'Checked your settings'],
  tiers: ['Trying the other tiers', 'Tried the other tiers'],
  drivers: ['Finding what drives shortfalls', 'Found what drives shortfalls'],
  'freedom-number': ['Finding your freedom number', 'Found your freedom number'],
  earliest: ['Searching for the earliest date', 'Searched for the earliest date'],
};

export interface PlanRun {
  id: string;
  at: string;
  /** Hash of everything the simulation used: tells whether a run is out of date. */
  inputsHash: string;
  record: RunRecord;
  runId: string;
  goal: { tier: string; start: string; horizonYears: number; target: number; floor: number };
  pSuccess: number;
  validRuns: number;
  invalidRuns: number;
  /** Steps that finished; a stopped run keeps what it had. */
  done: PlanStep[];
  checks?: { level: 'problem' | 'note'; text: string }[];
  tiers?: { id: string; pSuccess: number; runs: number }[];
  drivers?: { label: string; pSuccess: number; delta: number }[];
  freedomNumber?: {
    deterministic: number;
    annualNeed: number;
    withdrawalRate: number;
    atTarget: number | null;
    atTargetChance: number | null;
    atTargetRuns: number;
  };
  yearsToFreedom?: { p10: number | null; p50: number | null; p90: number | null; reached: number };
  runwayMonths?: number;
  earliest?: {
    current: { start: string; pSuccess: number };
    plans: {
      id: EarliestPlanId;
      start: string;
      months: number;
      tierSpend: number;
      pSuccess: number;
      target: number;
      runId: string;
      setup: FreedomSetup;
    }[];
    latest?: { start: string; pSuccess: number };
    simulations: number;
  };
  /** Capital in today's dollars, one point a year: months from the start, and quantiles. */
  capital: { months: number[]; q: Record<'p5' | 'p25' | 'p50' | 'p75' | 'p95', number[]> };
  months: number;
  /** The month the simulation starts (now), YYYY-MM. */
  asOf: string;
}

export interface RunOptions {
  runs: number;
  /** Called as each step starts and ends, with the run so far. */
  onStep?: (step: PlanStep, state: 'running' | 'done', run: PlanRun) => void;
  /** Progress inside a step, in words. */
  onProgress?: (text: string) => void;
  /** Return true to stop after the current step. */
  stopped?: () => boolean;
}

export interface FullRun {
  run: PlanRun;
  /** The main simulation in full (example paths, the reproducibility record), for the screen. */
  main: PoolResult;
  scenario: Scenario;
  spending: SpendingInput;
}

/** The same hash the simulation pool records, for the current inputs. */
export async function currentInputsHash(v: DataView, setup: FreedomSetup): Promise<string> {
  const { scenario, spending } = await inputsFor(v, setup);
  return sha256Hex(canonicalJson({ scenario, spending, freeze: null, scale: 1 }));
}

const yearly = (xs: readonly number[]) => xs.filter((_, i) => i % 12 === 0 || i === xs.length - 1);

export async function runFullPlan(
  v: DataView,
  setup: FreedomSetup,
  opts: RunOptions
): Promise<FullRun> {
  const { scenario, spending } = await inputsFor(v, setup);
  const target = scenario.goal.targetProbability;
  const main = await runPool({ scenario, spending, runs: opts.runs, keepCapital: true }, (d, t) =>
    opts.onProgress?.(`${d.toLocaleString('en-AU')} of ${t.toLocaleString('en-AU')} futures`)
  );
  const idx = main.capital.p50.map((_, i) => i);
  const run: PlanRun = {
    id: `run-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    inputsHash: main.record.inputsHash,
    record: main.record,
    runId: runIdOf(main),
    goal: {
      tier: scenario.goal.tier,
      start: scenario.goal.start.slice(0, 7),
      horizonYears: scenario.goal.horizonYears,
      target,
      floor: Number(scenario.goal.floor) / 100,
    },
    pSuccess: main.pSuccess,
    validRuns: main.runs - main.invalidRuns,
    invalidRuns: main.invalidRuns,
    done: ['chance'],
    capital: {
      months: yearly(idx),
      q: {
        p5: yearly(main.capital.p5),
        p25: yearly(main.capital.p25),
        p50: yearly(main.capital.p50),
        p75: yearly(main.capital.p75),
        p95: yearly(main.capital.p95),
      },
    },
    months: main.months,
    asOf: scenario.asOf.slice(0, 7),
  };
  opts.onStep?.('chance', 'done', run);
  const finish = (s: PlanStep) => {
    run.done.push(s);
    opts.onStep?.(s, 'done', run);
  };
  const full = (): FullRun => ({ run, main, scenario, spending });
  if (opts.stopped?.()) return full();

  opts.onStep?.('checks', 'running', run);
  run.checks = (await planChecks(v, setup)).map((c) => ({ level: c.level, text: c.text }));
  const d = deterministicFreedom(scenario, spending);
  run.runwayMonths = projectRunway(scenario, spending);
  finish('checks');
  if (opts.stopped?.()) return full();

  opts.onStep?.('tiers', 'running', run);
  const n = Math.min(opts.runs, 200);
  run.tiers = [{ id: scenario.goal.tier, pSuccess: main.pSuccess, runs: opts.runs }];
  for (const t of v.budget.tiers) {
    if (t.id === scenario.goal.tier) continue;
    const other = await inputsFor(v, setup, t.id);
    const r = await poolRunner({ ...other, runs: n, keepCapital: false });
    run.tiers.push({ id: t.id, pSuccess: r.pSuccess, runs: n });
  }
  finish('tiers');
  if (opts.stopped?.()) return full();

  opts.onStep?.('drivers', 'running', run);
  run.drivers = (await shortfallDrivers(scenario, spending, main, poolRunner, { runs: 200 })).map(
    (x) => ({ label: x.label, pSuccess: x.pSuccess, delta: x.delta })
  );
  finish('drivers');
  if (opts.stopped?.()) return full();

  opts.onStep?.('freedom-number', 'running', run);
  const f = await p90Freedom(scenario, spending, poolRunner, { runs: 200, target });
  run.freedomNumber = {
    deterministic: d.freedomNumber,
    annualNeed: d.annualNeed,
    withdrawalRate: d.withdrawalRate,
    atTarget: f.capital,
    atTargetChance: f.pSuccess,
    atTargetRuns: f.runs,
  };
  if (f.capital !== null) {
    const y = await yearsToFreedom(scenario, spending, f.capital, poolRunner, { runs: 200 });
    run.yearsToFreedom = { p10: y.p10, p50: y.p50, p90: y.p90, reached: y.reached };
  }
  finish('freedom-number');
  if (opts.stopped?.()) return full();

  opts.onStep?.('earliest', 'running', run);
  const e = await earliestFreedom(
    { setup, target, soonest: scenario.asOf },
    {
      evaluate: evaluator(v, 200),
      onProgress: (k) => opts.onProgress?.(`${k} start dates tried`),
    }
  );
  run.earliest = {
    current: { start: e.current.start, pSuccess: e.current.pSuccess },
    plans: e.plans.map((p) => ({
      id: p.id,
      start: p.start,
      months: p.months,
      tierSpend: p.tierSpend,
      pSuccess: p.pSuccess,
      target: p.target,
      runId: p.runId,
      setup: p.setup,
    })),
    ...(e.latest ? { latest: { start: e.latest.start, pSuccess: e.latest.pSuccess } } : {}),
    simulations: e.simulations,
  };
  finish('earliest');
  return full();
}

/** The newest runs are kept; older ones drop off. */
export const KEEP_RUNS = 20;

export async function loadRuns(): Promise<PlanRun[]> {
  return ((await sim().loadKv('plan-runs')) as PlanRun[] | null) ?? [];
}

export async function saveRun(run: PlanRun): Promise<PlanRun[]> {
  const list = [...(await loadRuns()).filter((r) => r.id !== run.id), structuredClone(run)].slice(
    -KEEP_RUNS
  );
  await sim().saveKv('plan-runs', list);
  return list;
}

/** The run before `run` in the history, to show what changed. */
export function previousRun(list: readonly PlanRun[], run: PlanRun): PlanRun | undefined {
  const i = list.findIndex((r) => r.id === run.id);
  return i > 0 ? list[i - 1] : undefined;
}

/**
 * A run as the AI sees it (FR-API-003): chances as percentages, money
 * rounded, dates as months. The same facts whether the run was fresh or kept.
 */
export function runFacts(r: PlanRun, tierName: (id: string) => string = (id) => id) {
  const f = r.freedomNumber;
  const y = r.yearsToFreedom;
  const yrs = (x: number | null) => (x === null ? 'not reached' : `${x.toFixed(1)} years`);
  return {
    ranAt: r.at,
    runId: r.runId,
    finished:
      r.done.length === PLAN_STEPS.length ? 'every step' : `stopped after: ${r.done.join(', ')}`,
    goal: {
      tier: tierName(r.goal.tier),
      freedomStarts: r.goal.start,
      yearsOfFreedom: r.goal.horizonYears,
      target: percent(r.goal.target),
      floor: roughAmount(r.goal.floor),
    },
    chanceOfSuccess: percent(r.pSuccess),
    meetsTarget: r.pSuccess >= r.goal.target,
    futures: r.validRuns,
    ...(r.checks?.length ? { planChecks: r.checks.map((c) => `${c.level}: ${c.text}`) } : {}),
    ...(r.tiers
      ? {
          byTier: r.tiers.map((t) => ({
            tier: tierName(t.id),
            chance: percent(t.pSuccess),
            runs: t.runs,
          })),
        }
      : {}),
    ...(r.drivers
      ? {
          shortfallDrivers: r.drivers.map((d) => ({
            input: d.label,
            chanceIfCertain: percent(d.pSuccess),
            change: `${d.delta >= 0 ? '+' : '−'}${Math.abs(d.delta * 100).toFixed(1)} points`,
          })),
        }
      : {}),
    ...(f
      ? {
          freedomNumber: {
            simple: roughAmount(f.deterministic),
            atTarget:
              f.atTarget === null ? 'not reachable below $1 billion' : roughAmount(f.atTarget),
          },
        }
      : {}),
    ...(y
      ? { yearsToFreedomNumber: { typical: yrs(y.p50), range80: `${yrs(y.p10)} to ${yrs(y.p90)}` } }
      : {}),
    ...(r.earliest
      ? {
          earliest: {
            currentStart: r.earliest.current.start,
            datesSearched: r.earliest.simulations,
            plans: r.earliest.plans.map((p) => ({
              plan:
                p.id === 'target'
                  ? 'earliest at the target'
                  : p.id === 'safer'
                    ? 'safer margin'
                    : 'spend less after freedom',
              freedomStarts: p.start,
              chance: percent(p.pSuccess),
              ...(p.id === 'spend-less'
                ? { spendingAfterFreedom: `${percent(p.tierSpend)} of the tier` }
                : {}),
              runId: p.runId,
            })),
            ...(r.earliest.plans.length
              ? {}
              : {
                  note: `no start date up to ${r.earliest.latest?.start ?? r.earliest.current.start} reaches the target`,
                }),
          },
        }
      : {}),
  };
}

/** A full run in words, for the chat (built-in, no AI). */
export function fullRunText(r: PlanRun, tierName: (id: string) => string = (id) => id): string {
  const target = r.goal.target;
  const lines = [
    `Your plan works **${chanceWords(r.pSuccess)}** (${percent(r.pSuccess)}); your target is ${percent(target)}. That is the ${tierName(r.goal.tier)} tier, freedom from ${r.goal.start}, for ${r.goal.horizonYears} years. Run \`${r.runId}\``,
  ];
  const problems = r.checks?.filter((c) => c.level === 'problem') ?? [];
  for (const c of problems) lines.push(`**Check this:** ${c.text}`);
  const top = r.drivers?.slice().sort((a, b) => b.delta - a.delta)[0];
  if (top && top.delta > 0.005)
    lines.push(
      `The biggest source of risk is **${top.label.toLowerCase()}**: if it were certain, the plan would work in ${percent(top.pSuccess)} of futures.`
    );
  const f = r.freedomNumber;
  if (f?.atTarget != null)
    lines.push(
      `To reach your target you'd need about **${dollars(f.atTarget)}** at the start${r.yearsToFreedom?.p50 != null ? `, typically about ${r.yearsToFreedom.p50.toFixed(0)} years away if you keep saving as now` : ''}.`
    );
  const e = r.earliest;
  if (e?.plans.length) {
    const p = e.plans[0]!;
    lines.push(
      `The earliest it reaches ${percent(p.target)} is **${p.start}** (you have ${e.current.start} now).`
    );
  } else if (e)
    lines.push(
      `No start date up to ${e.latest?.start ?? e.current.start} reaches the target; spending less after freedom or project income would help. Ask "what would make it work?"`
    );
  lines.push('The full results, and every earlier run, are on the Freedom screen under History.');
  return lines.join('\n\n');
}
