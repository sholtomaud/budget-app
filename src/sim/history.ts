/**
 * User-imported price histories for the block bootstrap (FR-FC-020, §10.3).
 * A CSV with a date and a closing price (Yahoo Finance's download works:
 * Date, Open, High, Low, Close, Adj Close, Volume) becomes month-end closes
 * and monthly log returns. Prices are taken as nominal in the household's
 * currency; they are deflated by the CPI assumption when simulated, since
 * the simulation runs in today's dollars. Nothing is fetched: the user
 * brings the file (ADR 0021).
 */
import { parseCsv } from '../lib/csv.ts';
import type { ReturnModel } from './model.ts';

export const MIN_HISTORY_MONTHS = 25;

export interface PriceHistory {
  id: string;
  label: string;
  /** 'YYYY-MM' of each return's month. */
  months: string[];
  /** Monthly nominal log returns. */
  logReturns: number[];
  source: { file: string; importedAt: string };
}

const DATE_KEYS = ['date', 'time', 'timestamp', 'month'];
const PRICE_KEYS = ['adj close', 'adj_close', 'adjclose', 'close', 'price', 'value'];

function toMonth(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}`;
  return null;
}

/** Month-end closes and monthly log returns from a price CSV. */
export function parsePriceHistory(text: string, file: string, label: string): PriceHistory {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()) && !r[0]!.startsWith('#'));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const di = header.findIndex((h) => DATE_KEYS.includes(h));
  const pi = PRICE_KEYS.map((k) => header.indexOf(k)).find((i) => i >= 0) ?? -1;
  if (di < 0 || pi < 0)
    throw new Error('Need a date column and a close or price column (e.g. Date, Close)');
  // The last observation in each month is its close.
  const byMonth = new Map<string, { date: string; price: number }>();
  for (const r of rows.slice(1)) {
    const month = toMonth(r[di] ?? '');
    const price = Number((r[pi] ?? '').replace(/[$,\s]/g, ''));
    if (!month || !(price > 0)) continue;
    const date = r[di]!.trim();
    const cur = byMonth.get(month);
    if (!cur || date >= cur.date) byMonth.set(month, { date, price });
  }
  const months = [...byMonth.keys()].sort();
  const logReturns: number[] = [];
  const out: string[] = [];
  for (let i = 1; i < months.length; i++) {
    logReturns.push(Math.log(byMonth.get(months[i]!)!.price / byMonth.get(months[i - 1]!)!.price));
    out.push(months[i]!);
  }
  if (logReturns.length < MIN_HISTORY_MONTHS - 1)
    throw new Error(`Need at least ${MIN_HISTORY_MONTHS} months of prices; found ${months.length}`);
  return {
    id:
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'history',
    label,
    months: out,
    logReturns,
    source: { file, importedAt: new Date().toISOString() },
  };
}

export const historySeriesId = (h: Pick<PriceHistory, 'id'>) => `user:${h.id}`;

/** A block-bootstrap return model over an imported history. */
export function historyModel(h: PriceHistory): ReturnModel {
  const years = (h.logReturns.length / 12).toFixed(0);
  return {
    id: `hist:${h.id}`,
    kind: 'block-bootstrap',
    seriesId: historySeriesId(h),
    block: 12,
    incomeYield: 0,
    label: `${h.label}: block bootstrap of your imported history (${years} years, ${h.months[0]} to ${h.months.at(-1)})`,
  };
}

/** Real monthly log returns: nominal less CPI (annual rate). */
export function realLogReturns(h: PriceHistory, cpi: number): number[] {
  const d = Math.log(1 + cpi) / 12;
  return h.logReturns.map((r) => r - d);
}
