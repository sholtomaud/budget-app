/**
 * Rolling-origin backtest and method choice (SPEC §10.1): every candidate is
 * refitted at each origin and scored on the next h months by MASE (point)
 * and pinball loss (quantiles from the residual bootstrap).
 */
import { Rng } from '../../lib/prng.ts';
import { bootstrapPaths, pathQuantiles } from './bootstrap.ts';
import { mase, pinball, QUANTILES } from './stats.ts';
import { METHODS, zeroShare, type Method } from './methods.ts';

export interface Score {
  method: string;
  mase: number;
  pinball: number;
  origins: number;
}

export function candidates(y: Float64Array): string[] {
  const intermittent = zeroShare(y) >= 0.3;
  return intermittent
    ? ['seasonal-naive', 'mean', 'croston', 'sba', 'tsb']
    : ['seasonal-naive', 'mean', 'ets'];
}

export function backtest(
  y: Float64Array,
  method: Method,
  opts: { m: number; h: number; minTrain: number; seed: bigint }
): Score & { method: string } {
  const n = y.length;
  let maseSum = 0;
  let pinSum = 0;
  let count = 0;
  let name = '';
  const rng = new Rng(opts.seed);
  for (let o = opts.minTrain; o + 1 <= n; o++) {
    const h = Math.min(opts.h, n - o);
    const train = y.subarray(0, o);
    const test = y.subarray(o, o + h);
    const fit = method(train, h, opts.m);
    name = fit.method;
    const s = mase(test, fit.forecast, train, opts.m);
    if (!Number.isFinite(s)) continue;
    maseSum += s;
    const q = pathQuantiles(bootstrapPaths(fit, h, 200, rng), h);
    for (let i = 0; i < h; i++) {
      QUANTILES.forEach((qq, k) => (pinSum += pinball(test[i]!, q[k]![i]!, qq)));
    }
    count++;
  }
  return {
    method: name,
    mase: count ? maseSum / count : Infinity,
    pinball: count ? pinSum / count : Infinity,
    origins: count,
  };
}

/** Choose by backtest MASE; ties go to the simpler method (earlier in the candidate list). */
export function choose(
  y: Float64Array,
  opts: { m: number; h: number; minTrain: number; seed: bigint }
): { chosen: string; scores: Score[] } {
  const scores = candidates(y).map((k) => ({ ...backtest(y, METHODS[k]!, opts), method: k }));
  let best = scores[0]!;
  for (const s of scores) if (s.mase < best.mase - 1e-12) best = s;
  return { chosen: best.method, scores };
}
