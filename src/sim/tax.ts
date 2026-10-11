/**
 * Australian resident income tax for the simulation (SPEC §11.2 step 4):
 * brackets, Medicare levy with its low-income shade-in, and the CGT
 * discount. Tables live in `data-tables/tax/`; a table without `verifiedBy`
 * is labelled `assumed`, and years past the last table reuse it, also
 * `assumed`. Brackets are held constant in real terms (an assumption: the
 * simulation is in today's dollars).
 */
import au202526 from '../../data-tables/tax/au-2025-26.json' with { type: 'json' };
import type { Provenance } from '../domain/types.ts';

export interface TaxTable {
  jurisdiction: string;
  financialYear: string;
  starts: string;
  source: string;
  verifiedBy: string | null;
  verifiedOn: string | null;
  brackets: { from: number; rate: number }[];
  medicareLevy: { rate: number; threshold: number; shadeInRate: number };
  cgtDiscount: { rate: number; minHoldingMonths: number };
  superannuation: { preservationAge: number; earningsTax: number; contributionsTax: number };
}

export const TAX_TABLES: Record<string, TaxTable> = { 'au-2025-26': au202526 as TaxTable };

export function taxTable(id: string): TaxTable {
  const t = TAX_TABLES[id];
  if (!t) throw new Error(`Unknown tax table '${id}'`);
  return t;
}

export function taxProvenance(t: TaxTable): Provenance {
  return t.verifiedBy && t.verifiedOn ? 'calibrated' : 'assumed';
}

/** Income tax on taxable income (dollars), before offsets. */
export function incomeTax(t: TaxTable, income: number): number {
  if (!(income > 0)) return 0;
  let tax = 0;
  const b = t.brackets;
  for (let i = 0; i < b.length; i++) {
    const lo = b[i]!.from;
    const hi = i + 1 < b.length ? b[i + 1]!.from : Infinity;
    if (income <= lo) break;
    tax += (Math.min(income, hi) - lo) * b[i]!.rate;
  }
  return tax;
}

/** Medicare levy: the full rate, shaded in above the low-income threshold. */
export function medicareLevy(t: TaxTable, income: number): number {
  const m = t.medicareLevy;
  if (income <= m.threshold) return 0;
  return Math.min(income * m.rate, (income - m.threshold) * m.shadeInRate);
}

export function totalTax(t: TaxTable, income: number): number {
  return incomeTax(t, income) + medicareLevy(t, income);
}

/** Taxable part of a net capital gain (after losses), with the discount when eligible. */
export function taxableGain(t: TaxTable, gain: number, heldMonths: number): number {
  if (gain <= 0) return 0;
  return heldMonths >= t.cgtDiscount.minHoldingMonths ? gain * (1 - t.cgtDiscount.rate) : gain;
}
