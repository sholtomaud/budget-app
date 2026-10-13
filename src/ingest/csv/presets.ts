/**
 * Column presets for common Australian bank and accounting exports (SPEC
 * §6.3, ADR 0030). A preset only proposes a mapping spec; the user sees it
 * and can change any column before import. Layouts follow each provider's
 * published export format and are tested on synthetic files only.
 */
import { dataRowIndices, parseDate, parseMoney, type DateOrder, type Field } from './read.ts';

export interface Preset {
  id: string;
  label: string;
  kind: 'bank' | 'accounting';
  /** Header cells (normalised) that must all be present; absent for headerless layouts. */
  requires?: string[];
  /** Normalised header → field. Unlisted headers are not used. */
  map?: Record<string, Field>;
  /** Headerless layouts: the field of each column. */
  columns?: Field[];
  dateOrder?: DateOrder;
}

/** Lower case, no `*` markers (Xero marks required columns), single spaces. */
export const normHeader = (s: string) =>
  s.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export const PRESETS: Preset[] = [
  {
    id: 'westpac',
    label: 'Westpac',
    kind: 'bank',
    requires: ['bank account', 'date', 'narrative', 'debit amount', 'credit amount'],
    map: {
      'bank account': 'account',
      date: 'date',
      narrative: 'description',
      'debit amount': 'debit',
      'credit amount': 'credit',
      balance: 'balance',
      categories: 'category',
      serial: 'reference',
    },
  },
  {
    id: 'nab',
    label: 'NAB',
    kind: 'bank',
    requires: ['date', 'amount', 'account number', 'transaction details'],
    map: {
      date: 'date',
      amount: 'amount',
      'account number': 'account',
      'transaction type': 'type',
      'transaction details': 'description',
      balance: 'balance',
      category: 'category',
      'merchant name': 'payee',
    },
  },
  {
    id: 'ing',
    label: 'ING',
    kind: 'bank',
    requires: ['date', 'description', 'credit', 'debit', 'balance'],
    map: {
      date: 'date',
      description: 'description',
      credit: 'credit',
      debit: 'debit',
      balance: 'balance',
    },
  },
  {
    id: 'xero-statement',
    label: 'Xero bank statement',
    kind: 'accounting',
    requires: ['date', 'amount', 'payee', 'description', 'reference'],
    map: {
      date: 'date',
      amount: 'amount',
      payee: 'payee',
      description: 'description',
      reference: 'reference',
      'transaction type': 'type',
      'account code': 'category',
    },
  },
  {
    // Xero's Account Transactions report for a bank account: from the
    // ledger's side, a debit to the bank account is money in.
    id: 'xero-account-transactions',
    label: 'Xero account transactions',
    kind: 'accounting',
    requires: ['date', 'source', 'description', 'reference', 'debit', 'credit'],
    map: {
      date: 'date',
      source: 'type',
      description: 'description',
      reference: 'reference',
      debit: 'credit',
      credit: 'debit',
      'running balance': 'balance',
    },
  },
  {
    id: 'myob',
    label: 'MYOB bank register',
    kind: 'accounting',
    requires: ['date', 'memo', 'deposit', 'withdrawal'],
    map: {
      date: 'date',
      'id no.': 'reference',
      'id no': 'reference',
      memo: 'description',
      'payee/payer': 'payee',
      deposit: 'credit',
      withdrawal: 'debit',
      balance: 'balance',
      account: 'account',
      'account name': 'account',
    },
  },
  {
    id: 'cba',
    label: 'CommBank',
    kind: 'bank',
    columns: ['date', 'amount', 'description', 'balance'],
    dateOrder: 'dmy',
  },
  {
    id: 'anz',
    label: 'ANZ',
    kind: 'bank',
    columns: ['date', 'amount', 'description'],
    dateOrder: 'dmy',
  },
];

export interface PresetMatch {
  preset: Preset;
  columns: Field[];
}

const SHAPE: Record<string, (c: string) => boolean> = {
  date: (c) => parseDate(c) !== null,
  amount: (c) => parseMoney(c) !== null,
  balance: (c) => c.trim() === '' || parseMoney(c) !== null,
  description: (c) => /[a-z]/i.test(c) && parseMoney(c) === null,
};

/** The preset whose layout the file has, if any. */
export function matchPreset(rows: string[][], headerRow: number | null): PresetMatch | null {
  if (headerRow !== null) {
    const headers = rows[headerRow]!.map(normHeader);
    for (const p of PRESETS) {
      if (!p.requires?.every((h) => headers.includes(h))) continue;
      const used = new Set<Field>();
      const columns = headers.map((h): Field => {
        const f = p.map![h];
        if (!f || used.has(f)) return 'ignore';
        used.add(f);
        return f;
      });
      return { preset: p, columns };
    }
    return null;
  }
  const data = dataRowIndices(rows, null)
    .slice(0, 20)
    .map((i) => rows[i]!);
  if (!data.length) return null;
  for (const p of PRESETS) {
    const cols = p.columns;
    if (!cols) continue;
    const fits = data.every(
      (r) => r.length === cols.length && cols.every((f, j) => SHAPE[f]!(r[j] ?? ''))
    );
    if (fits) return { preset: p, columns: [...cols] };
  }
  return null;
}
