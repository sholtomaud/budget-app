/** The fields a transaction CSV column can hold (ADR 0030). Small, so screens can import it. */

/** What a column can hold. `ignore` columns are read by nothing. */
export const FIELDS = [
  'date',
  'amount',
  'debit',
  'credit',
  'description',
  'payee',
  'balance',
  'reference',
  'account',
  'category',
  'type',
  'ignore',
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL: Record<Field, string> = {
  date: 'Date',
  amount: 'Amount (+ in, − out)',
  debit: 'Money out',
  credit: 'Money in',
  description: 'Description',
  payee: 'Payee or merchant',
  balance: 'Balance',
  reference: 'Reference',
  account: 'Account',
  category: 'Category',
  type: 'Transaction type',
  ignore: 'Not used',
};

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** A model suggestion below this confidence is flagged for a closer look (FR-ING-018). */
export const UNSURE = 0.6;
