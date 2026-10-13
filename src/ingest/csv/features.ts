/**
 * Column features for the learned CSV mapper (FR-ING-016, ADR 0030): value
 * statistics, how the column relates to the others (a running balance, a
 * money-in/money-out pair), position, and hashed header tokens.
 */
import { parseAmount } from '../../lib/money.ts';
import { dataRowIndices, parseDate, parseMoney } from './read.ts';

/** A sparse feature vector. */
export interface Sparse {
  idx: number[];
  val: number[];
}

export const DENSE = 24;
export const HASH_DIM = 1024;
export const DIM = DENSE + HASH_DIM;

/** Rows sampled per column. */
const SAMPLE = 300;

/** 32-bit FNV-1a, for hashing header tokens into buckets. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Words and character trigrams of a header cell. */
export function headerTokens(header: string): string[] {
  const words = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return [];
  const out = words.map((w) => `w:${w}`);
  out.push(`p:${words.join(' ')}`);
  for (const w of words) {
    const s = `^${w}$`;
    for (let i = 0; i + 3 <= s.length; i++) out.push(`g:${s.slice(i, i + 3)}`);
  }
  return out;
}

function minorOf(v: string | null): bigint | null {
  if (v === null) return null;
  try {
    return parseAmount(v, 'AUD');
  } catch {
    return null;
  }
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Features of every column of a table. */
export function tableFeatures(rows: readonly string[][], headerRow: number | null): Sparse[] {
  const header = headerRow === null ? [] : rows[headerRow]!;
  const data = dataRowIndices(rows, headerRow)
    .slice(0, SAMPLE)
    .map((i) => rows[i]!);
  const width = Math.max(header.length, ...data.map((r) => r.length), 0);
  const cells = (j: number) => data.map((r) => (r[j] ?? '').trim());
  const money = Array.from({ length: width }, (_, j) =>
    cells(j).map((c) => minorOf(parseMoney(c)))
  );
  const isMoneyCol = money.map(
    (m, j) => m.filter((v) => v !== null).length >= 0.6 * cells(j).filter(Boolean).length
  );
  const meanAbs = money.map((m) => {
    const vs = m.filter((v): v is bigint => v !== null);
    return vs.length ? vs.reduce((a, v) => a + Number(abs(v)), 0) / vs.length / 100 : 0;
  });

  // Candidate flows: each money column, and each in/out pair as (in − out).
  const flows: { cols: number[]; v: (bigint | null)[] }[] = [];
  for (let k = 0; k < width; k++) if (isMoneyCol[k]) flows.push({ cols: [k], v: money[k]! });
  for (let a = 0; a < width; a++)
    for (let b = 0; b < width; b++) {
      if (a === b || !isMoneyCol[a] || !isMoneyCol[b]) continue;
      const v = data.map((_, i) => {
        const x = money[a]![i];
        const y = money[b]![i];
        return x === null && y === null ? null : abs(x ?? 0n) - abs(y ?? 0n);
      });
      flows.push({ cols: [a, b], v });
    }

  const textLen = Array.from({ length: width }, (_, j) => {
    const cs = cells(j).filter(Boolean);
    const alpha = cs.filter((c) => /[a-z]/i.test(c)).length;
    return alpha >= cs.length * 0.6 && cs.length
      ? cs.reduce((a, c) => a + c.length, 0) / cs.length
      : 0;
  });
  const longestText = Math.max(...textLen, 0);
  const moneyCols = isMoneyCol.filter(Boolean).length;
  const largest = Math.max(...meanAbs.filter((_, j) => isMoneyCol[j]), 0);

  const out: Sparse[] = [];
  for (let j = 0; j < width; j++) {
    const all = cells(j);
    const cs = all.filter(Boolean);
    const n = cs.length || 1;
    const m = money[j]!;
    const mv = m.filter((v): v is bigint => v !== null);
    const mraw = cs.map(parseMoney).filter((v): v is string => v !== null);
    const mn = mraw.length || 1;
    const share = (p: (c: string) => boolean) => cs.filter(p).length / n;

    // Running balance: b[i] − b[i−1] = flow[i] (oldest first) or b[i−1] − b[i] = flow[i−1].
    let balance = 0;
    for (const f of flows) {
      if (f.cols.includes(j)) continue;
      let asc = 0;
      let desc = 0;
      let pairs = 0;
      for (let i = 1; i < data.length; i++) {
        const b0 = m[i - 1];
        const b1 = m[i];
        if (b0 === null || b1 === null || b0 === undefined || b1 === undefined) continue;
        pairs++;
        if (f.v[i] !== null && b1 - b0 === f.v[i]) asc++;
        if (f.v[i - 1] !== null && b0 - b1 === f.v[i - 1]) desc++;
      }
      if (pairs) balance = Math.max(balance, Math.max(asc, desc) / pairs);
    }
    // Money in / money out: exactly one of this and another money column is filled.
    let complement = 0;
    for (let k = 0; k < width; k++) {
      if (k === j || !isMoneyCol[k]) continue;
      let either = 0;
      let one = 0;
      for (let i = 0; i < data.length; i++) {
        const a = m[i] !== null && m[i] !== 0n;
        const b = money[k]![i] !== null && money[k]![i] !== 0n;
        if (a || b) either++;
        if (a !== b) one++;
      }
      if (either) complement = Math.max(complement, one / either);
    }
    const distinct = new Set(cs).size;
    const dense = [
      1,
      1 - cs.length / Math.max(all.length, 1),
      share((c) => parseDate(c) !== null),
      mraw.length / n,
      mv.filter((v) => v < 0n).length / mn,
      mraw.length ? cs.filter((c) => /^[+\-−]/.test(c)).length / mn : 0,
      mraw.filter((v) => /\.\d\d$/.test(v)).length / mn,
      share((c) => /[a-z]/i.test(c)),
      cs.length ? distinct / n : 0,
      Math.min(1, cs.reduce((a, c) => a + c.length, 0) / n / 30),
      Math.min(1, cs.reduce((a, c) => a + c.split(/\s+/).length, 0) / n / 5),
      balance,
      isMoneyCol[j] ? complement : 0,
      distinct === 1 && cs.length > 1 ? 1 : 0,
      share((c) => /\d/.test(c) && /^[A-Z0-9][A-Z0-9 /-]{3,}$/.test(c) && parseMoney(c) === null),
      mraw.filter((v) => !v.includes('.')).length / mn,
      isMoneyCol[j] ? Math.min(1, Math.log10(meanAbs[j]! + 1) / 7) : 0,
      isMoneyCol[j] && moneyCols > 1 && meanAbs[j] === largest ? 1 : 0,
      width > 1 ? j / (width - 1) : 0,
      j === 0 ? 1 : 0,
      j === width - 1 ? 1 : 0,
      header.some((h) => h.trim()) ? 1 : 0,
      textLen[j]! > 0 && textLen[j] === longestText ? 1 : 0,
      share((c) => /^[A-Za-z][A-Za-z &/-]{1,24}$/.test(c)) *
        (distinct <= Math.max(3, n / 4) ? 1 : 0),
    ];
    const idx: number[] = [];
    const val: number[] = [];
    dense.forEach((v, i) => {
      if (v) {
        idx.push(i);
        val.push(v);
      }
    });
    const tokens = headerTokens(header[j] ?? '');
    const buckets = new Map<number, number>();
    for (const t of tokens) {
      const b = DENSE + (hash32(t) % HASH_DIM);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const norm = Math.sqrt([...buckets.values()].reduce((a, c) => a + c * c, 0)) || 1;
    for (const [b, c] of [...buckets].sort((x, y) => x[0] - y[0])) {
      idx.push(b);
      val.push(c / norm);
    }
    out.push({ idx, val });
  }
  return out;
}
