/**
 * Multinomial logistic regression over sparse features, trained by seeded
 * SGD (FR-ING-016, NFR-DET-001). Kilobytes of weights; trains in well under
 * a second on the synthetic layouts.
 */
import { fnv1a64, Rng } from '../../lib/prng.ts';
import type { Sparse } from './features.ts';

export interface Model {
  classes: number;
  dim: number;
  /** Row-major: class × dim. */
  w: Float64Array;
}

export interface Sample {
  x: Sparse;
  y: number;
  weight?: number;
}

export interface TrainOptions {
  epochs: number;
  rate: number;
  l2: number;
  seed: string;
}

export function predict(m: Model, x: Sparse): number[] {
  const z = new Array<number>(m.classes).fill(0);
  for (let c = 0; c < m.classes; c++) {
    const base = c * m.dim;
    let s = 0;
    for (let k = 0; k < x.idx.length; k++) s += m.w[base + x.idx[k]!]! * x.val[k]!;
    z[c] = s;
  }
  const max = Math.max(...z);
  let sum = 0;
  for (let c = 0; c < m.classes; c++) sum += z[c] = Math.exp(z[c]! - max);
  return z.map((v) => v / sum);
}

export function train(
  samples: readonly Sample[],
  classes: number,
  dim: number,
  o: TrainOptions
): Model {
  const m: Model = { classes, dim, w: new Float64Array(classes * dim) };
  const rng = new Rng(fnv1a64(o.seed));
  const order = samples.map((_, i) => i);
  for (let e = 0; e < o.epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const rate = o.rate / (1 + e * 0.2);
    for (const i of order) {
      const s = samples[i]!;
      const p = predict(m, s.x);
      const wt = s.weight ?? 1;
      for (let c = 0; c < classes; c++) {
        const g = (p[c]! - (c === s.y ? 1 : 0)) * wt;
        const base = c * dim;
        for (let k = 0; k < s.x.idx.length; k++) {
          const at = base + s.x.idx[k]!;
          m.w[at] = m.w[at]! - rate * (g * s.x.val[k]! + o.l2 * m.w[at]!);
        }
      }
    }
  }
  return m;
}
