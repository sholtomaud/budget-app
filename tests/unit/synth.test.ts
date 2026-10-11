import { describe, expect, test } from 'vitest';
import { parseCdrText } from '../../src/ingest/cdr/parse.ts';
import { reconcile } from '../../src/ingest/ledger.ts';
import { sha256Hex } from '../../src/lib/hash.ts';
import { parsePersona } from '../../src/synth/persona.ts';
import { generate } from '../../src/synth/generator.ts';
import { cdrInputs, ingest, loadPersona, PERSONAS, synth } from '../helpers/synth.ts';

describe('synthetic generator', () => {
  test('FR-SYN-001: same persona and seed give byte-identical output; another seed differs', async () => {
    const a = await generate(loadPersona('default'), '42');
    const b = await generate(loadPersona('default'), '42');
    expect(a.files.map((f) => [f.path, f.content])).toEqual(
      b.files.map((f) => [f.path, f.content])
    );
    const c = await generate(loadPersona('default'), '43');
    expect(c.files.find((f) => f.path === 'truth.json')!.content).not.toBe(
      a.files.find((f) => f.path === 'truth.json')!.content
    );
  });

  test.each(PERSONAS)(
    'FR-SYN-002: every %s CDR file validates against the pinned schemas',
    async (name) => {
      const out = await synth(name);
      const cdr = out.files.filter((f) => /^(accounts|balances|transactions)/.test(f.path));
      expect(cdr.length).toBeGreaterThan(10);
      for (const f of cdr) {
        const r = parseCdrText(f.content);
        expect(r.ok, `${f.path}: ${r.ok ? '' : r.message}`).toBe(true);
      }
    }
  );

  test.each(PERSONAS)('FR-SYN-003: %s balances reconcile to the cent', async (name) => {
    const svc = await ingest(cdrInputs(await synth(name)));
    const rec = reconcile(svc.current);
    for (const r of rec) {
      expect(r.checkpoints).toBe(25);
      expect(r.gaps).toEqual([]);
    }
    // Exactly to the cent, not just within the AUD 1 tolerance.
    const view = svc.view();
    for (const acct of view.accounts) {
      const cps = view.balances.filter((b) => b.accountId === acct.id);
      const first = cps[0]!;
      const last = cps.at(-1)!;
      const sum = view.txns
        .filter(
          (t) =>
            t.accountId === acct.id &&
            t.status === 'POSTED' &&
            Date.parse(t.postedAt!) > Date.parse(first.asAt) &&
            Date.parse(t.postedAt!) <= Date.parse(last.asAt)
        )
        .reduce((s, t) => s + t.amount, 0n);
      expect(first.current + sum).toBe(last.current);
    }
  });

  test.each(PERSONAS)(
    'FR-SYN-004: truth labels every %s transaction, and is marked synthetic',
    async (name) => {
      const out = await synth(name);
      const svc = await ingest(cdrInputs(out));
      const truth = out.truth.transactions;
      for (const t of svc.current.txns.values())
        expect(truth[`${t.accountId}/${t.id}`], `${t.accountId}/${t.id}`).toBeDefined();
      expect(Object.keys(truth).length).toBe(svc.current.txns.size);
      for (const f of out.files.filter((f) => f.path.endsWith('.json')))
        expect(JSON.parse(f.content)['x-synthetic']).toBeDefined();
      for (const f of out.files.filter((f) => f.path.endsWith('.csv')))
        expect(f.content.startsWith('# x-synthetic:')).toBe(true);
    }
  );

  test('FR-SYN-005: capex purchases follow each asset’s life from lastBought', async () => {
    const out = await synth('high-capex-crypto');
    const laptop = out.truth.assets.find((a) => a.assetId === 'laptop')!;
    expect(laptop.lastBought).toBe('2022-11-01');
    expect(laptop.purchases.length).toBeGreaterThan(0);
    expect(laptop.purchases[0]! > laptop.lastBought!).toBe(true);
    // One capex purchase per sampled replacement (pending copies of a purchase share its execution date).
    const svc = await ingest(cdrInputs(out));
    const purchases = new Set<string>();
    for (const t of svc.current.txns.values()) {
      const label = out.truth.transactions[`${t.accountId}/${t.id}`]!;
      if (label.kind === 'capex')
        purchases.add(`${label.assetId}@${(t.executedAt ?? '').slice(0, 10)}`);
    }
    expect(purchases.size).toBe(out.truth.assets.reduce((s, a) => s + a.purchases.length, 0));
    for (const a of out.truth.assets.filter((a) => a.lifeYears && !a.purchases.length)) {
      expect(a.nextReplacement === null || a.nextReplacement > '2026-06-30').toBe(true);
    }
  });

  test('FR-SYN-006: the three committed personas are valid', () => {
    for (const name of PERSONAS) expect(loadPersona(name).name).toBe(name);
    expect(() => parsePersona({ ...loadPersona('default'), timezone: 'Mars/Olympus' })).toThrow(
      /timezone/
    );
    expect(() =>
      parsePersona({
        ...loadPersona('default'),
        accounts: [{ id: 'REAL-1', role: 'transaction', productCategory: 'X' }],
      })
    ).toThrow(/SYN-/);
  });

  test('noise is present: pending records, missing ids, merchant variants', async () => {
    const out = await synth('default');
    const all = out.files
      .filter((f) => f.path.startsWith('transactions/'))
      .flatMap((f) => JSON.parse(f.content).data.transactions as Record<string, unknown>[]);
    expect(all.some((t) => t.status === 'PENDING')).toBe(true);
    expect(all.some((t) => !('transactionId' in t))).toBe(true);
    expect(
      new Set(
        all
          .filter((t) => t.merchantName && String(t.merchantName).startsWith('Fresh Fields'))
          .map((t) => t.description)
      ).size
    ).toBeGreaterThan(1);
  });

  test('golden: generator output hashes are pinned (update deliberately)', async () => {
    const hashes: Record<string, string> = {};
    for (const name of PERSONAS) {
      const out = await synth(name);
      hashes[name] = await sha256Hex(out.files.map((f) => `${f.path}\n${f.content}`).join('\n'));
    }
    expect(hashes).toMatchSnapshot();
  });
});

describe('committed fixtures', () => {
  test.each(PERSONAS)(
    'fixtures/syn-%s-42 matches the generator byte for byte (run `npm run fixtures`)',
    async (name) => {
      const { readFileSync, readdirSync, statSync } = await import('node:fs');
      const { join, relative } = await import('node:path');
      const dir = new URL(`../../fixtures/syn-${name}-42/`, import.meta.url).pathname;
      const walk = (d: string): string[] =>
        readdirSync(d).flatMap((f) =>
          statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]
        );
      const onDisk = Object.fromEntries(
        walk(dir).map((p) => [relative(dir, p), readFileSync(p, 'utf8')])
      );
      const generated = Object.fromEntries(
        (await synth(name)).files.map((f) => [f.path, f.content])
      );
      expect(Object.keys(onDisk).sort()).toEqual(Object.keys(generated).sort());
      for (const [path, content] of Object.entries(generated))
        expect(onDisk[path], path).toBe(content);
    }
  );
});
