import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService } from '../../src/data/service.ts';
import { MemoryImportStore } from '../../src/ingest/service.ts';
import {
  DEFAULT_TAX_TABLE,
  defaultSetup,
  grossFromNet,
  scenarioFrom,
  spendingFrom,
} from '../../src/sim/inputs.ts';
import { taxTable, totalTax } from '../../src/sim/tax.ts';
import { cdrInputs, synth } from '../helpers/synth.ts';

async function household(persona: string) {
  const svc = new DataService(new MemoryImportStore(), new MemoryStateStore());
  await svc.importFiles(cdrInputs(await synth(persona)));
  // Label the investment transfers as a user would from the review queue.
  for (const [to, cat] of [
    ['SYN-EXCHANGE', 'investment.btc'],
    ['SYN-BROKER', 'investment.etf'],
  ] as const) {
    const t = svc.view().txns.find((x) => x.description.includes(to));
    if (t) await svc.correct([`${t.accountId}\u001f${t.id}`], cat, true);
  }
  return svc.view();
}

describe('freedom inputs from household data (SPEC §11)', () => {
  test('gross salary inverts the tax on take-home pay', () => {
    const t = taxTable(DEFAULT_TAX_TABLE);
    const g = grossFromNet(80_000);
    expect(g - totalTax(t, g)).toBeCloseTo(80_000, 4);
  });

  test('a synthetic household gives a labelled default setup', async () => {
    const v = await household('high-capex-crypto');
    const s = defaultSetup(v);
    // Savings accounts become cash holdings at their balance (actual).
    expect(s.holdings.some((h) => h.assetClass === 'cash' && h.provenance === 'actual')).toBe(true);
    // Money paid into BTC and shares becomes holdings at cost, labelled assumed.
    const btc = s.holdings.find((h) => h.assetClass === 'btc');
    expect(btc?.provenance).toBe('assumed');
    expect(btc!.value).toBeGreaterThan(0n);
    expect(Object.keys(s.decisions.allocation).length).toBeGreaterThan(0);
    expect(s.decisions.netPayMonthly!).toBeGreaterThan(0n);
    expect(s.people[0]!.grossSalary).toBeGreaterThan(s.decisions.netPayMonthly! * 12n);
    // Most liquid first.
    expect(s.holdings.find((h) => h.id === s.decisions.sellOrder[0])!.assetClass).toBe('cash');

    const sp = spendingFrom(v, s.goal.tier);
    expect(Object.values(sp.current).reduce((a, b) => a + b, 0)).toBeGreaterThan(1000);
    expect(sp.tierSource).toBe('actual'); // no budget lines in a bare import
    expect(sp.tier).toEqual(sp.current);
    expect(sp.capexMonthly).toBeGreaterThanOrEqual(0);

    const sc = scenarioFrom(s, '2026-07', 0.03);
    expect(sc.asOf).toBe('2026-07');
    expect(sc.taxTable).toBe(DEFAULT_TAX_TABLE);
  });

  test('the forecast spread becomes a multiplier around 1', async () => {
    const v = await household('default');
    const q = { p5: [80], p10: [90], p25: [95], p50: [100], p75: [105], p90: [110], p95: [130] };
    const sp = spendingFrom(v, 'independent', q);
    expect(sp.ratio!.p50).toEqual([1]);
    expect(sp.ratio!.p95).toEqual([1.3]);
  });
});
