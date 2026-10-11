import { describe, expect, test } from 'vitest';
import { parseCdrText } from '../../src/ingest/cdr/parse.ts';
import { isEffective, reconcile } from '../../src/ingest/ledger.ts';
import { IngestService, MemoryImportStore } from '../../src/ingest/service.ts';
import { writeZip } from '../../src/lib/zip.ts';
import { cdrInputs, ingest, synth } from '../helpers/synth.ts';

const enc = new TextEncoder();
const file = (name: string, body: unknown) => ({ name, bytes: enc.encode(JSON.stringify(body)) });

function txnPage(transactions: Record<string, unknown>[]) {
  return {
    data: { transactions },
    links: { self: 'https://bank.invalid/banking/accounts/SYN-A/transactions?page=1' },
    meta: { totalRecords: transactions.length, totalPages: 1 },
  };
}
const tx = (o: Record<string, unknown>) => ({
  accountId: 'SYN-A',
  isDetailAvailable: false,
  type: 'PAYMENT',
  status: 'POSTED',
  description: 'CORNER GROCER 0123 GLEBE AU',
  postingDateTime: '2025-03-14T09:12:00+11:00',
  amount: '-12.50',
  currency: 'AUD',
  reference: '',
  ...o,
});

describe('CDR validation (FR-ING-002)', () => {
  test('rejects the file with the first failing path; other files in the batch still import', async () => {
    const svc = new IngestService(new MemoryImportStore());
    const rec = await svc.importFiles([
      file(
        'bad.json',
        txnPage([tx({ transactionId: 'a1' }), tx({ transactionId: 'a2', amount: '12,50' })])
      ),
      file('good.json', txnPage([tx({ transactionId: 'b1' })])),
    ]);
    const bad = rec.files.find((f) => f.name === 'bad.json')!;
    expect(bad.status).toBe('rejected');
    expect(bad.message).toBe('$.data.transactions[1].amount is not a valid AmountString: "12,50"');
    expect(rec.files.find((f) => f.name === 'good.json')!.status).toBe('imported');
    expect(svc.current.txns.size).toBe(1);
  });

  test('keeps unknown fields in raw', async () => {
    const svc = await ingest([
      file('p.json', txnPage([tx({ transactionId: 'r1', bankSpecific: { x: 1 } })])),
    ]);
    expect([...svc.current.txns.values()][0]!.raw).toEqual({ bankSpecific: { x: 1 } });
  });

  test('skips files that are not CDR responses', async () => {
    const svc = new IngestService(new MemoryImportStore());
    const rec = await svc.importFiles([
      file('truth.json', { transactions: {} }),
      { name: 'budget.csv', bytes: enc.encode('a,b\n') },
    ]);
    expect(rec.files.map((f) => f.status)).toEqual(['skipped', 'skipped']);
    expect(rec.counts.new).toBe(0);
  });

  test('a missing required field is named', () => {
    const r = parseCdrText(JSON.stringify(txnPage([{ ...tx({}), reference: undefined }])));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('$.data.transactions[0].reference is required');
  });
});

describe('dedupe and ids (FR-ING-004, FR-ING-006)', () => {
  test('dedupes by (accountId, transactionId); synthesises stable ids when absent', async () => {
    const svc = new IngestService(new MemoryImportStore());
    const r1 = await svc.importFiles([
      file('p1.json', txnPage([tx({ transactionId: 'x1' }), tx({ description: 'NO ID' })])),
    ]);
    expect(r1.counts).toMatchObject({ new: 2, duplicate: 0 });
    const r2 = await svc.importFiles([
      file('p2.json', {
        ...txnPage([tx({ transactionId: 'x1' }), tx({ description: 'NO ID' })]),
        extra: 1,
      }),
    ]);
    expect(r2.counts).toMatchObject({ new: 0, duplicate: 2 });
    const noId = [...svc.current.txns.values()].find((t) => t.description === 'NO ID')!;
    expect(noId.idSynthetic).toBe(true);
    expect(noId.id).toMatch(/^H-[0-9a-f]{32}$/);
  });

  test('re-importing the same file is a no-op and is not recorded', async () => {
    const out = await synth('default');
    const svc = await ingest(cdrInputs(out));
    const before = svc.view();
    const again = await svc.importFiles(cdrInputs(out));
    expect(again.files.every((f) => f.status === 'duplicate-file')).toBe(true);
    expect(again.counts.new).toBe(0);
    expect(svc.view().txns).toEqual(before.txns);
    expect(svc.view().imports).toHaveLength(1);
  });

  test('an import can be undone as a unit', async () => {
    const out = await synth('default');
    const store = new MemoryImportStore();
    const svc = new IngestService(store);
    const a = await svc.importFiles(
      cdrInputs(out, (p) => p.includes('SYN-TXN') || p === 'accounts.json')
    );
    const sizeA = svc.current.txns.size;
    const b = await svc.importFiles(cdrInputs(out, (p) => p.includes('SYN-CC')));
    expect(svc.current.txns.size).toBeGreaterThan(sizeA);
    await svc.undo(b.id);
    expect(svc.current.txns.size).toBe(sizeA);
    expect(svc.view().imports.map((i) => i.id)).toEqual([a.id]);
    // And the store survives a restart.
    const svc2 = new IngestService(store);
    await svc2.load();
    expect(svc2.current.txns.size).toBe(sizeA);
  });

  test('reads a ZIP of response files', async () => {
    const out = await synth('frugal-renter');
    const inputs = cdrInputs(out);
    const zip = writeZip(inputs.map((i) => ({ name: i.name, data: i.bytes })));
    const fromZip = await ingest([{ name: 'export.zip', bytes: zip }]);
    const fromFiles = await ingest(inputs);
    expect(fromZip.current.txns.size).toBe(fromFiles.current.txns.size);
  });
});

describe('derived links against ground truth', () => {
  test('FR-ING-005: posted records supersede their pending records', async () => {
    const out = await synth('default');
    const svc = await ingest(cdrInputs(out));
    const pendings = [...svc.current.txns.values()].filter((t) => t.status === 'PENDING');
    expect(pendings.length).toBeGreaterThan(50);
    let correct = 0;
    for (const p of pendings) {
      const truth = out.truth.transactions[`${p.accountId}/${p.id}`]!;
      if ((truth.supersededBy ?? undefined) === p.supersededBy) correct++;
    }
    expect(correct / pendings.length).toBeGreaterThanOrEqual(0.98);
    // Superseded pendings never count.
    expect(pendings.filter((p) => p.supersededBy).every((p) => !isEffective(p))).toBe(true);
  });

  test.each(['default', 'high-capex-crypto', 'frugal-renter'])(
    'FR-ING-007: %s internal transfers are paired',
    async (name) => {
      const out = await synth(name);
      const svc = await ingest(cdrInputs(out));
      const txns = [...svc.current.txns.values()].filter((t) => t.status === 'POSTED');
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (const t of txns) {
        const isTruth = out.truth.transactions[`${t.accountId}/${t.id}`]!.kind === 'transfer';
        if (t.transferPairId && isTruth) tp++;
        else if (t.transferPairId) fp++;
        else if (isTruth) fn++;
      }
      expect(tp).toBeGreaterThan(0);
      expect(tp / (tp + fp)).toBeGreaterThanOrEqual(0.98);
      expect(tp / (tp + fn)).toBeGreaterThanOrEqual(0.98);
    }
  );
});

describe('reconciliation (FR-REC-001)', () => {
  test('a missing page shows up as a drift over its date range', async () => {
    const out = await synth('default');
    const svc = await ingest(cdrInputs(out, (p) => p !== 'transactions/SYN-CC/page-5.json'));
    const cc = reconcile(svc.current).find((r) => r.accountId === 'SYN-CC')!;
    expect(cc.gaps.length).toBeGreaterThan(0);
    for (const g of cc.gaps) expect(g.drift === 0n).toBe(false);
    const others = reconcile(svc.current).filter((r) => r.accountId !== 'SYN-CC');
    for (const r of others) expect(r.gaps).toEqual([]);
  });

  test('balances without x-as-at use the file time, labelled assumed', async () => {
    const body = {
      data: {
        balances: [{ accountId: 'SYN-A', currentBalance: '10.00', availableBalance: '10.00' }],
      },
      links: { self: 'x' },
      meta: { totalRecords: 1, totalPages: 1 },
    };
    const svc = new IngestService(new MemoryImportStore());
    await svc.importFiles([
      { ...file('b.json', body), lastModified: Date.parse('2025-03-01T00:00:00Z') },
    ]);
    const [cp] = svc.view().balances;
    expect(cp).toMatchObject({
      asAt: '2025-03-01T00:00:00.000Z',
      asAtSource: 'assumed',
      current: 1000n,
    });
  });
});

describe('timezone bucketing (FR-ING-008)', () => {
  test('dates are local to the configured zone and the original time is kept', async () => {
    const page = file(
      'p.json',
      txnPage([tx({ transactionId: 't1', postingDateTime: '2025-03-13T14:30:00Z' })])
    );
    const syd = new IngestService(new MemoryImportStore(), 'Australia/Sydney');
    await syd.importFiles([page]);
    const utc = new IngestService(new MemoryImportStore(), 'UTC');
    await utc.importFiles([page]);
    expect(syd.view().txns[0]!.date).toBe('2025-03-14');
    expect(utc.view().txns[0]!.date).toBe('2025-03-13');
    expect(syd.view().txns[0]!.postedAt).toBe('2025-03-13T14:30:00Z');
  });
});

describe('performance (SPEC §16.3)', () => {
  test('imports 10 000 transactions in under 3 s', async () => {
    const out = await synth('high-capex-crypto', '7', 116);
    const inputs = cdrInputs(out);
    const t0 = performance.now();
    const svc = await ingest(inputs);
    const ms = performance.now() - t0;
    expect(svc.current.txns.size).toBeGreaterThan(9500);
    expect(ms).toBeLessThan(3000);
  }, 20_000);
});
