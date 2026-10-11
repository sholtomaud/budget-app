import table from '../../data-tables/mcc-categories.json' with { type: 'json' };
import type { Txn } from '../domain/types.ts';

export interface MccEntry {
  category: string;
  capexCategory?: string;
  capexFrom?: number;
}

export const MCC_CONFIDENCE = 0.8;

const MCC = table.mcc as Record<string, MccEntry>;

/** Default category for a merchant category code (§8 stage 4), or undefined. */
export function mccCategory(t: Txn, overrides: Record<string, MccEntry> = {}): string | undefined {
  if (!t.mcc) return undefined;
  const e = overrides[t.mcc] ?? MCC[t.mcc];
  if (!e) return undefined;
  if (
    e.capexCategory &&
    e.capexFrom !== undefined &&
    t.amount < 0n &&
    -t.amount >= BigInt(Math.round(e.capexFrom * 100))
  ) {
    return e.capexCategory;
  }
  return e.category;
}
