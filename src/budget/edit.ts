/**
 * Editing budget lines in place, like a spreadsheet (FR-BUD-003): a cell's
 * text in, a checked line (or what's wrong with it) out. Pure, so the Budget
 * screen's cells and the tests share one set of rules.
 */
import { perWeek, type PeriodTable } from './periods.ts';
import type { BudgetLine, SheetRow, Tier, TierId } from './model.ts';
import { parseMoney } from './workbook.ts';

export type LineField = 'item' | 'cost' | 'period' | 'multiplier' | 'categoryId';

export type EditResult = { ok: true; line: BudgetLine } | { ok: false; error: string };

/**
 * The line with one cell changed. `multiplier` is the share of the line that
 * counts at `tier` (1 = all of it, 0 = not at this tier).
 */
export function editLine(
  line: BudgetLine,
  field: LineField,
  text: string,
  opts: { tier: TierId; periods: PeriodTable }
): EditResult {
  const t = text.trim();
  switch (field) {
    case 'item':
      return t
        ? { ok: true, line: { ...line, item: t.slice(0, 120) } }
        : { ok: false, error: 'An item needs a name.' };
    case 'cost': {
      const cost = parseMoney(t);
      if (cost === undefined) return { ok: false, error: `“${t}” is not an amount.` };
      if (cost < 0n) return { ok: false, error: 'A budget amount can’t be below zero.' };
      return { ok: true, line: { ...line, cost } };
    }
    case 'period':
      return perWeek(t, opts.periods) === undefined
        ? { ok: false, error: `“${t}” is not a period.` }
        : { ok: true, line: { ...line, period: t } };
    case 'multiplier': {
      const m = Number(t.replace(/^×\s*/, ''));
      if (!t || !Number.isFinite(m) || m < 0 || m > 10)
        return { ok: false, error: 'The share at this tier is a number from 0 to 10.' };
      return {
        ok: true,
        line: { ...line, tierMultiplier: { ...line.tierMultiplier, [opts.tier]: m } },
      };
    }
    case 'categoryId':
      return t
        ? { ok: true, line: { ...line, categoryId: t } }
        : { ok: false, error: 'Pick a category.' };
  }
}

/** A new line in a category, counted fully at every tier. */
export function newLine(
  input: { categoryId: string; item: string; cost: string; period: string },
  opts: { tiers: readonly Tier[]; periods: PeriodTable; id: string }
): EditResult {
  let line: BudgetLine = {
    id: opts.id,
    categoryId: input.categoryId,
    item: '',
    cost: 0n,
    ccy: 'AUD',
    period: 'm',
    tierMultiplier: Object.fromEntries(opts.tiers.map((t) => [t.id, 1])),
  };
  const tier = opts.tiers[0]?.id ?? 'secure';
  for (const [field, text] of [
    ['categoryId', input.categoryId],
    ['item', input.item],
    ['cost', input.cost],
    ['period', input.period],
  ] as const) {
    const r = editLine(line, field, text, { tier, periods: opts.periods });
    if (!r.ok) return r;
    line = r.line;
  }
  return { ok: true, line };
}

/** A category's lines, in the order they were added. */
export const linesIn = (lines: readonly BudgetLine[], categoryId: string): BudgetLine[] =>
  lines.filter((l) => l.categoryId === categoryId);

/** A line's own values, as a sheet row would give them. */
export const rowOf = (l: BudgetLine): SheetRow => ({
  item: l.item,
  cost: l.cost,
  period: l.period,
  categoryId: l.categoryId,
  tierMultiplier: l.tierMultiplier,
});

const sameMultipliers = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 1) === (b[k] ?? 1));
};

export const sameRow = (a: SheetRow, b: SheetRow): boolean =>
  a.item === b.item &&
  a.cost === b.cost &&
  a.period === b.period &&
  a.categoryId === b.categoryId &&
  sameMultipliers(a.tierMultiplier, b.tierMultiplier);

/**
 * A line about to replace `old`: an imported line keeps what its sheet said
 * from the first change, and drops it once it is back to the sheet's values.
 */
export function withSheet(old: BudgetLine | undefined, next: BudgetLine): BudgetLine {
  const { sheet: _, ...bare } = next;
  if (!next.source) return bare;
  const sheet = next.sheet ?? old?.sheet ?? (old && old.source ? rowOf(old) : undefined);
  return sheet && !sameRow(sheet, rowOf(next)) ? { ...bare, sheet } : bare;
}

/**
 * Re-importing a sheet: its rows replace its lines, except where the line was
 * changed or deleted here and the sheet still says what it said then. Then the
 * change stands. A row the sheet itself changed takes the sheet's values.
 */
export function mergeReimport(
  lines: readonly BudgetLine[],
  removed: readonly BudgetLine[],
  file: string,
  incoming: readonly BudgetLine[]
): { lines: BudgetLine[]; removed: BudgetLine[]; kept: number } {
  const mine = new Map(lines.filter((l) => l.source?.file === file).map((l) => [l.id, l]));
  const gone = new Map(removed.filter((l) => l.source?.file === file).map((l) => [l.id, l]));
  let kept = 0;
  const next: BudgetLine[] = [];
  const stillRemoved: BudgetLine[] = removed.filter((l) => l.source?.file !== file);
  for (const row of incoming) {
    const had = mine.get(row.id);
    const del = gone.get(row.id);
    if (had?.sheet && sameRow(had.sheet, rowOf(row))) {
      next.push(had);
      kept++;
    } else if (del && sameRow(del.sheet ?? rowOf(del), rowOf(row))) {
      stillRemoved.push(del);
      kept++;
    } else next.push(row);
  }
  return {
    lines: [...lines.filter((l) => l.source?.file !== file), ...next],
    removed: stillRemoved,
    kept,
  };
}
