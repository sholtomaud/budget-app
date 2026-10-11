/**
 * The optimiser (FR-OPT-001, SPEC §11.4): "what would make this 90 % likely?"
 *
 * It searches the levers the user unlocked, inside their bounds, for the
 * smallest change from the current setup (Euclidean distance in each lever's
 * range, 0…1) that reaches the target pSuccess. Up to two levers: a coarse
 * grid, then a finer grid around the best point. More: CMA-ES (ml-core in the
 * app). Every candidate is simulated with the same seeds (common random
 * numbers), so differences between candidates are the levers', not noise.
 * All evaluated candidates also give a Pareto set over pSuccess, spending
 * after freedom and when freedom starts.
 */
import { Rng } from '../lib/prng.ts';
import type { FreedomSetup } from '../sim/inputs.ts';
import { defaultLambda } from './ref/cmaes.ts';
import { applyLevers, baseValues, type LeverSpec, type LeverValues } from './levers.ts';

export interface Evaluation {
  pSuccess: number;
  /** Cites the simulation: inputs hash, seed and run range. */
  runId: string;
}

export interface Candidate {
  values: LeverValues;
  /** Position in the unlocked levers' ranges, 0…1 each. */
  x: number[];
  pSuccess: number;
  distance: number;
  feasible: boolean;
  runId: string;
  setup: FreedomSetup;
}

export interface OptimiseResult {
  method: 'grid' | 'cma-es';
  target: number;
  base: Candidate;
  /** The feasible candidate nearest the current setup, or null if none reached the target. */
  best: Candidate | null;
  pareto: Candidate[];
  candidates: Candidate[];
}

/** Async CMA-ES, so the app can run it in the forecast worker on ml-core. */
export interface AsyncCma {
  init(x0: Float64Array, sigma0: number, lambda: number): Promise<Float64Array>;
  ask(state: Float64Array, z: Float64Array): Promise<Float64Array>;
  tell(state: Float64Array, x: Float64Array, f: Float64Array): Promise<Float64Array>;
}

export interface OptimiseRequest {
  setup: FreedomSetup;
  levers: LeverSpec[];
  target: number;
  /** Simulations allowed (candidates evaluated), beyond the base. */
  budget?: number;
  /** Seed for CMA-ES's own draws. */
  seed?: string;
}

export interface OptimiseDeps {
  evaluate(setup: FreedomSetup): Promise<Evaluation>;
  cma: AsyncCma;
  onProgress?(done: number, total: number, best: Candidate | null): void;
  /** Return true to stop early (the user cancelled). */
  cancelled?(): boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export async function optimise(req: OptimiseRequest, deps: OptimiseDeps): Promise<OptimiseResult> {
  const { setup, levers, target } = req;
  if (!levers.length) throw new Error('Unlock at least one lever to optimise.');
  const k = levers.length;
  const base = baseValues(setup);
  const xb = levers.map((l) => (l.hi > l.lo ? (base[l.id] - l.lo) / (l.hi - l.lo) : 0));
  const budget = req.budget ?? (k <= 2 ? 60 : 80);
  const cache = new Map<string, Candidate>();
  const all: Candidate[] = [];
  let best: Candidate | null = null;
  let done = 0;

  const valuesAt = (x: number[]): LeverValues => {
    const v = { ...base };
    levers.forEach((l, i) => (v[l.id] = l.lo + clamp01(x[i]!) * (l.hi - l.lo)));
    return v;
  };
  const distance = (x: number[]) =>
    Math.sqrt(x.reduce((a, v, i) => a + (clamp01(v) - xb[i]!) ** 2, 0));

  const evaluate = async (xRaw: number[], isBase = false): Promise<Candidate> => {
    const x = isBase ? xRaw : xRaw.map(clamp01);
    const key = x.map((v) => v.toFixed(4)).join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    const values = isBase ? base : valuesAt(x);
    const s = isBase ? setup : applyLevers(setup, values);
    const e = await deps.evaluate(s);
    const c: Candidate = {
      values,
      x,
      pSuccess: e.pSuccess,
      distance: isBase ? 0 : distance(x),
      feasible: e.pSuccess >= target,
      runId: e.runId,
      setup: s,
    };
    cache.set(key, c);
    all.push(c);
    if (c.feasible && (!best || c.distance < best.distance)) best = c;
    done++;
    deps.onProgress?.(done, budget + 1, best);
    return c;
  };

  const baseCandidate = await evaluate(xb, true);
  let method: OptimiseResult['method'] = 'grid';

  if (!baseCandidate.feasible) {
    if (k <= 2) {
      // Coarse grid over the box, then a finer one around the best point.
      const g = k === 1 ? Math.min(budget, 13) : Math.max(3, Math.floor(Math.sqrt(budget * 0.6)));
      const coarse = gridPoints(k, g);
      for (const x of coarse) {
        if (deps.cancelled?.()) break;
        await evaluate(x);
      }
      const centre =
        (best as Candidate | null)?.x ?? nearestToTarget(all, target)?.x ?? xb.map(clamp01);
      const step = 1 / (g - 1);
      const left = budget - coarse.length;
      const f =
        k === 1
          ? Math.min(9, Math.max(3, left))
          : Math.max(3, Math.floor(Math.sqrt(Math.max(9, left))));
      for (const x of gridPoints(k, f)) {
        if (deps.cancelled?.()) break;
        await evaluate(x.map((v, i) => centre[i]! + (v - 0.5) * 2 * step));
      }
    } else {
      method = 'cma-es';
      const lambda = defaultLambda(k);
      const rng = new Rng(req.seed ?? setup.seed);
      let state = await deps.cma.init(Float64Array.from(xb.map(clamp01)), 0.25, lambda);
      const gens = Math.max(1, Math.floor(budget / lambda));
      for (let gen = 0; gen < gens && !deps.cancelled?.(); gen++) {
        const z = Float64Array.from({ length: lambda * k }, () => rng.normal());
        const xs = await deps.cma.ask(state, z);
        const f = new Float64Array(lambda);
        for (let j = 0; j < lambda; j++) {
          const raw = Array.from(xs.subarray(j * k, (j + 1) * k));
          const c = await evaluate(raw);
          const outside = raw.reduce((a, v) => a + Math.abs(v - clamp01(v)), 0);
          // Distance, a steep penalty below the target, and a pull back into the box.
          f[j] = c.distance + 4 * Math.max(0, target - c.pSuccess) + outside;
        }
        state = await deps.cma.tell(state, xs, f);
      }
    }
  } else {
    best = baseCandidate;
  }

  return {
    method,
    target,
    base: baseCandidate,
    best,
    pareto: pareto(all),
    candidates: all,
  };
}

/** Evenly spaced points in [0, 1]^k, g per dimension. */
export function gridPoints(k: number, g: number): number[][] {
  const axis = Array.from({ length: g }, (_, i) => (g === 1 ? 0.5 : i / (g - 1)));
  let out: number[][] = [[]];
  for (let d = 0; d < k; d++) out = out.flatMap((p) => axis.map((a) => [...p, a]));
  return out;
}

function nearestToTarget(cs: Candidate[], target: number): Candidate | undefined {
  return [...cs].sort(
    (a, b) =>
      Math.abs(a.pSuccess - target) - Math.abs(b.pSuccess - target) || a.distance - b.distance
  )[0];
}

/**
 * Non-dominated candidates over (pSuccess ↑, spending after freedom ↑,
 * freedom start ↓), earliest start first.
 */
export function pareto(cs: Candidate[]): Candidate[] {
  const dominates = (a: Candidate, b: Candidate) =>
    a.pSuccess >= b.pSuccess &&
    a.values.tierSpend >= b.values.tierSpend &&
    a.values.start <= b.values.start &&
    (a.pSuccess > b.pSuccess ||
      a.values.tierSpend > b.values.tierSpend ||
      a.values.start < b.values.start);
  const front = cs.filter((c) => !cs.some((o) => o !== c && dominates(o, c)));
  const seen = new Set<string>();
  return front
    .filter((c) => {
      const key = `${c.pSuccess}|${c.values.tierSpend}|${c.values.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.values.start - b.values.start || b.pSuccess - a.pSuccess);
}
