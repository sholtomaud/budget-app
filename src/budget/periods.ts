/**
 * Period codes and their per-week normaliser (FR-ING-012). The table is
 * user-editable; `Ny` (every N years) is parsed rather than listed.
 */
export type PeriodTable = Record<string, { label: string; perWeek: number }>;

export const DEFAULT_PERIODS: PeriodTable = {
  d: { label: 'per day', perWeek: 7 },
  w: { label: 'per week', perWeek: 1 },
  f: { label: 'per fortnight', perWeek: 1 / 2 },
  m: { label: 'per month', perWeek: 12 / 52 },
  q: { label: 'per quarter', perWeek: 4 / 52 },
  h: { label: 'per half-year', perWeek: 2 / 52 },
  y: { label: 'per year', perWeek: 1 / 52 },
  v: { label: 'per visit (once a year)', perWeek: 1 / 52 },
};

/** Weeks-per-unit factor for a period code, e.g. 'm' → 12/52, '5y' → 1/260. */
export function perWeek(code: string, table: PeriodTable = DEFAULT_PERIODS): number | undefined {
  const c = code.trim().toLowerCase();
  if (table[c]) return table[c].perWeek;
  const m = /^(\d+(?:\.\d+)?)\s*y$/.exec(c);
  if (m) return 1 / (52 * Number(m[1]));
  const v = /^(\d+(?:\.\d+)?)\s*v$/.exec(c);
  if (v) return Number(v[1]) / 52;
  return undefined;
}

export type Span = 'week' | 'month' | 'year';
export const WEEKS_IN: Record<Span, number> = { week: 1, month: 52 / 12, year: 52 };
