/**
 * Multinomial naive Bayes over hashed features (§8 stage 5), trained on the
 * user's own corrections. Small, deterministic and fast to retrain, so it is
 * rebuilt from the stored corrections rather than persisted as weights
 * (ADR 0009).
 */
import type { Txn } from '../domain/types.ts';
import { weekday } from '../lib/dates.ts';
import { merchantTokens } from './normalise.ts';

export const MODEL_VERSION = 'nb-hash-1';
const BITS = 14;
const SIZE = 1 << BITS;
const ALPHA = 0.5;

function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed feature indices for a transaction: merchant word and character trigrams, MCC, amount bucket, weekday, type. */
export function features(t: Txn): number[] {
  const toks = merchantTokens(t);
  const out: string[] = [];
  for (const w of toks) out.push(`w:${w}`);
  const text = ` ${toks.join(' ')} `;
  for (let i = 0; i + 3 <= text.length; i++) out.push(`c:${text.slice(i, i + 3)}`);
  if (t.mcc) out.push(`mcc:${t.mcc}`);
  const abs = Number(t.amount < 0n ? -t.amount : t.amount) / 100;
  out.push(`amt:${t.amount < 0n ? '-' : '+'}${Math.floor(Math.log2(abs + 1))}`);
  out.push(`wd:${weekday(t.date)}`);
  out.push(`type:${t.cdrType}`);
  return out.map((f) => fnv32(f) & (SIZE - 1));
}

export interface NbModel {
  labels: string[];
  logPrior: Float64Array;
  /** labels × SIZE log-likelihoods. */
  logLik: Float32Array;
}

/** Below this the model is not trusted to predict at all. */
export const MIN_LABELS = 2;
export const MIN_SAMPLES = 5;

export function train(samples: { x: number[]; y: string }[]): NbModel | null {
  const labels = [...new Set(samples.map((s) => s.y))].sort();
  if (labels.length < MIN_LABELS || samples.length < MIN_SAMPLES) return null;
  const L = labels.length;
  const counts = new Float64Array(L * SIZE);
  const totals = new Float64Array(L);
  const docs = new Float64Array(L);
  for (const s of samples) {
    const l = labels.indexOf(s.y);
    docs[l]! += 1;
    for (const f of s.x) {
      counts[l * SIZE + f]! += 1;
      totals[l]! += 1;
    }
  }
  const logPrior = new Float64Array(L);
  const logLik = new Float32Array(L * SIZE);
  for (let l = 0; l < L; l++) {
    logPrior[l] = Math.log(docs[l]! / samples.length);
    const denom = Math.log(totals[l]! + ALPHA * SIZE);
    for (let f = 0; f < SIZE; f++)
      logLik[l * SIZE + f] = Math.log(counts[l * SIZE + f]! + ALPHA) - denom;
  }
  return { labels, logPrior, logLik };
}

/** The most probable label and its posterior probability. */
export function predict(model: NbModel, x: number[]): { label: string; p: number } {
  const L = model.labels.length;
  const scores = new Float64Array(L);
  for (let l = 0; l < L; l++) {
    let s = model.logPrior[l]!;
    for (const f of x) s += model.logLik[l * SIZE + f]!;
    scores[l] = s;
  }
  let best = 0;
  for (let l = 1; l < L; l++) if (scores[l]! > scores[best]!) best = l;
  let z = 0;
  for (let l = 0; l < L; l++) z += Math.exp(scores[l]! - scores[best]!);
  return { label: model.labels[best]!, p: 1 / z };
}
