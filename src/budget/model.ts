/** Budget lines and tiers (SPEC §5 BudgetLine/Tier, §9.1). */
export type TierId = string;

export interface Tier {
  id: TierId;
  name: string;
  description: string;
}

export const DEFAULT_TIERS: Tier[] = [
  { id: 'secure', name: 'Secure', description: 'Essentials, safely covered' },
  { id: 'independent', name: 'Independent', description: 'Comfortable, with some extras' },
  { id: 'luxury', name: 'Luxury', description: 'Generous' },
];

export interface BudgetLine {
  id: string;
  categoryId: string;
  item: string;
  /** Minor units per `period`. */
  cost: bigint;
  ccy: string;
  period: string;
  tierMultiplier: Record<TierId, number>;
  startDate?: string;
  renewDate?: string;
  /**
   * The last month it is paid, YYYY-MM (a mortgage paid off, a loan): from
   * the month after, it counts as nothing (FR-BUD-005). None: it runs on.
   */
  endDate?: string;
  notes?: string;
  url?: string;
  /** Where the line came from (FR-ING-013). */
  source?: { file: string; row: number };
  /** What the sheet said, once an imported line is changed here (FR-BUD-003). */
  sheet?: SheetRow;
}

/** The values a sheet row gives a line. */
export type SheetRow = Pick<
  BudgetLine,
  'item' | 'cost' | 'period' | 'categoryId' | 'tierMultiplier' | 'endDate'
>;

export interface BudgetSettings {
  /** Annual CPI assumption (assumed). */
  cpi: number;
  /** Sinking-fund horizon in years. */
  horizonYears: number;
}

export const DEFAULT_SETTINGS: BudgetSettings = { cpi: 0.03, horizonYears: 10 };

/** The tier's rank, so 'secure' < 'independent' < 'luxury'. */
export function tierRank(tiers: readonly Tier[], id: TierId | undefined): number {
  const i = tiers.findIndex((t) => t.id === id);
  return i < 0 ? 0 : i;
}

/** Has the line ended by `month` (YYYY-MM or a date)? Paid through its end month, not after. */
export const endedBy = (line: BudgetLine, month: string): boolean =>
  !!line.endDate && month.slice(0, 7) > line.endDate.slice(0, 7);

/**
 * Weekly rate of a line at a tier, in minor units (float). Multiplier 0
 * excludes the line; so does `month` after its end date.
 */
export function weeklyRate(
  line: BudgetLine,
  tier: TierId,
  perWeekOf: (code: string) => number | undefined,
  month?: string
): number {
  const f = perWeekOf(line.period);
  if (f === undefined || (month && endedBy(line, month))) return 0;
  return Number(line.cost) * f * (line.tierMultiplier[tier] ?? 1);
}
