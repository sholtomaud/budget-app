import type { Txn } from '../domain/types.ts';
import { merchantTokens } from './normalise.ts';

/** A remembered correction: normalised merchant → category (§8 stage 3). */
export interface MemoryEntry {
  key: string;
  categoryId: string;
  /** Direction the correction was made for; a refund from a merchant is not a purchase. */
  direction: 'debit' | 'credit';
  count: number;
}

export const MEMORY_CONFIDENCE = 0.95;

const direction = (t: Txn) => (t.amount < 0n ? 'debit' : 'credit');

/**
 * The longest remembered key whose tokens are a prefix of the transaction's
 * merchant tokens, or vice versa (so "FRESH FIELDS" matches
 * "FRESH FIELDS NEWTOWN"). Keys need at least two tokens, or one of 5+ letters.
 */
export function recall(memory: ReadonlyMap<string, MemoryEntry>, t: Txn): MemoryEntry | undefined {
  const toks = merchantTokens(t);
  const dir = direction(t);
  for (let n = toks.length; n >= 1; n--) {
    const key = toks.slice(0, n).join(' ');
    if (n === 1 && key.length < 5) break;
    const e = memory.get(`${dir}|${key}`);
    if (e) return e;
  }
  return undefined;
}

export function remember(
  memory: Map<string, MemoryEntry>,
  t: Txn,
  categoryId: string
): MemoryEntry | null {
  const key = merchantTokens(t).join(' ');
  if (!key) return null;
  const dir = direction(t);
  const id = `${dir}|${key}`;
  const prev = memory.get(id);
  const e: MemoryEntry = {
    key,
    categoryId,
    direction: dir,
    count: (prev?.categoryId === categoryId ? prev.count : 0) + 1,
  };
  memory.set(id, e);
  return e;
}

export const memoryId = (e: MemoryEntry) => `${e.direction}|${e.key}`;
