/**
 * Sampler and calibration diagnostics for the Bayesian workflow (ADR 0022,
 * FR-BAY-006…008): split-R̂ and effective sample size (Vehtari, Gelman et
 * al. 2021, without rank normalisation), interval coverage, and the
 * uniformity of probability integral transforms.
 */

const mean = (x: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / x.length;
};

/** Each chain cut in half, so a drifting chain shows up as disagreement. */
function splitChains(chains: readonly Float64Array[]): Float64Array[] {
  const out: Float64Array[] = [];
  for (const c of chains) {
    const half = Math.floor(c.length / 2);
    out.push(c.subarray(0, half), c.subarray(c.length - half));
  }
  return out;
}

/** Split-R̂: 1 when the chains agree; above about 1.01–1.05 they have not mixed. */
export function splitRhat(chains: readonly Float64Array[]): number {
  const cs = splitChains(chains);
  const n = cs[0]!.length;
  if (cs.length < 2 || n < 2) return NaN;
  const means = cs.map(mean);
  const grand = mean(means);
  let b = 0;
  for (const m of means) b += (m - grand) ** 2;
  b = (b * n) / (cs.length - 1);
  let w = 0;
  cs.forEach((c, j) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += (c[i]! - means[j]!) ** 2;
    w += v / (n - 1);
  });
  w /= cs.length;
  if (w === 0) return b === 0 ? 1 : Infinity;
  const varPlus = ((n - 1) / n) * w + b / n;
  return Math.sqrt(varPlus / w);
}

/**
 * Effective sample size over all chains: autocorrelations combined across
 * chains, summed with Geyer's initial positive, monotone sequence.
 */
export function ess(chains: readonly Float64Array[]): number {
  const cs = splitChains(chains);
  const m = cs.length;
  const n = cs[0]!.length;
  if (m < 1 || n < 4) return NaN;
  const means = cs.map(mean);
  const variances = cs.map((c, j) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += (c[i]! - means[j]!) ** 2;
    return v / (n - 1);
  });
  const w = mean(variances);
  const grand = mean(means);
  let b = 0;
  for (const mu of means) b += (mu - grand) ** 2;
  b = m > 1 ? (b * n) / (m - 1) : 0;
  const varPlus = ((n - 1) / n) * w + b / n;
  if (!(varPlus > 0)) return m * n;
  // Autocovariance at lag t, averaged over chains (biased estimator, as Stan).
  const acov = (t: number) => {
    let s = 0;
    cs.forEach((c, j) => {
      let a = 0;
      for (let i = 0; i + t < n; i++) a += (c[i]! - means[j]!) * (c[i + t]! - means[j]!);
      s += a / n;
    });
    return s / m;
  };
  const rho = (t: number) => 1 - (w - acov(t)) / varPlus;
  let sum = 0;
  let prevPair = Infinity;
  for (let t = 0; t + 1 < n; t += 2) {
    let pair = rho(t) + rho(t + 1);
    if (pair < 0) break;
    if (pair > prevPair) pair = prevPair;
    prevPair = pair;
    sum += pair;
  }
  const tau = Math.max(-1 + 2 * sum, 1 / Math.log10(m * n));
  return (m * n) / tau;
}

/** The share of actuals inside their predictive [lo, hi] interval. */
export function coverage(actual: ArrayLike<number>, lo: ArrayLike<number>, hi: ArrayLike<number>) {
  let n = 0;
  let inside = 0;
  for (let i = 0; i < actual.length; i++) {
    n++;
    if (actual[i]! >= lo[i]! && actual[i]! <= hi[i]!) inside++;
  }
  return n ? inside / n : NaN;
}

/**
 * Probability integral transform of `actual` under predictive draws, with
 * ties (e.g. zero-spend months) spread uniformly so a calibrated model gives
 * uniform PITs; `u` in [0, 1) breaks the ties reproducibly.
 */
export function pit(draws: ArrayLike<number>, actual: number, u: number): number {
  let below = 0;
  let equal = 0;
  for (let i = 0; i < draws.length; i++) {
    if (draws[i]! < actual) below++;
    else if (draws[i]! === actual) equal++;
  }
  return (below + u * equal) / draws.length;
}

/** The largest gap between the PITs' empirical CDF and the uniform CDF (Kolmogorov–Smirnov D). */
export function ksUniform(pits: readonly number[]): number {
  const s = [...pits].sort((a, b) => a - b);
  const n = s.length;
  let d = 0;
  s.forEach((x, i) => (d = Math.max(d, (i + 1) / n - x, x - i / n)));
  return d;
}

/** Pearson's χ² statistic for counts against equal expected counts. */
export function chiSquareUniform(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const e = total / counts.length;
  return counts.reduce((a, c) => a + (c - e) ** 2 / e, 0);
}
