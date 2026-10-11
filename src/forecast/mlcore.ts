/**
 * Loader for ml-core.wasm: raw exports over f64 buffers, no wasm-bindgen
 * (ADR 0007). All pointer handling lives here.
 */
import type { Kernels, RunResult } from './kernels.ts';

interface Exports {
  memory: WebAssembly.Memory;
  mc_version(): number;
  mc_alloc(n: number): number;
  mc_free(ptr: number, n: number): void;
  mc_quantile_sorted(p: number, n: number, q: number): number;
  mc_mase(a: number, f: number, n: number, t: number, tn: number, m: number): number;
  mc_pinball(a: number, p: number, q: number): number;
  mc_ets_run(
    y: number,
    n: number,
    h: number,
    m: number,
    alpha: number,
    beta: number,
    gamma: number,
    phi: number,
    seasonal: number,
    outF: number,
    outR: number
  ): number;
  mc_croston_run(
    y: number,
    n: number,
    h: number,
    alpha: number,
    beta: number,
    variant: number,
    outF: number,
    outR: number
  ): number;
  mc_bootstrap_paths(
    f: number,
    h: number,
    r: number,
    rn: number,
    nPaths: number,
    seed: bigint,
    out: number
  ): void;
  mc_path_quantiles(paths: number, nPaths: number, h: number, out: number): void;
  mc_uniform(seed: bigint, n: number, out: number): void;
  mc_weibull_given(
    seed: bigint,
    k: number,
    scale: number,
    age: number,
    n: number,
    out: number
  ): void;
}

export const ML_CORE_ABI = 1;
const MASK = (1n << 64n) - 1n;

export interface MlCore extends Kernels {
  mase(actual: Float64Array, forecast: Float64Array, train: Float64Array, m: number): number;
  quantileSorted(sorted: Float64Array, q: number): number;
  pinball(actual: number, predicted: number, q: number): number;
  uniform(seed: bigint, n: number): Float64Array;
  weibullGiven(seed: bigint, k: number, scale: number, age: number, n: number): Float64Array;
}

export async function loadMlCore(bytes: BufferSource): Promise<MlCore> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const x = instance.exports as unknown as Exports;
  if (x.mc_version() !== ML_CORE_ABI)
    throw new Error(`ml-core ABI ${x.mc_version()}, expected ${ML_CORE_ABI}`);

  const f64 = () => new Float64Array(x.memory.buffer);
  /** Run `fn` with buffers allocated for the given lengths, copying inputs in; frees afterwards. */
  const withBuffers = <T>(specs: (Float64Array | number)[], fn: (ptrs: number[]) => T): T => {
    const ptrs: number[] = [];
    const lens: number[] = [];
    try {
      for (const s of specs) {
        const n = typeof s === 'number' ? s : s.length;
        const p = n ? x.mc_alloc(n) : 0;
        if (n && !p) throw new Error('ml-core: out of memory');
        ptrs.push(p);
        lens.push(n);
        if (typeof s !== 'number' && n) f64().set(s, p >>> 3);
      }
      return fn(ptrs);
    } finally {
      ptrs.forEach((p, i) => p && x.mc_free(p, lens[i]!));
    }
  };
  const read = (p: number, n: number) =>
    n ? f64().slice(p >>> 3, (p >>> 3) + n) : new Float64Array(0);

  return {
    name: 'ml-core',
    etsRun(y, h, m, alpha, beta, gamma, phi, seasonal): RunResult {
      return withBuffers([y, h, y.length], ([py, pf, pr]) => {
        const sse = x.mc_ets_run(
          py!,
          y.length,
          h,
          m,
          alpha,
          beta,
          gamma,
          phi,
          seasonal ? 1 : 0,
          pf!,
          pr!
        );
        return { forecast: read(pf!, h), residuals: read(pr!, y.length), sse };
      });
    },
    crostonRun(y, h, alpha, beta, variant): RunResult {
      const v = variant === 'croston' ? 0 : variant === 'sba' ? 1 : 2;
      return withBuffers([y, h, y.length], ([py, pf, pr]) => {
        const sse = x.mc_croston_run(py!, y.length, h, alpha, beta, v, pf!, pr!);
        return { forecast: read(pf!, h), residuals: read(pr!, y.length), sse };
      });
    },
    bootstrapPaths(forecast, residuals, nPaths, seed) {
      const h = forecast.length;
      return withBuffers([forecast, residuals, nPaths * h], ([pf, pr, po]) => {
        x.mc_bootstrap_paths(pf!, h, pr!, residuals.length, nPaths, seed & MASK, po!);
        return read(po!, nPaths * h);
      });
    },
    pathQuantiles(paths, h) {
      const n = paths.length / h;
      return withBuffers([paths, 7 * h], ([pp, po]) => {
        x.mc_path_quantiles(pp!, n, h, po!);
        const all = read(po!, 7 * h);
        return Array.from({ length: 7 }, (_, k) => all.slice(k * h, (k + 1) * h));
      });
    },
    mase(actual, forecast, train, m) {
      return withBuffers([actual, forecast, train], ([pa, pf, pt]) =>
        x.mc_mase(pa!, pf!, actual.length, pt!, train.length, m)
      );
    },
    quantileSorted(sorted, q) {
      return withBuffers([sorted], ([p]) => x.mc_quantile_sorted(p!, sorted.length, q));
    },
    pinball: (a, p, q) => x.mc_pinball(a, p, q),
    uniform(seed, n) {
      return withBuffers([n], ([p]) => {
        x.mc_uniform(seed & MASK, n, p!);
        return read(p!, n);
      });
    },
    weibullGiven(seed, k, scale, age, n) {
      return withBuffers([n], ([p]) => {
        x.mc_weibull_given(seed & MASK, k, scale, age, n, p!);
        return read(p!, n);
      });
    },
  };
}
