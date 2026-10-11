/** Empirical residual bootstrap for forecast quantiles (SPEC §10.1). */
import type { Rng } from '../../lib/prng.ts';
import { kernels } from '../kernels.ts';
import type { Fit } from './methods.ts';

/**
 * Sample paths: the point forecast plus resampled one-step residuals that
 * partly persist, so uncertainty widens with the horizon. Spending can't be
 * negative, so paths are floored at zero. Draws one seed from `rng` and runs
 * the bootstrap kernel on a fresh stream from it, so TS and ml-core agree.
 */
export function bootstrapPaths(fit: Fit, _h: number, nPaths: number, rng: Rng): Float64Array {
  return kernels().bootstrapPaths(fit.forecast, fit.residuals, nPaths, rng.nextU64());
}

/** Quantile paths (one array per QUANTILES entry, each h long) from sample paths laid out run-major. */
export function pathQuantiles(paths: Float64Array, h: number): Float64Array[] {
  return kernels().pathQuantiles(paths, h);
}
