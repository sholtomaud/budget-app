/**
 * What a transaction CSV will import as, before anything is saved, and the
 * CDR-shaped files the ledger folds in (ADR 0030).
 */
import type { IsoDate } from '../../lib/dates.ts';
import { parseAmount } from '../../lib/money.ts';
import type { ParsedFile } from '../ledger.ts';
import {
  applySpec,
  dataRowIndices,
  readTable,
  validateSpec,
  type BankCsvSpec,
  type CsvIssue,
} from './read.ts';

export interface CsvSummary {
  /** Why the spec can't be applied; nothing else is set when this is. */
  invalid?: string;
  transactions: number;
  skipped: number;
  issues: CsvIssue[];
  accounts: string[];
  from?: IsoDate;
  to?: IsoDate;
  /** Minor units. */
  moneyIn: bigint;
  moneyOut: bigint;
  /** True when the balance column agrees with the amounts, so the file can be reconciled. */
  balanced: boolean;
  synthetic: boolean;
}

export interface CsvPreview {
  headers: string[];
  /** The first few data rows, as text. */
  sample: string[][];
  summary: CsvSummary;
}

const SAMPLE_ROWS = 5;

export function previewCsv(text: string, spec: BankCsvSpec, tz: string): CsvPreview {
  const { rows, synthetic } = readTable(text);
  const headers = spec.headerRow === null ? [] : [...rows[spec.headerRow]!];
  const sample = dataRowIndices(rows, spec.headerRow)
    .slice(0, SAMPLE_ROWS)
    .map((i) => [...rows[i]!]);
  const empty: CsvSummary = {
    transactions: 0,
    skipped: 0,
    issues: [],
    accounts: [],
    moneyIn: 0n,
    moneyOut: 0n,
    balanced: false,
    synthetic,
  };
  const invalid = validateSpec(spec);
  if (invalid) return { headers, sample, summary: { ...empty, invalid } };
  const r = applySpec(text, spec, tz);
  let moneyIn = 0n;
  let moneyOut = 0n;
  const dates: string[] = [];
  for (const t of r.transactions) {
    const v = parseAmount(t.amount, spec.currency);
    if (v > 0n) moneyIn += v;
    else moneyOut -= v;
    dates.push(t.postingDateTime!.slice(0, 10));
  }
  dates.sort();
  return {
    headers,
    sample,
    summary: {
      transactions: r.transactions.length,
      skipped: r.issues.length,
      issues: r.issues.slice(0, 5),
      accounts: r.accounts.map((a) => a.displayName),
      ...(dates.length ? { from: dates[0]!, to: dates.at(-1)! } : {}),
      moneyIn,
      moneyOut,
      balanced: r.balances.length > 0,
      synthetic,
    },
  };
}

/**
 * The ledger's view of one CSV: an accounts file, a transactions file and a
 * balances file per checkpoint time. The extra files carry derived hashes so
 * re-importing the CSV stays a no-op (FR-ING-006).
 */
export function csvParsedFiles(
  name: string,
  sha256: string,
  text: string,
  spec: BankCsvSpec,
  tz: string
): { files: ParsedFile[]; rejected: number; message?: string } {
  const r = applySpec(text, spec, tz);
  const synthetic = r.synthetic;
  const files: ParsedFile[] = [
    {
      name,
      sha256: `${sha256}:accounts`,
      payload: { kind: 'accounts', items: r.accounts, synthetic },
    },
    { name, sha256, payload: { kind: 'transactions', items: r.transactions, synthetic } },
    ...r.balances.map((b) => ({
      name,
      sha256: `${sha256}:balances:${b.asAt}`,
      payload: { kind: 'balances' as const, items: b.items, asAt: b.asAt, synthetic },
    })),
  ];
  const first = r.issues[0];
  return {
    files,
    rejected: r.issues.length,
    ...(first
      ? {
          message: `${r.issues.length} row${r.issues.length === 1 ? '' : 's'} skipped; line ${first.row}: ${first.message}`,
        }
      : {}),
  };
}
