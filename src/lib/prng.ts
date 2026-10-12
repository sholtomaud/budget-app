/**
 * SplitMix64, the PRNG GSSK uses for its instance RNG (FR-SYN-001,
 * NFR-DET-001). Same seed ⇒ same sequence on every engine: the state update
 * is exact 64-bit integer arithmetic (on 32-bit halves in the hot path, so no
 * BigInt is allocated per draw). Derived floats use only + − × ÷ and
 * Math.log/exp/cos/sqrt.
 */
const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

function mix(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return z ^ (z >> 31n);
}

/** FNV-1a, 64-bit, over the UTF-8 bytes of s. */
export function fnv1a64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & MASK;
  }
  return h;
}

/** Parse a seed given as a decimal or 0x-hex string (FR-SYN-001). */
export function parseSeed(seed: string | number | bigint): bigint {
  if (typeof seed === 'bigint') return seed & MASK;
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`Invalid seed ${seed}`);
    return BigInt(seed);
  }
  const s = seed.trim();
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(s)) {
    throw new Error(`Seed must be a decimal or 0x-hex integer, got "${seed}"`);
  }
  return BigInt(s) & MASK;
}

/** A child seed for a named or numbered stream: hash(seed, key, …). */
export function deriveSeed(seed: bigint, ...keys: (string | number)[]): bigint {
  let h = seed & MASK;
  for (const k of keys) h = mix((h ^ fnv1a64(String(k))) + GOLDEN) & MASK;
  return h;
}

const TWO32 = 4294967296;
const GOLDEN_HI = 0x9e3779b9;
const GOLDEN_LO = 0x7f4a7c15;

/** Results of mul64/mix32 (module scratch, so the hot path allocates nothing). */
let rHi = 0;
let rLo = 0;

/**
 * The low 64 bits of (ah·2³² + al) × (bh·2³² + bl), as unsigned 32-bit halves
 * in rHi, rLo. Exact: every intermediate stays below 2⁵³.
 */
function mul64(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff;
  const a1 = al >>> 16;
  const b0 = bl & 0xffff;
  const b1 = bl >>> 16;
  const mid = a0 * b1 + a1 * b0;
  const low = a0 * b0 + (mid % 65536) * 65536;
  const hi = a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / TWO32);
  rHi = (hi + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
  rLo = (low % TWO32) >>> 0;
}

/** SplitMix64's output mix on 32-bit halves, into rHi, rLo; bit-identical to `mix`. */
function mix32(hi: number, lo: number): void {
  let l = (lo ^ ((lo >>> 30) | (hi << 2))) >>> 0;
  let h = (hi ^ (hi >>> 30)) >>> 0;
  mul64(h, l, 0xbf58476d, 0x1ce4e5b9);
  l = (rLo ^ ((rLo >>> 27) | (rHi << 5))) >>> 0;
  h = (rHi ^ (rHi >>> 27)) >>> 0;
  mul64(h, l, 0x94d049bb, 0x133111eb);
  l = (rLo ^ ((rLo >>> 31) | (rHi << 1))) >>> 0;
  h = (rHi ^ (rHi >>> 31)) >>> 0;
  rHi = h;
  rLo = l;
}

export class Rng {
  /** The 64-bit state as two unsigned 32-bit halves: no BigInt per draw (ADR 0022). */
  private hi: number;
  private lo: number;
  readonly seed: bigint;

  constructor(seed: string | number | bigint) {
    this.seed = parseSeed(seed);
    this.hi = Number(this.seed >> 32n);
    this.lo = Number(this.seed & 0xffffffffn);
  }

  /** An independent stream for `keys`, without consuming this one. */
  fork(...keys: (string | number)[]): Rng {
    return new Rng(deriveSeed(this.seed, ...keys));
  }

  /** Advance the state; the output lands in rHi, rLo. */
  private next(): void {
    const lo = this.lo + GOLDEN_LO;
    this.hi = (this.hi + GOLDEN_HI + (lo >= TWO32 ? 1 : 0)) >>> 0;
    this.lo = lo >>> 0;
    mix32(this.hi, this.lo);
  }

  nextU64(): bigint {
    this.next();
    return (BigInt(rHi) << 32n) | BigInt(rLo);
  }

  /** Uniform in [0, 1) with 53 bits: the top 53 bits of the next output. */
  float(): number {
    this.next();
    return (rHi * 2097152 + (rLo >>> 11)) / 9007199254740992;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!(n >= 1)) throw new Error(`int(n) needs n ≥ 1, got ${n}`);
    return Math.floor(this.float() * n);
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('pick() from an empty list');
    return xs[this.int(xs.length)]!;
  }

  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Standard normal (Box–Muller, one value per call). */
  normal(mean = 0, sd = 1): number {
    const u1 = 1 - this.float();
    const u2 = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Lognormal with log-mean mu and log-sd sigma. */
  lognormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  /** Lognormal with the given arithmetic mean and coefficient of variation. */
  lognormalMeanCv(mean: number, cv: number): number {
    const s2 = Math.log(1 + cv * cv);
    return this.lognormal(Math.log(mean) - s2 / 2, Math.sqrt(s2));
  }

  exponential(rate: number): number {
    return -Math.log(1 - this.float()) / rate;
  }

  /** Poisson (Knuth for small λ, normal approximation above 50). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 50) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.float();
    } while (p > l);
    return k - 1;
  }

  /** Weibull(shape k, scale λ). */
  weibull(k: number, scale: number): number {
    return scale * Math.pow(-Math.log(1 - this.float()), 1 / k);
  }

  /** Weibull conditional on survival to `age`: the total lifetime T given T > age. */
  weibullGiven(k: number, scale: number, age: number): number {
    const u = 1 - this.float();
    return scale * Math.pow(Math.pow(age / scale, k) - Math.log(u), 1 / k);
  }
}

/** Weibull scale λ for a given mean and shape k: mean = λ Γ(1 + 1/k). */
export function weibullScale(mean: number, k: number): number {
  return mean / gamma(1 + 1 / k);
}

/** Γ(x) for x > 0, Lanczos approximation (g = 7, n = 9). */
export function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}
