/**
 * Synthetic transaction CSVs in many layouts, with the true field of every
 * column: the learned mapper's training data and its held-out evaluation set
 * (FR-ING-016, ADR 0030). Seeded (NFR-DET-001) and made-up throughout
 * (NFR-PRIV-002).
 */
import { addDays, fromDayNumber, parseIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatAmount } from '../../lib/money.ts';
import { fnv1a64, Rng } from '../../lib/prng.ts';
import type { Field } from './read.ts';

export interface SynthLayout {
  rows: string[][];
  headerRow: number | null;
  truth: Field[];
}

/** Header words per field: [used in training, held out for evaluation]. */
const HEADERS: Record<Field, [string[], string[]]> = {
  date: [
    ['Date', 'Transaction Date', 'Posting Date', 'Txn Date', 'Date Posted', 'Value Date', 'Posted'],
    ['Trans. Date', 'Processed Date', 'Effective Date'],
  ],
  amount: [
    ['Amount', 'Transaction Amount', 'Amount (AUD)', 'Value', 'Net Amount', 'Amt'],
    ['Txn Amount', 'Amount AUD', 'Total'],
  ],
  debit: [
    [
      'Debit',
      'Debit Amount',
      'Withdrawal',
      'Withdrawals',
      'Money Out',
      'Paid Out',
      'Debits',
      'Spent',
    ],
    ['Withdrawal Amount', 'Out', 'Debit (AUD)'],
  ],
  credit: [
    [
      'Credit',
      'Credit Amount',
      'Deposit',
      'Deposits',
      'Money In',
      'Paid In',
      'Credits',
      'Received',
    ],
    ['Deposit Amount', 'In', 'Credit (AUD)'],
  ],
  description: [
    [
      'Description',
      'Narrative',
      'Details',
      'Transaction Details',
      'Memo',
      'Particulars',
      'Transaction Description',
      'Narration',
    ],
    ['Desc', 'Transaction Narrative', 'Description of Transaction'],
  ],
  payee: [
    ['Payee', 'Merchant', 'Merchant Name', 'Payer/Payee', 'Counterparty', 'Name'],
    ['Payee Name', 'Other Party'],
  ],
  balance: [
    ['Balance', 'Running Balance', 'Closing Balance', 'Account Balance', 'Bal'],
    ['Balance (AUD)', 'Ledger Balance'],
  ],
  reference: [
    ['Reference', 'Ref', 'Serial', 'Cheque Number', 'Receipt', 'Reference No'],
    ['Ref No.', 'Transaction Reference'],
  ],
  account: [
    ['Account', 'Bank Account', 'Account Number', 'Account No', 'Acct'],
    ['Account Name', 'Card Number'],
  ],
  category: [
    ['Category', 'Categories', 'Spending Category', 'Group', 'Tag'],
    ['Budget Category', 'Classification'],
  ],
  type: [
    ['Type', 'Transaction Type', 'Tran Type', 'Source', 'Kind'],
    ['Txn Type', 'Entry Type'],
  ],
  ignore: [
    ['', 'Notes', 'Currency', 'Tax', 'Status'],
    ['', 'Comments', 'Ccy'],
  ],
};

const MERCHANTS = [
  'Grocer Lane',
  'Corner Fuel',
  'Metro Transit',
  'StreamFlix',
  'City Power',
  'Harbour Cafe',
  'Pharmacy Plus',
  'Book Nook',
  'Hardware Barn',
  'Gym Republic',
  'Phone Co',
  'Water Board',
  'Pizza Place',
  'Bike Shop',
];
const SUBURBS = ['NORTHTOWN', 'EASTVALE', 'RIVERSIDE', 'HILLCREST', 'BAYVIEW', 'OLDMILL'];
const CATEGORIES = [
  'Groceries',
  'Dining out',
  'Transport',
  'Utilities',
  'Shopping',
  'Income',
  'Transfers',
  'Health',
  'Entertainment',
];
const TYPES = [
  ['DEBIT', 'CREDIT', 'EFTPOS', 'TRANSFER', 'DIRECT DEBIT', 'PAYMENT', 'FEE'],
  ['Spend Money', 'Receive Money', 'Bank Transfer'],
];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Template = { fields: [Field, number][]; headerless?: number };

/** Field and the chance it is present. */
const TEMPLATES: Template[] = [
  {
    fields: [
      ['date', 1],
      ['amount', 1],
      ['description', 1],
      ['balance', 0.6],
    ],
    headerless: 0.4,
  },
  {
    fields: [
      ['date', 1],
      ['amount', 1],
      ['account', 0.5],
      ['type', 0.5],
      ['description', 1],
      ['balance', 0.6],
      ['category', 0.4],
      ['payee', 0.4],
    ],
  },
  {
    fields: [
      ['account', 0.5],
      ['date', 1],
      ['description', 1],
      ['debit', 1],
      ['credit', 1],
      ['balance', 0.7],
      ['category', 0.3],
      ['reference', 0.4],
    ],
  },
  {
    fields: [
      ['date', 1],
      ['amount', 1],
      ['payee', 1],
      ['description', 1],
      ['reference', 0.8],
      ['type', 0.4],
    ],
  },
  {
    fields: [
      ['date', 1],
      ['reference', 0.5],
      ['description', 1],
      ['payee', 0.4],
      ['credit', 1],
      ['debit', 1],
      ['balance', 0.6],
    ],
  },
];

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)]!;
const pad2 = (n: number) => String(n).padStart(2, '0');

function dateText(d: IsoDate, style: number): string {
  const { y, m, d: day } = parseIsoDate(d);
  switch (style) {
    case 0:
      return `${pad2(day)}/${pad2(m)}/${y}`;
    case 1:
      return `${day}/${m}/${y}`;
    case 2:
      return d;
    case 3:
      return `${pad2(day)} ${MONTH[m - 1]} ${String(y).slice(2)}`;
    case 4:
      return `${pad2(day)}-${MONTH[m - 1]}-${y}`;
    case 5:
      return `${pad2(day)}/${pad2(m)}/${String(y).slice(2)}`;
    default:
      return `${pad2(m)}/${pad2(day)}/${y}`;
  }
}

function withCommas(s: string): string {
  const [int, frac] = s.split('.');
  return int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
}

/** A signed amount in one of the styles exports use. */
function moneyText(v: bigint, style: number): string {
  const neg = v < 0n;
  const a = formatAmount(neg ? -v : v, 'AUD');
  const fixed = a.includes('.') ? a : `${a}.00`;
  switch (style) {
    case 0:
      return (neg ? '-' : '') + fixed;
    case 1:
      return (neg ? '-' : '+') + fixed;
    case 2:
      return (neg ? '-$' : '$') + withCommas(fixed);
    case 3:
      return `${fixed} ${neg ? 'DR' : 'CR'}`;
    case 4:
      return neg ? `(${withCommas(fixed)})` : withCommas(fixed);
    default:
      return (neg ? '-' : '') + withCommas(fixed);
  }
}

function headerText(rng: Rng, f: Field, heldOut: boolean): string {
  const [seen, held] = HEADERS[f];
  const h = heldOut && rng.chance(0.5) ? pick(rng, held) : pick(rng, seen);
  const c = rng.int(4);
  return c === 0 ? h.toUpperCase() : c === 1 ? h.toLowerCase() : h;
}

/** One synthetic CSV layout. `heldOut` draws half its headers from words training never sees. */
export function synthLayout(rng: Rng, heldOut = false): SynthLayout {
  const t = pick(rng, TEMPLATES);
  let fields = t.fields.filter(([, p]) => rng.chance(p)).map(([f]) => f);
  const headerless = t.headerless !== undefined && rng.chance(t.headerless);
  if (!headerless && rng.chance(0.35)) {
    for (let i = fields.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [fields[i], fields[j]] = [fields[j]!, fields[i]!];
    }
  }
  if (!headerless && rng.chance(0.3)) {
    const at = rng.int(fields.length + 1);
    fields = [...fields.slice(0, at), 'ignore', ...fields.slice(at)];
  }

  const n = 15 + rng.int(120);
  const start = fromDayNumber(19358 + rng.int(900));
  const dateStyle = rng.chance(0.1) ? 6 : rng.int(6);
  const amountStyle = rng.int(6);
  const splitNegativeOut = rng.chance(0.3);
  const zeroFill = rng.chance(0.3);
  const accounts = Array.from(
    { length: rng.chance(0.7) ? 1 : 2 + rng.int(2) },
    () => `SYN-${String(10000000 + rng.int(89999999))}`
  );
  const typeSet = pick(rng, TYPES);
  const refStyle = rng.int(3);
  const ignoreStyle = rng.int(2);

  type Txn = { date: IsoDate; amount: bigint; balance: bigint; merchant: string; account: string };
  const txns: Txn[] = [];
  let date = start;
  let balance = BigInt(100000 + rng.int(2000000));
  for (let i = 0; i < n; i++) {
    date = addDays(date, rng.int(3));
    const income = rng.chance(0.15);
    const cents = income
      ? BigInt(Math.round(rng.uniform(200, 5000) * 100))
      : -BigInt(Math.max(1, Math.round(rng.lognormalMeanCv(60, 1.2) * 100)));
    balance += cents;
    txns.push({
      date,
      amount: cents,
      balance,
      merchant: income ? 'Employer Pty Ltd' : pick(rng, MERCHANTS),
      account: pick(rng, accounts),
    });
  }
  if (rng.chance(0.5)) txns.reverse();

  const cell = (f: Field, x: Txn): string => {
    switch (f) {
      case 'date':
        return dateText(x.date, dateStyle);
      case 'amount':
        return moneyText(x.amount, amountStyle);
      case 'debit':
        if (x.amount >= 0n) return zeroFill ? '0.00' : '';
        return moneyText(
          splitNegativeOut ? x.amount : -x.amount,
          amountStyle === 3 ? 0 : amountStyle
        );
      case 'credit':
        if (x.amount < 0n) return zeroFill ? '0.00' : '';
        return moneyText(x.amount, amountStyle === 3 ? 0 : amountStyle);
      case 'balance':
        return moneyText(x.balance, amountStyle === 1 ? 0 : amountStyle);
      case 'description':
        return x.amount > 0n
          ? `Salary ${x.merchant.toUpperCase()} REF ${rng.int(99999)}`
          : `${x.merchant.toUpperCase()} ${pick(rng, SUBURBS)} AU Card xx${1000 + rng.int(8999)}`;
      case 'payee':
        return x.merchant;
      case 'reference':
        if (rng.chance(0.4)) return '';
        return refStyle === 0
          ? String(100000 + rng.int(899999))
          : refStyle === 1
            ? `REF${(rng.int(0xffffff) + 0x100000).toString(36).toUpperCase()}`
            : `INV-${rng.int(9999)}`;
      case 'account':
        return x.account;
      case 'category':
        return x.amount > 0n ? 'Income' : pick(rng, CATEGORIES);
      case 'type':
        return x.amount > 0n ? typeSet[1]! : pick(rng, typeSet);
      case 'ignore':
        return ignoreStyle === 0 ? '' : 'AUD';
    }
  };

  const rows: string[][] = [];
  if (!headerless) rows.push(fields.map((f) => headerText(rng, f, heldOut)));
  for (const x of txns) rows.push(fields.map((f) => cell(f, x)));
  return { rows, headerRow: headerless ? null : 0, truth: fields };
}

export function synthLayouts(seed: string, count: number, heldOut = false): SynthLayout[] {
  const rng = new Rng(fnv1a64(seed));
  return Array.from({ length: count }, () => synthLayout(rng, heldOut));
}
