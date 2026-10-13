/**
 * Bank and accounting transaction CSVs (SPEC §6.3, ADR 0030): the mapping
 * spec, the value parsers, and the deterministic code that turns a CSV and
 * its spec into CDR-shaped records for the ledger. A proposer (preset,
 * memory, model) only ever writes the spec; every figure comes from the
 * user's cells (NFR-HON-002).
 */
import mappingSchema from '../../../schemas/bank-csv-mapping.schema.json' with { type: 'json' };
import { parseCsv } from '../../lib/csv.ts';
import { daysInMonth, isoDate, zonedDateTime, type IsoDate } from '../../lib/dates.ts';
import { formatAmount, parseAmount } from '../../lib/money.ts';
import { fnv1a64 } from '../../lib/prng.ts';
import { formatError, validate, type Schema } from '../../lib/jsonschema.ts';
import type { CdrAccount, CdrBalance, CdrTransaction } from '../cdr/parse.ts';
import { FIELD_LABEL, FIELDS, type DateOrder, type Field } from './fields.ts';

export { FIELD_LABEL, FIELDS, type DateOrder, type Field } from './fields.ts';

/** The mapping spec for one transaction CSV (`schemas/bank-csv-mapping.schema.json`). */
export interface BankCsvSpec {
  kind: 'bank-csv';
  version: 1;
  /** Row index (0-based, in the parsed file) of the header, or null when there is none. */
  headerRow: number | null;
  /** One field per column. */
  columns: Field[];
  /** How to read all-number dates such as 03/04/2026. */
  dateOrder: DateOrder;
  /** Flip every sign: for exports that show spending as positive. */
  invert: boolean;
  /** The account's name, when no column names it. */
  account: string;
  currency: string;
  /** The preset the layout came from, if any. */
  preset?: string;
}

export function validateSpec(spec: unknown): string | null {
  const err = validate(mappingSchema as Schema, spec);
  if (err) return formatError(err);
  const s = spec as BankCsvSpec;
  const has = (f: Field) => s.columns.includes(f);
  if (!has('date')) return 'No column is mapped to the date';
  if (!has('amount') && !has('debit') && !has('credit'))
    return 'No column is mapped to the amount, or to money in and out';
  if (has('amount') && (has('debit') || has('credit')))
    return 'Map either one amount column, or money in and money out, not both';
  for (const f of FIELDS)
    if (f !== 'ignore' && s.columns.filter((c) => c === f).length > 1)
      return `More than one column is mapped to ${FIELD_LABEL[f]}`;
  return null;
}

// ---- Values ----------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/;
const NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[T ].*)?$/;
const DAY_NAMED = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]+(\d{4}|\d{2})$/;
const NAMED_DAY = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/;

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 4 ? n : n < 70 ? 2000 + n : 1900 + n;
}

function monthOf(name: string): number | undefined {
  const k = name.toLowerCase();
  return MONTHS[k] ?? MONTHS[k.slice(0, 3)];
}

function make(y: number, m: number | undefined, d: number): IsoDate | null {
  if (!m || m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  return d <= daysInMonth(y, m) ? isoDate(y, m, d) : null;
}

/** A calendar date in any of the common export formats, or null. */
export function parseDate(text: string, order: DateOrder = 'dmy'): IsoDate | null {
  const s = text.trim();
  let m = ISO.exec(s);
  if (m) return make(Number(m[1]), Number(m[2]), Number(m[3]));
  m = NUMERIC.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order === 'mdy' ? make(fullYear(m[3]!), a, b) : make(fullYear(m[3]!), b, a);
  }
  m = DAY_NAMED.exec(s);
  if (m) return make(fullYear(m[3]!), monthOf(m[2]!), Number(m[1]));
  m = NAMED_DAY.exec(s);
  if (m) return make(Number(m[3]), monthOf(m[1]!), Number(m[2]));
  return null;
}

/** Day-first unless a value can only be month-first (AU exports are day-first). */
export function detectDateOrder(values: readonly string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  let iso = 0;
  for (const v of values) {
    const s = v.trim();
    if (ISO.test(s)) iso++;
    const m = NUMERIC.exec(s);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (mdy > 0 && dmy === 0) return 'mdy';
  if (iso > 0 && dmy === 0 && mdy === 0) return 'ymd';
  return 'dmy';
}

const CURRENCY = /^(?:AUD|NZD|USD|A\$|AU\$|NZ\$|US\$|\$|€|£)\s*/i;
const PLAIN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^\.\d+$/;

/**
 * A money cell as a signed decimal string ("-1234.50"), or null when the cell
 * is empty or not money. Reads $, thousands commas, (brackets), CR/DR and
 * trailing minus. Never goes through a binary float (FR-ING-003).
 */
export function parseMoney(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  let neg = false;
  if (t.startsWith('(') && t.endsWith(')')) {
    neg = true;
    t = t.slice(1, -1).trim();
  }
  const suffix = /\s*\b(CR|DR)\.?$/i.exec(t);
  if (suffix) {
    if (/^d/i.test(suffix[1]!)) neg = !neg;
    t = t.slice(0, suffix.index).trim();
  }
  if (t.endsWith('-')) {
    neg = !neg;
    t = t.slice(0, -1).trim();
  }
  for (let pass = 0; pass < 2; pass++) {
    if (t.startsWith('-') || t.startsWith('−')) {
      neg = !neg;
      t = t.slice(1).trim();
    } else if (t.startsWith('+')) t = t.slice(1).trim();
    t = t.replace(CURRENCY, '');
  }
  if (!PLAIN.test(t)) return null;
  t = t.replace(/,/g, '');
  if (t.startsWith('.')) t = `0${t}`;
  if (/^0*(\.0*)?$/.test(t)) neg = false;
  return (neg ? '-' : '') + t;
}

// ---- Rows ------------------------------------------------------------------

export const isComment = (r: readonly string[]) => (r[0] ?? '').trimStart().startsWith('#');
export const isBlank = (r: readonly string[]) => r.every((c) => c.trim() === '');

export interface CsvTable {
  rows: string[][];
  /** True when the first line is the `# x-synthetic` marker (NFR-PRIV-002). */
  synthetic: boolean;
}

export function readTable(text: string): CsvTable {
  const rows = parseCsv(text);
  return { rows, synthetic: /^#\s*x-synthetic\b/.test(rows[0]?.[0] ?? '') };
}

/** Indices of the data rows: after the header, not comments, not blank. */
export function dataRowIndices(rows: readonly string[][], headerRow: number | null): number[] {
  const out: number[] = [];
  for (let i = headerRow === null ? 0 : headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!isComment(r) && !isBlank(r)) out.push(i);
  }
  return out;
}

/** The first row that reads as a header: words, no dates, at most one number. */
export function detectHeaderRow(rows: readonly string[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i]!;
    if (isComment(r) || isBlank(r)) continue;
    const cells = r.filter((c) => c.trim() !== '');
    const dates = cells.filter((c) => parseDate(c) !== null).length;
    const money = cells.filter((c) => parseMoney(c) !== null).length;
    const words = cells.filter((c) => /[a-z]/i.test(c)).length;
    return dates === 0 && money <= 1 && words * 2 >= cells.length ? i : null;
  }
  return null;
}

// ---- Applying a spec -------------------------------------------------------

export interface CsvIssue {
  /** 1-based line in the file (FR-ING-013). */
  row: number;
  message: string;
}

export interface CsvRecords {
  accounts: CdrAccount[];
  transactions: CdrTransaction[];
  /** Opening and closing balances, when a balance column agrees with the amounts. */
  balances: { asAt: string; items: CdrBalance[] }[];
  issues: CsvIssue[];
  dataRows: number;
  synthetic: boolean;
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The account id for a CSV: from the account column's value, or the name the user gave. */
export function csvAccountId(name: string): string {
  return `CSV-${slug(name) || 'ACCOUNT'}`;
}

function hashId(key: string): string {
  const a = fnv1a64(key).toString(16).padStart(16, '0');
  const b = fnv1a64(`${key}\u001e`).toString(16).padStart(16, '0');
  return `C-${a}${b}`;
}

interface Row {
  line: number;
  accountId: string;
  date: IsoDate;
  amount: bigint;
  balance: bigint | null;
}

/**
 * Turn a CSV into CDR-shaped accounts, transactions and balance checkpoints,
 * ready for the ledger, which then applies FR-ING-004…008 as for any export.
 */
export function applySpec(text: string, spec: BankCsvSpec, tz: string): CsvRecords {
  const invalid = validateSpec(spec);
  if (invalid) throw new Error(invalid);
  const { rows, synthetic } = readTable(text);
  const col = (f: Field) => spec.columns.indexOf(f);
  const cell = (r: string[], f: Field) => {
    const i = col(f);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
  const ccy = spec.currency;
  const issues: CsvIssue[] = [];
  const transactions: CdrTransaction[] = [];
  const accountNames = new Map<string, { name: string; masked: string }>();
  const seen = new Map<string, number>();
  const kept: Row[] = [];
  const indices = dataRowIndices(rows, spec.headerRow);

  for (const i of indices) {
    const r = rows[i]!;
    const line = i + 1;
    const date = parseDate(cell(r, 'date'), spec.dateOrder);
    if (!date) {
      issues.push({ row: line, message: `"${cell(r, 'date')}" is not a date` });
      continue;
    }
    let minor: bigint;
    try {
      if (col('amount') >= 0) {
        const a = parseMoney(cell(r, 'amount'));
        if (a === null) throw new Error(`"${cell(r, 'amount')}" is not an amount`);
        minor = parseAmount(a, ccy);
      } else {
        const out = parseMoney(cell(r, 'debit'));
        const inn = parseMoney(cell(r, 'credit'));
        if (out === null && inn === null) throw new Error('has no amount in or out');
        const o = out === null ? 0n : parseAmount(out, ccy);
        const n = inn === null ? 0n : parseAmount(inn, ccy);
        minor = (n < 0n ? -n : n) - (o < 0n ? -o : o);
      }
    } catch (e) {
      const msg = (e as Error).message;
      issues.push({ row: line, message: msg.startsWith('"') ? msg : `Row ${msg}` });
      continue;
    }
    if (spec.invert) minor = -minor;
    const rawAccount = cell(r, 'account');
    const accountKey = rawAccount || spec.account;
    const accountId = csvAccountId(accountKey);
    if (!accountNames.has(accountId)) {
      const digits = rawAccount.replace(/\D/g, '');
      accountNames.set(accountId, {
        name: rawAccount ? (digits ? `Account …${digits.slice(-4)}` : rawAccount) : spec.account,
        masked: digits ? `xxxx${digits.slice(-4)}` : '',
      });
    }
    const payee = cell(r, 'payee');
    const desc = [payee, cell(r, 'description')].filter(Boolean).join(' ') || '(no description)';
    const amount = formatAmount(minor, ccy);
    const key = [accountId, date, amount, desc.replace(/\s+/g, ' ').toLowerCase()].join('\u001f');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const t: CdrTransaction = {
      accountId,
      transactionId: hashId(`${key}\u001f${n}`),
      'x-id-synthetic': true,
      isDetailAvailable: false,
      type: 'OTHER',
      status: 'POSTED',
      description: desc,
      postingDateTime: zonedDateTime(date, 12, 0, 0, tz),
      amount,
      currency: ccy,
      reference: cell(r, 'reference'),
      'x-csv-row': line,
    };
    if (payee) t.merchantName = payee;
    if (cell(r, 'category')) t['x-csv-category'] = cell(r, 'category');
    if (cell(r, 'type')) t['x-csv-type'] = cell(r, 'type');
    transactions.push(t);
    const bal = col('balance') >= 0 ? parseMoney(cell(r, 'balance')) : null;
    let balance: bigint | null = null;
    try {
      balance = bal === null ? null : parseAmount(bal, ccy);
    } catch {
      balance = null;
    }
    kept.push({ line, accountId, date, amount: minor, balance });
  }

  const credit = spec.invert || /credit|card|visa|mastercard|amex/i.test(spec.account);
  const accounts: CdrAccount[] = [...accountNames].map(([accountId, a]) => ({
    accountId,
    displayName: a.name,
    productCategory: credit ? 'CRED_AND_CHRG_CARDS' : 'TRANS_AND_SAVINGS_ACCOUNTS',
    productName: spec.preset ? `CSV (${spec.preset})` : 'CSV export',
    maskedNumber: a.masked,
    'x-source': 'csv',
  }));

  return {
    accounts,
    transactions,
    balances: col('balance') >= 0 ? checkpoints(kept, ccy, tz) : [],
    issues,
    dataRows: indices.length,
    synthetic,
  };
}

/**
 * Opening and closing balances per account, when the running balance agrees
 * with the amounts row by row in one direction (newest first or oldest
 * first). They give reconciliation (FR-REC-001) one interval over the file.
 */
function checkpoints(rows: Row[], ccy: string, tz: string): CsvRecords['balances'] {
  const byAccount = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.balance === null) return [];
    byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
  }
  const at = new Map<string, CdrBalance[]>();
  const add = (asAt: string, accountId: string, v: bigint) => {
    const s = formatAmount(v, ccy);
    const b: CdrBalance = { accountId, currentBalance: s, availableBalance: s, currency: ccy };
    at.set(asAt, [...(at.get(asAt) ?? []), b]);
  };
  for (const [accountId, rs] of byAccount) {
    let asc = 0;
    let desc = 0;
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1]!;
      const b = rs[i]!;
      if (b.balance! - a.balance! === b.amount) asc++;
      if (a.balance! - b.balance! === a.amount) desc++;
    }
    const pairs = rs.length - 1;
    let ordered: Row[];
    if (pairs === 0 || asc === pairs) ordered = rs;
    else if (desc === pairs) ordered = [...rs].reverse();
    else continue;
    const first = ordered[0]!;
    const last = ordered.at(-1)!;
    if (first.date > last.date) continue;
    add(zonedDateTime(first.date, 0, 0, 0, tz), accountId, first.balance! - first.amount);
    add(zonedDateTime(last.date, 23, 59, 59, tz), accountId, last.balance!);
  }
  return [...at].map(([asAt, items]) => ({ asAt, items }));
}
