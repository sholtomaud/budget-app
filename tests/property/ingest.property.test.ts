import { describe, expect, test } from 'vitest';
import { reconcile } from '../../src/ingest/ledger.ts';
import { IngestService, MemoryImportStore, type InputFile } from '../../src/ingest/service.ts';
import { cdrInputs, ingest, synth } from '../helpers/synth.ts';
import { forAll } from './prop.ts';

/** The ledger with import bookkeeping stripped, in a canonical order. */
function canonical(svc: IngestService) {
  const v = svc.view();
  return {
    accounts: v.accounts.map((a) => ({ ...a, source: { kind: a.source.kind } })),
    txns: v.txns
      .map(({ importIds: _i, ...t }) => t)
      .sort((a, b) => (a.accountId + a.id < b.accountId + b.id ? -1 : 1)),
    balances: v.balances
      .map(({ importId: _i, ...b }) => b)
      .sort((a, b) => (a.accountId + a.asAt < b.accountId + b.asAt ? -1 : 1)),
  };
}

describe('ingest properties (SPEC §16.1)', () => {
  test('import order, batching and page overlap never change the result', async () => {
    const out = await synth('default', '42', 6);
    const inputs = cdrInputs(out);
    const reference = canonical(await ingest(inputs));
    await forAll(12, 'ingest-order', async (rng) => {
      // Shuffle, duplicate some files under new names (overlapping exports), split into batches.
      const files: InputFile[] = rng.shuffle(inputs);
      for (const f of inputs)
        if (rng.chance(0.2))
          files.splice(rng.int(files.length + 1), 0, { ...f, name: `${f.name}.copy` });
      const svc = new IngestService(new MemoryImportStore());
      let i = 0;
      while (i < files.length) {
        const n = 1 + rng.int(6);
        await svc.importFiles(files.slice(i, i + n));
        i += n;
      }
      expect(canonical(svc)).toEqual(reference);
    });
  });

  test('re-slicing pages with overlaps never changes the result', async () => {
    const out = await synth('default', '42', 6);
    const inputs = cdrInputs(out);
    const reference = canonical(await ingest(inputs));
    const dec = new TextDecoder();
    await forAll(8, 'ingest-overlap', async (rng) => {
      const extra: InputFile[] = [];
      for (const f of inputs.filter((x) => x.name.startsWith('transactions/'))) {
        const doc = JSON.parse(dec.decode(f.bytes));
        const items = doc.data.transactions as unknown[];
        const a = rng.int(items.length);
        const b = a + rng.int(items.length - a + 1);
        extra.push({
          name: `${f.name}#${a}-${b}`,
          bytes: new TextEncoder().encode(
            JSON.stringify({ ...doc, data: { transactions: items.slice(a, b) } })
          ),
        });
      }
      const svc = await ingest(rng.shuffle([...inputs, ...extra]));
      expect(canonical(svc)).toEqual(reference);
    });
  });
});

describe('synth properties', () => {
  test('balances always reconcile and every file validates, for any seed', async () => {
    await forAll(10, 'synth-seeds', async (rng) => {
      const seed = String(rng.int(1_000_000_000));
      const persona = rng.pick(['frugal-renter', 'default', 'high-capex-crypto']);
      const out = await synth(persona, seed, 4);
      const svc = await ingest(cdrInputs(out));
      const rejected = svc
        .view()
        .imports.flatMap((i) => i.files)
        .filter((f) => f.status === 'rejected');
      expect(rejected, `${persona} seed ${seed}`).toEqual([]);
      for (const r of reconcile(svc.current))
        expect(r.gaps, `${persona} seed ${seed} ${r.accountId}`).toEqual([]);
    });
  });
});
