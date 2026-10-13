/**
 * Bank and accounting CSV import (SPEC §6.3, FR-ING-019…022, ADR 0030). All
 * files here are made up and carry the synthetic marker (NFR-PRIV-002).
 */
import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService, MemoryMapperStore } from '../../src/data/service.ts';
import {
  emptyMapperState,
  learn,
  layoutSignature,
  suggest,
  type MapperState,
} from '../../src/ingest/csv/mapper.ts';
import { matchPreset } from '../../src/ingest/csv/presets.ts';
import { previewCsv } from '../../src/ingest/csv/preview.ts';
import {
  applySpec,
  detectDateOrder,
  detectHeaderRow,
  parseDate,
  parseMoney,
  readTable,
  validateSpec,
  type BankCsvSpec,
} from '../../src/ingest/csv/read.ts';
import { MemoryImportStore, type InputFile } from '../../src/ingest/service.ts';

const TZ = 'Australia/Sydney';
const MARK = '# x-synthetic: generator=csv-import.test';

const csv = (rows: (string | number)[][]) =>
  [MARK, ...rows.map((r) => r.map(String).join(','))].join('\r\n') + '\r\n';
const input = (name: string, text: string): InputFile => ({
  name,
  bytes: new TextEncoder().encode(text),
});

const spec = (p: Partial<BankCsvSpec> & Pick<BankCsvSpec, 'columns'>): BankCsvSpec => ({
  kind: 'bank-csv',
  version: 1,
  headerRow: 1,
  dateOrder: 'dmy',
  invert: false,
  account: 'Everyday',
  currency: 'AUD',
  ...p,
});

/** A CommBank-style file: headerless, newest last, running balance. */
const CBA = csv([
  ['01/03/2026', '+2500.00', 'SALARY EMPLOYER PTY LTD', '+3500.00'],
  ['02/03/2026', '-45.10', 'GROCER LANE NORTHTOWN', '+3454.90'],
  ['02/03/2026', '-4.50', 'HARBOUR CAFE', '+3450.40'],
  ['02/03/2026', '-4.50', 'HARBOUR CAFE', '+3445.90'],
  ['05/03/2026', '-1200.00', 'TRANSFER TO SAVINGS', '+2245.90'],
]);

const WESTPAC = csv([
  [
    'Bank Account',
    'Date',
    'Narrative',
    'Debit Amount',
    'Credit Amount',
    'Balance',
    'Categories',
    'Serial',
  ],
  ['SYN-11223344', '05/03/2026', 'TRANSFER TO SAVINGS', '1200.00', '', '2245.90', 'OTHER', ''],
  ['SYN-11223344', '02/03/2026', 'GROCER LANE NORTHTOWN', '45.10', '', '3445.90', 'POS', ''],
  ['SYN-11223344', '01/03/2026', 'SALARY EMPLOYER PTY LTD', '', '2500.00', '3491.00', 'DEP', ''],
]);

describe('reading cells', () => {
  test.each([
    ['-12.34', '-12.34'],
    ['+12.34', '12.34'],
    ['$1,234.56', '1234.56'],
    ['-$1,234.56', '-1234.56'],
    ['$-5.00', '-5.00'],
    ['(12.00)', '-12.00'],
    ['12.00 DR', '-12.00'],
    ['12.00 CR', '12.00'],
    ['12.00-', '-12.00'],
    ['AUD 7', '7'],
    ['.5', '0.5'],
    ['-0.00', '0.00'],
    ['', null],
    ['GROCER', null],
    ['1,23', null],
  ])('money %j → %j (FR-ING-003: never through a float)', (text, want) => {
    expect(parseMoney(text)).toBe(want);
  });

  test.each([
    ['13/10/2026', 'dmy', '2026-10-13'],
    ['3/4/2026', 'dmy', '2026-04-03'],
    ['3/4/2026', 'mdy', '2026-03-04'],
    ['13/10/26', 'dmy', '2026-10-13'],
    ['2026-10-13', 'dmy', '2026-10-13'],
    ['2026-10-13T09:30:00', 'mdy', '2026-10-13'],
    ['13 Oct 26', 'dmy', '2026-10-13'],
    ['13-Oct-2026', 'dmy', '2026-10-13'],
    ['Oct 13, 2026', 'dmy', '2026-10-13'],
    ['31/02/2026', 'dmy', null],
    ['tomorrow', 'dmy', null],
  ] as const)('date %j (%s) → %j', (text, order, want) => {
    expect(parseDate(text, order)).toBe(want);
  });

  test('date order: day first unless only month first fits', () => {
    expect(detectDateOrder(['01/02/2026', '13/02/2026'])).toBe('dmy');
    expect(detectDateOrder(['01/02/2026', '02/13/2026'])).toBe('mdy');
    expect(detectDateOrder(['01/02/2026'])).toBe('dmy');
    expect(detectDateOrder(['2026-02-01'])).toBe('ymd');
  });

  test('the header row is found after comment lines, and not in a headerless file', () => {
    expect(detectHeaderRow(readTable(WESTPAC).rows)).toBe(1);
    expect(detectHeaderRow(readTable(CBA).rows)).toBeNull();
  });
});

describe('presets (FR-ING-020)', () => {
  const columnsOf = (text: string) => {
    const { rows } = readTable(text);
    return matchPreset(rows, detectHeaderRow(rows));
  };

  test('CommBank: headerless date, signed amount, description, balance', () => {
    const m = columnsOf(CBA)!;
    expect(m.preset.id).toBe('cba');
    expect(m.columns).toEqual(['date', 'amount', 'description', 'balance']);
  });

  test('ANZ: headerless date, amount, description', () => {
    const m = columnsOf(csv([['02/03/2026', '-45.10', 'GROCER LANE']]))!;
    expect(m.preset.id).toBe('anz');
  });

  test('Westpac and NAB by their headers', () => {
    expect(columnsOf(WESTPAC)!.columns).toEqual([
      'account',
      'date',
      'description',
      'debit',
      'credit',
      'balance',
      'category',
      'reference',
    ]);
    const nab = csv([
      [
        'Date',
        'Amount',
        'Account Number',
        '',
        'Transaction Type',
        'Transaction Details',
        'Balance',
        'Category',
        'Merchant Name',
      ],
      ['13 Oct 26', '-45.10', 'SYN-1234', '', 'EFTPOS', 'GROCER LANE', '100.00', 'Food', 'Grocer'],
    ]);
    const m = columnsOf(nab)!;
    expect(m.preset.id).toBe('nab');
    expect(m.columns[3]).toBe('ignore');
    expect(m.columns[8]).toBe('payee');
  });

  test('Xero Account Transactions: a debit to the bank account is money in', () => {
    const text = csv([
      ['Date', 'Source', 'Description', 'Reference', 'Debit', 'Credit', 'Running Balance'],
      ['02/03/2026', 'Receive Money', 'Client payment', 'INV-1', '500.00', '', '1500.00'],
      ['03/03/2026', 'Spend Money', 'Office supplies', 'B-7', '', '80.00', '1420.00'],
    ]);
    const m = columnsOf(text)!;
    expect(m.preset.id).toBe('xero-account-transactions');
    const r = applySpec(text, spec({ columns: m.columns }), TZ);
    expect(r.transactions.map((t) => t.amount)).toEqual(['500.00', '-80.00']);
    expect(r.balances).toHaveLength(2);
  });

  test('Xero statement (with * markers) and MYOB register', () => {
    expect(
      columnsOf(csv([['*Date', '*Amount', 'Payee', 'Description', 'Reference', 'Cheque Number']]))!
        .preset.id
    ).toBe('xero-statement');
    expect(
      columnsOf(csv([['ID No.', 'Date', 'Memo', 'Deposit', 'Withdrawal', 'Balance']]))!.columns
    ).toEqual(['reference', 'date', 'description', 'credit', 'debit', 'balance']);
  });
});

describe('applying a mapping spec (FR-ING-019, FR-ING-022)', () => {
  const cba = spec({ headerRow: null, columns: ['date', 'amount', 'description', 'balance'] });

  test('the spec is checked against its schema and for a usable mapping', () => {
    expect(validateSpec(cba)).toBeNull();
    expect(validateSpec({ ...cba, columns: ['date', 'description'] })).toMatch(/amount/);
    expect(validateSpec({ ...cba, columns: ['date', 'amount', 'debit'] })).toMatch(/not both/);
    expect(validateSpec({ ...cba, columns: ['date', 'amount', 'date'] })).toMatch(/More than one/);
    expect(validateSpec({ ...cba, currency: 'aud' })).toMatch(/currency/);
    expect(validateSpec({ ...cba, columns: ['date', 'amount', 'figure'] })).not.toBeNull();
  });

  test('rows become CDR transactions; identical rows on a day stay two', () => {
    const r = applySpec(CBA, cba, TZ);
    expect(r.synthetic).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.transactions).toHaveLength(5);
    const coffees = r.transactions.filter((t) => t.description === 'HARBOUR CAFE');
    expect(coffees).toHaveLength(2);
    expect(coffees[0]!.transactionId).not.toBe(coffees[1]!.transactionId);
    expect(r.transactions[0]).toMatchObject({
      accountId: 'CSV-EVERYDAY',
      status: 'POSTED',
      amount: '2500.00',
      postingDateTime: '2026-03-01T12:00:00+11:00',
      'x-csv-row': 2,
    });
    expect(r.accounts).toMatchObject([{ accountId: 'CSV-EVERYDAY', displayName: 'Everyday' }]);
  });

  test('a balance column that agrees gives opening and closing checkpoints, either order', () => {
    const asc = applySpec(CBA, cba, TZ).balances;
    expect(asc.map((b) => [b.asAt, b.items[0]!.currentBalance])).toEqual([
      ['2026-03-01T00:00:00+11:00', '1000.00'],
      ['2026-03-05T23:59:59+11:00', '2245.90'],
    ]);
    const w = applySpec(
      WESTPAC,
      spec({
        columns: [
          'account',
          'date',
          'description',
          'debit',
          'credit',
          'balance',
          'category',
          'reference',
        ],
      }),
      TZ
    );
    // Newest first: the opening balance is before the oldest row.
    expect(w.balances.map((b) => [b.asAt, b.items[0]!.currentBalance])).toEqual([
      ['2026-03-01T00:00:00+11:00', '991.00'],
      ['2026-03-05T23:59:59+11:00', '2245.90'],
    ]);
    expect(w.transactions.map((t) => t.amount)).toEqual(['-1200.00', '-45.10', '2500.00']);
    expect(w.accounts).toMatchObject([
      { accountId: 'CSV-SYN-11223344', displayName: 'Account …3344', maskedNumber: 'xxxx3344' },
    ]);
  });

  test('a balance column that disagrees gives no checkpoints rather than wrong ones', () => {
    const off = CBA.replace('+3445.90', '+3440.00');
    expect(applySpec(off, cba, TZ).balances).toEqual([]);
  });

  test('unreadable rows are skipped with their line; flipping signs', () => {
    const text = csv([
      ['Date', 'Amount', 'Description'],
      ['02/03/2026', '45.10', 'GROCER LANE'],
      ['soon', '1.00', 'BAD DATE'],
      ['03/03/2026', 'n/a', 'BAD AMOUNT'],
      ['04/03/2026', '-100.00', 'PAYMENT THANK YOU'],
    ]);
    const r = applySpec(
      text,
      spec({ columns: ['date', 'amount', 'description'], invert: true, account: 'Visa card' }),
      TZ
    );
    expect(r.issues).toEqual([
      { row: 4, message: '"soon" is not a date' },
      { row: 5, message: '"n/a" is not an amount' },
    ]);
    expect(r.transactions.map((t) => t.amount)).toEqual(['-45.10', '100.00']);
    expect(r.accounts[0]!.productCategory).toBe('CRED_AND_CHRG_CARDS');
  });

  test('the preview counts, dates and totals what will be imported', () => {
    const p = previewCsv(CBA, cba, TZ);
    expect(p.headers).toEqual([]);
    expect(p.sample).toHaveLength(5);
    expect(p.summary).toMatchObject({
      transactions: 5,
      skipped: 0,
      from: '2026-03-01',
      to: '2026-03-05',
      moneyIn: 250000n,
      moneyOut: 125410n,
      balanced: true,
      synthetic: true,
    });
    expect(
      previewCsv(CBA, { ...cba, columns: ['date', 'ignore', 'description', 'balance'] }, TZ).summary
        .invalid
    ).toMatch(/amount/);
  });
});

describe('the learned mapper (FR-ING-016, FR-ING-021)', () => {
  /** A layout no preset knows, with headers in another language. */
  const ROWS = [
    ['03/02/2026', '-45.10', 'GROCER LANE NORTHTOWN', 'Lebensmittel', 'Karte', 'K-1001'],
    ['04/02/2026', '2500.00', 'SALARY EMPLOYER', 'Einkommen', 'Gutschrift', 'K-1002'],
    ['05/02/2026', '-60.00', 'CORNER FUEL EASTVALE', 'Auto', 'Karte', 'K-1003'],
    ['06/02/2026', '-12.50', 'BOOK NOOK BAYVIEW', 'Freizeit', 'Lastschrift', 'K-1004'],
    ['07/02/2026', '-80.00', 'CITY POWER', 'Wohnen', 'Lastschrift', 'K-1005'],
  ];
  const HEAD = ['Datum', 'Betrag', 'Text', 'Rubrik', 'Art', 'Beleg'];
  const TRUTH = ['date', 'amount', 'description', 'category', 'type', 'reference'] as const;
  const file = (order: number[]) =>
    csv([order.map((i) => HEAD[i]!), ...ROWS.map((r) => order.map((i) => r[i]!))]);

  test('presets win over the model; the model maps an unknown layout', () => {
    expect(suggest('CSVData.csv', CBA, emptyMapperState())).toMatchObject({
      source: 'CommBank',
      spec: { preset: 'cba', account: 'CSVData', headerRow: null },
    });
    const s = suggest('konto.csv', file([0, 1, 2, 3, 4, 5]), emptyMapperState());
    expect(s.source).toBe('the column mapper');
    expect(s.columns.every((c) => c.by === 'model')).toBe(true);
    expect(s.spec.columns.slice(0, 3)).toEqual(['date', 'amount', 'description']);
    expect(validateSpec(s.spec)).toBeNull();
  });

  test('a correction is remembered for the layout and carries over to a reordered one', () => {
    const first = file([0, 1, 2, 3, 4, 5]);
    const before = suggest('konto.csv', first, emptyMapperState());
    expect(before.spec.columns).not.toEqual(TRUTH);
    let state: MapperState = learn(
      emptyMapperState(),
      first,
      { ...before.spec, columns: [...TRUTH] },
      new Date('2026-10-13T00:00:00Z')
    );
    expect(state.layouts).toHaveLength(1);
    expect(state.corrections.map((c) => c.field)).toContain('type');

    const again = suggest('konto.csv', first, state);
    expect(again.source).toBe('a layout you used before');
    expect(again.spec.columns).toEqual(TRUTH);

    const order = [5, 4, 3, 2, 1, 0];
    const moved = suggest('konto-2.csv', file(order), state);
    expect(moved.source).toBe('the column mapper');
    expect(moved.spec.columns).toEqual(order.map((i) => TRUTH[i]));

    // Learning is deterministic (NFR-DET-001).
    state = learn(state, first, { ...before.spec, columns: [...TRUTH] }, new Date(0));
    expect(state.layouts).toHaveLength(1);
    expect(layoutSignature(readTable(first).rows, 1)).toBe(`h:${HEAD.join('|').toLowerCase()}`);
  });
});

describe('importing through the ledger (FR-ING-004…008)', () => {
  const columns = ['date', 'amount', 'description', 'balance'] as const;
  const cba = spec({ headerRow: null, columns: [...columns] });

  test('import, reconcile, re-import is a no-op, overlap dedupes, undo, reload', async () => {
    const imports = new MemoryImportStore();
    const state = new MemoryStateStore();
    const mapper = new MemoryMapperStore();
    const svc = new DataService(imports, state, undefined, TZ, mapper);
    await svc.load();

    const rec = await svc.importCsv(input('CSVData.csv', CBA), cba);
    expect(rec.synthetic).toBe(true);
    expect(rec.counts).toMatchObject({ new: 5, duplicate: 0, rejected: 0 });
    let v = svc.view();
    expect(v.accounts).toMatchObject([
      { id: 'CSV-EVERYDAY', source: { kind: 'synthetic' }, provenance: 'illustrative' },
    ]);
    expect(v.txns).toHaveLength(5);
    expect(v.txns.every((t) => t.idSynthetic && t.classification)).toBe(true);
    expect(v.reconciliation).toEqual([
      { accountId: 'CSV-EVERYDAY', checkpoints: 2, intervals: 1, gaps: [] },
    ]);

    const same = await svc.importCsv(input('CSVData.csv', CBA), cba);
    expect(same.files[0]!.status).toBe('duplicate-file');
    expect(svc.view().imports).toHaveLength(1);

    // A later export overlapping on 5 March: only the new row is new.
    const later = csv([
      ['05/03/2026', '-1200.00', 'TRANSFER TO SAVINGS', '+2245.90'],
      ['06/03/2026', '-30.00', 'CORNER FUEL', '+2215.90'],
    ]);
    const rec2 = await svc.importCsv(input('CSVData (1).csv', later), cba);
    expect(rec2.counts).toMatchObject({ new: 1, duplicate: 1 });
    v = svc.view();
    expect(v.txns).toHaveLength(6);
    expect(v.reconciliation[0]!.gaps).toEqual([]);

    // The mapper remembered the layout.
    expect((await mapper.load())!.layouts).toHaveLength(1);

    // A fresh service over the same stores rebuilds the same ledger from the stored CSVs.
    const again = new DataService(imports, state, undefined, TZ, mapper);
    await again.load();
    expect(
      again
        .view()
        .txns.map((t) => t.id)
        .sort()
    ).toEqual(v.txns.map((t) => t.id).sort());
    expect(again.mapper.layouts).toHaveLength(1);

    await svc.undo(rec2.id);
    expect(svc.view().txns).toHaveLength(5);
  });

  test('skipped rows count as rejected and are named; an invalid spec is refused', async () => {
    const svc = new DataService(new MemoryImportStore(), new MemoryStateStore());
    const text = csv([
      ['02/03/2026', '-45.10', 'GROCER LANE'],
      ['nope', '-1.00', 'BAD'],
    ]);
    const rec = await svc.importCsv(
      input('anz.csv', text),
      spec({ headerRow: null, columns: ['date', 'amount', 'description'] })
    );
    expect(rec.counts).toMatchObject({ new: 1, rejected: 1 });
    expect(rec.files[0]!.message).toBe('1 row skipped; line 3: "nope" is not a date');
    await expect(
      svc.importCsv(input('x.csv', text), spec({ columns: ['date', 'description', 'ignore'] }))
    ).rejects.toThrow(/amount/);
  });

  test('suggestCsv proposes and previews; nothing is saved', async () => {
    const svc = new DataService(new MemoryImportStore(), new MemoryStateStore());
    const p = svc.suggestCsv('CSVData.csv', CBA);
    expect(p.suggestion.source).toBe('CommBank');
    expect(p.preview.summary.transactions).toBe(5);
    expect(svc.view().txns).toHaveLength(0);
  });
});
