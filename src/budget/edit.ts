/**
 * Editing budget lines in place, like a spreadsheet (FR-BUD-003): a cell's
 * text in, a checked line (or what's wrong with it) out. Pure, so the Budget
 * screen's cells and the tests share one set of rules.
 */
import { perWeek, WEEKS_IN, type PeriodTable, type Span } from './periods.ts';
import {
  tierRank,
  weeklyRate,
  type BudgetLine,
  type SheetRow,
  type Tier,
  type TierId,
} from './model.ts';
import { parseMoney } from './workbook.ts';

export type LineField = 'item' | 'cost' | 'period' | 'multiplier' | 'categoryId' | 'endDate';

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
    case 'endDate': {
      const { endDate: _, ...rest } = line;
      if (!t) return { ok: true, line: rest };
      const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(t);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12)
        return { ok: false, error: `“${t}” is not a month (YYYY-MM).` };
      return { ok: true, line: { ...rest, endDate: `${m[1]}-${m[2]}` } };
    }
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
  ...(l.endDate ? { endDate: l.endDate } : {}),
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
  (a.endDate ?? '') === (b.endDate ?? '') &&
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

const itemKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Re-importing a sheet: its rows replace its lines, except where the line was
 * changed or deleted here and the sheet still says what it said then. Then the
 * change stands. A row the sheet itself changed takes the sheet's values.
 *
 * Rows are matched by the item's name in the sheet, not by row number, so rows
 * inserted, deleted or moved in the spreadsheet keep the changes made here.
 * Two rows with the same name pair up by position: the same row first, then
 * the nearest. A matched line takes the row's new id and place.
 */
export function mergeReimport(
  lines: readonly BudgetLine[],
  removed: readonly BudgetLine[],
  file: string,
  incoming: readonly BudgetLine[]
): { lines: BudgetLine[]; removed: BudgetLine[]; kept: number } {
  const priors = [
    ...lines.filter((l) => l.source?.file === file).map((line) => ({ line, gone: false })),
    ...removed.filter((l) => l.source?.file === file).map((line) => ({ line, gone: true })),
  ];
  type Prior = (typeof priors)[number];
  const sheetOf = (l: BudgetLine) => l.sheet ?? rowOf(l);
  const rowNo = (l: BudgetLine) => l.source?.row ?? 0;
  const match = new Map<BudgetLine, Prior>();
  const used = new Set<Prior>();
  // Same name at the same row first, so one moved duplicate doesn't steal another's partner.
  for (const exact of [true, false])
    for (const row of incoming) {
      if (match.has(row)) continue;
      let best: Prior | undefined;
      for (const p of priors) {
        if (used.has(p) || itemKey(sheetOf(p.line).item) !== itemKey(row.item)) continue;
        const d = Math.abs(rowNo(p.line) - rowNo(row));
        if (exact && d !== 0) continue;
        if (!best || d < Math.abs(rowNo(best.line) - rowNo(row))) best = p;
      }
      if (best) {
        match.set(row, best);
        used.add(best);
      }
    }
  let kept = 0;
  const next: BudgetLine[] = [];
  const stillRemoved = removed.filter((l) => l.source?.file !== file);
  for (const row of incoming) {
    const p = match.get(row);
    // New, untouched, or changed in the sheet itself: the sheet's row.
    if (!p || !(p.gone || p.line.sheet) || !sameRow(sheetOf(p.line), rowOf(row))) {
      next.push(row);
      continue;
    }
    kept++;
    const moved = { ...p.line, id: row.id, ...(row.source ? { source: row.source } : {}) };
    if (p.gone) stillRemoved.push(moved);
    else next.push(moved);
  }
  return {
    lines: [...lines.filter((l) => l.source?.file !== file), ...next],
    removed: stillRemoved,
    kept,
  };
}

const SPAN_PERIOD: Record<Span, string> = { week: 'w', month: 'm', year: 'y' };

/**
 * A category's budget typed in for the period shown, at the tier shown. With a
 * budget already, the items that count at this tier are scaled to it (their
 * amounts, so every tier that has them moves the same way). Without one, one
 * item is added at that amount, counted at this tier and the ones above.
 */
export function setCategoryBudget(
  lines: readonly BudgetLine[],
  categoryId: string,
  text: string,
  opts: {
    tier: TierId;
    tiers: readonly Tier[];
    periods: PeriodTable;
    span: Span;
    id: string;
    name: string;
  }
): { ok: true; upsert: BudgetLine[]; summary: string } | { ok: false; error: string } {
  const target = parseMoney(text.trim());
  if (target === undefined) return { ok: false, error: `“${text.trim()}” is not an amount.` };
  if (target < 0n) return { ok: false, error: 'A budget amount can’t be below zero.' };
  const per = (c: string) => perWeek(c, opts.periods);
  const weeks = WEEKS_IN[opts.span];
  const counted = linesIn(lines, categoryId).filter((l) => weeklyRate(l, opts.tier, per) > 0);
  const now = counted.reduce((a, l) => a + weeklyRate(l, opts.tier, per) * weeks, 0);
  const want = Number(target);
  if (Math.abs(now - want) < 0.5) return { ok: true, upsert: [], summary: '' };
  // One item: kept in the period typed in, so the cell shows exactly what was typed.
  const only = counted.length === 1 ? counted[0]! : undefined;
  const share = only?.tierMultiplier[opts.tier] ?? 1;
  if (only && share > 0) {
    const k = want / now;
    return {
      ok: true,
      upsert: [{ ...only, cost: BigInt(Math.round(want / share)), period: SPAN_PERIOD[opts.span] }],
      summary: `${opts.name}: its item ${k >= 1 ? 'up' : 'down'} ${Math.abs(Math.round((k - 1) * 100))} %, now set ${opts.periods[SPAN_PERIOD[opts.span]]?.label ?? `per ${opts.span}`}`,
    };
  }
  if (now > 0) {
    const k = want / now;
    return {
      ok: true,
      upsert: counted.map((l) => ({ ...l, cost: BigInt(Math.round(Number(l.cost) * k)) })),
      summary: `${opts.name}: ${counted.length === 1 ? 'its item' : `its ${counted.length} items`} ${k >= 1 ? 'up' : 'down'} ${Math.abs(Math.round((k - 1) * 100))} %`,
    };
  }
  const rank = tierRank(opts.tiers, opts.tier);
  return {
    ok: true,
    upsert: [
      {
        id: opts.id,
        categoryId,
        item: opts.name,
        cost: target,
        ccy: 'AUD',
        period: SPAN_PERIOD[opts.span],
        tierMultiplier: Object.fromEntries(opts.tiers.map((t, i) => [t.id, i >= rank ? 1 : 0])),
      },
    ],
    summary: `${opts.name}: added a budget`,
  };
}
