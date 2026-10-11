/**
 * CMA-ES (Hansen's (μ/μ_w, λ) evolution strategy) as ask/tell over a flat
 * state vector, the TypeScript twin of ml-core's `mc_cmaes_*` (SPEC §11.4,
 * §15.2). The caller supplies the standard-normal draws, so the kernel is
 * pure arithmetic and the two implementations agree to rounding.
 *
 * State layout (f64):
 *   [0] n  [1] λ  [2] μ  [3] σ  [4] generation  [5] μ_eff  [6] c_c  [7] c_σ
 *   [8] c_1  [9] c_μ  [10] d_σ  [11] E‖N(0,I)‖
 *   then weights (λ), mean (n), p_c (n), p_σ (n), D (n), C (n²), B (n²), C^-½ (n²).
 */

export const HEADER = 12;

export function stateSize(n: number, lambda: number): number {
  return HEADER + lambda + 4 * n + 3 * n * n;
}

export function defaultLambda(n: number): number {
  return 4 + Math.floor(3 * Math.log(n));
}

interface Views {
  n: number;
  lambda: number;
  mu: number;
  w: number;
  mean: number;
  pc: number;
  ps: number;
  d: number;
  c: number;
  b: number;
  inv: number;
}

function views(s: Float64Array): Views {
  const n = s[0]!;
  const lambda = s[1]!;
  const w = HEADER;
  const mean = w + lambda;
  const pc = mean + n;
  const ps = pc + n;
  const d = ps + n;
  const c = d + n;
  const b = c + n * n;
  const inv = b + n * n;
  return { n, lambda, mu: s[2]!, w, mean, pc, ps, d, c, b, inv };
}

export function cmaesInit(x0: Float64Array, sigma0: number, lambda: number): Float64Array {
  const n = x0.length;
  const s = new Float64Array(stateSize(n, lambda));
  const mu = Math.floor(lambda / 2);
  s[0] = n;
  s[1] = lambda;
  s[2] = mu;
  s[3] = sigma0;
  s[4] = 0;
  let sum = 0;
  for (let i = 0; i < mu; i++) {
    const wi = Math.log(mu + 0.5) - Math.log(i + 1);
    s[HEADER + i] = wi;
    sum += wi;
  }
  let sq = 0;
  for (let i = 0; i < mu; i++) {
    s[HEADER + i] = s[HEADER + i]! / sum;
    sq += s[HEADER + i]! * s[HEADER + i]!;
  }
  const mueff = 1 / sq;
  s[5] = mueff;
  s[6] = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  s[7] = (mueff + 2) / (n + mueff + 5);
  s[8] = 2 / ((n + 1.3) * (n + 1.3) + mueff);
  s[9] = Math.min(1 - s[8]!, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) * (n + 2) + mueff));
  s[10] = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + s[7]!;
  s[11] = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  const v = views(s);
  for (let i = 0; i < n; i++) {
    s[v.mean + i] = x0[i]!;
    s[v.d + i] = 1;
    s[v.c + i * n + i] = 1;
    s[v.b + i * n + i] = 1;
    s[v.inv + i * n + i] = 1;
  }
  return s;
}

/** λ candidates, row-major (λ × n): x_k = m + σ·B·(D ∘ z_k). */
export function cmaesAsk(s: Float64Array, z: Float64Array): Float64Array {
  const v = views(s);
  const n = v.n;
  const sigma = s[3]!;
  const out = new Float64Array(v.lambda * n);
  for (let k = 0; k < v.lambda; k++) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = 0; j < n; j++) acc += s[v.b + i * n + j]! * s[v.d + j]! * z[k * n + j]!;
      out[k * n + i] = s[v.mean + i]! + sigma * acc;
    }
  }
  return out;
}

/** Update the state from the λ candidates and their objective values (lower is better). */
export function cmaesTell(s: Float64Array, x: Float64Array, f: Float64Array): void {
  const v = views(s);
  const n = v.n;
  const lambda = v.lambda;
  const mu = v.mu;
  const sigma = s[3]!;
  const mueff = s[5]!;
  const cc = s[6]!;
  const cs = s[7]!;
  const c1 = s[8]!;
  const cmu = s[9]!;
  const damps = s[10]!;
  const chiN = s[11]!;
  s[4] = s[4]! + 1;
  const gen = s[4]!;

  // Stable sort of candidate indices by f (insertion sort: λ is small).
  const idx = new Int32Array(lambda);
  for (let k = 0; k < lambda; k++) idx[k] = k;
  for (let a = 1; a < lambda; a++) {
    const cur = idx[a]!;
    let b = a - 1;
    while (b >= 0 && f[idx[b]!]! > f[cur]!) {
      idx[b + 1] = idx[b]!;
      b--;
    }
    idx[b + 1] = cur;
  }

  const xold = new Float64Array(n);
  for (let i = 0; i < n; i++) xold[i] = s[v.mean + i]!;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let r = 0; r < mu; r++) acc += s[v.w + r]! * x[idx[r]! * n + i]!;
    s[v.mean + i] = acc;
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = (s[v.mean + i]! - xold[i]!) / sigma;

  const kps = Math.sqrt(cs * (2 - cs) * mueff);
  let psNorm2 = 0;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += s[v.inv + i * n + j]! * y[j]!;
    const p = (1 - cs) * s[v.ps + i]! + kps * acc;
    s[v.ps + i] = p;
    psNorm2 += p * p;
  }
  const psNorm = Math.sqrt(psNorm2);
  const hsig = psNorm / Math.sqrt(1 - Math.pow(1 - cs, 2 * gen)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
  const kpc = hsig * Math.sqrt(cc * (2 - cc) * mueff);
  for (let i = 0; i < n; i++) s[v.pc + i] = (1 - cc) * s[v.pc + i]! + kpc * y[i]!;

  const keep = 1 - c1 - cmu;
  const delta = (1 - hsig) * cc * (2 - cc);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let rankMu = 0;
      for (let r = 0; r < mu; r++) {
        const k = idx[r]!;
        rankMu +=
          s[v.w + r]! * ((x[k * n + i]! - xold[i]!) / sigma) * ((x[k * n + j]! - xold[j]!) / sigma);
      }
      const cij =
        keep * s[v.c + i * n + j]! +
        c1 * (s[v.pc + i]! * s[v.pc + j]! + delta * s[v.c + i * n + j]!) +
        cmu * rankMu;
      s[v.c + i * n + j] = cij;
      s[v.c + j * n + i] = cij;
    }
  }

  s[3] = sigma * Math.exp((cs / damps) * (psNorm / chiN - 1));
  eigen(s, v);
}

/** Jacobi eigendecomposition of C into B (columns) and D = √λ; then C^-½ = B·D⁻¹·Bᵀ. */
function eigen(s: Float64Array, v: Views): void {
  const n = v.n;
  const a = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = s[v.c + i]!;
  const q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) q[i * n + i] = 1;
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) off += a[i * n + j]! * a[i * n + j]!;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let r = p + 1; r < n; r++) {
        const apr = a[p * n + r]!;
        if (apr === 0) continue;
        const theta = (a[r * n + r]! - a[p * n + p]!) / (2 * apr);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!;
          const akr = a[k * n + r]!;
          a[k * n + p] = c * akp - sn * akr;
          a[k * n + r] = sn * akp + c * akr;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!;
          const ark = a[r * n + k]!;
          a[p * n + k] = c * apk - sn * ark;
          a[r * n + k] = sn * apk + c * ark;
        }
        for (let k = 0; k < n; k++) {
          const qkp = q[k * n + p]!;
          const qkr = q[k * n + r]!;
          q[k * n + p] = c * qkp - sn * qkr;
          q[k * n + r] = sn * qkp + c * qkr;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) s[v.d + i] = Math.sqrt(Math.max(a[i * n + i]!, 1e-20));
  for (let i = 0; i < n * n; i++) s[v.b + i] = q[i]!;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += (q[i * n + k]! * q[j * n + k]!) / s[v.d + k]!;
      s[v.inv + i * n + j] = acc;
    }
  }
}

export function cmaesMean(s: Float64Array): Float64Array {
  const v = views(s);
  return s.slice(v.mean, v.mean + v.n);
}

export function cmaesSigma(s: Float64Array): number {
  return s[3]!;
}
