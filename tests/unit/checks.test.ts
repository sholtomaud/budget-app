/** Plan checks (ADR 0026). */
import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService } from '../../src/data/service.ts';
import { MemoryImportStore } from '../../src/ingest/service.ts';
import { checkPlan } from '../../src/sim/checks.ts';
import { asOfFor, defaultSetup, spendingFrom, type FreedomSetup } from '../../src/sim/inputs.ts';
import { cdrInputs, synth } from '../helpers/synth.ts';

async function household() {
  const svc = new DataService(new MemoryImportStore(), new MemoryStateStore());
  await svc.importFiles(cdrInputs(await synth('default')));
  const v = svc.view();
  const setup = defaultSetup(v);
  return { setup, spending: spendingFrom(v, setup.goal.tier), asOf: asOfFor(v.txns) };
}

const ids = (s: FreedomSetup, h: Awaited<ReturnType<typeof household>>) =>
  checkPlan(s, h.spending, h.asOf).map((c) => c.id);

describe('plan checks (ADR 0026)', () => {
  test("the project owner's plan: no pay, freedom in 2042, $700,000 kept in the bank", async () => {
    const h = await household();
    const setup: FreedomSetup = {
      ...h.setup,
      goal: { ...h.setup.goal, tier: 'secure', start: '2042-07-01' },
      decisions: { ...h.setup.decisions, netPayMonthly: 0n, bankBuffer: 70_000_000n },
      people: h.setup.people.map((p) => ({ ...p, grossSalary: 0n })),
    };
    const checks = checkPlan(setup, h.spending, h.asOf);
    expect(checks.map((c) => c.id)).toEqual(['no-pay', 'idle-bank', 'all-cash']);

    const noPay = checks[0]!;
    expect(noPay.level).toBe('problem');
    expect(noPay.text).toContain('No pay comes in before freedom starts in July 2042');
    expect(noPay.fix!.setup.goal.start).toBe(`${h.asOf}-01`);
    // The fix leaves everything else alone.
    expect(noPay.fix!.setup.holdings).toEqual(setup.holdings);

    const bank = checks[1]!;
    expect(bank.text).toContain('$700,000 is in "Cash kept in the bank"');
    const fixed = bank.fix!.setup;
    // Six months of spending stays in the bank; the rest moves to the savings holding, nothing lost.
    const total = (s: FreedomSetup) =>
      s.holdings.reduce((a, x) => a + x.value, 0n) + s.decisions.bankBuffer;
    expect(total(fixed)).toBe(total(setup));
    expect(fixed.decisions.bankBuffer).toBeLessThan(5_000_000n);
    expect(fixed.decisions.bankBuffer).toBeGreaterThan(0n);

    // Not a product recommendation: no fix, and it points at an adviser.
    expect(checks[2]!.fix).toBeUndefined();
    expect(checks[2]!.text).toContain('licensed adviser');

    // With both fixes applied, those problems are gone.
    const both = {
      ...fixed,
      goal: noPay.fix!.setup.goal,
      decisions: { ...fixed.decisions, workUntil: undefined },
    };
    expect(ids(both, h)).not.toContain('no-pay');
    expect(ids(both, h)).not.toContain('idle-bank');
  });

  test('paid work ending years before freedom starts', async () => {
    const h = await household();
    const setup = {
      ...h.setup,
      goal: { ...h.setup.goal, start: '2031-07-01' },
      decisions: { ...h.setup.decisions, workUntil: '2028-07-01' },
    };
    const c = checkPlan(setup, h.spending, h.asOf).find((x) => x.id === 'pay-gap')!;
    expect(c.text).toContain('Paid work ends in July 2028, 3 years before freedom starts');
    expect(c.fix!.setup.decisions.workUntil).toBeUndefined();
  });

  test('spending more than take-home pay', async () => {
    const h = await household();
    const setup = { ...h.setup, decisions: { ...h.setup.decisions, netPayMonthly: 200_000n } };
    expect(ids(setup, h)).toContain('over-spending');
  });

  test('the default sample plan has no problems', async () => {
    const h = await household();
    const problems = checkPlan(h.setup, h.spending, h.asOf).filter((c) => c.level === 'problem');
    expect(problems).toEqual([]);
  });
});
