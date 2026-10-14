/** Plan checks (ADR 0026). */
import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService } from '../../src/data/service.ts';
import { MemoryImportStore } from '../../src/ingest/service.ts';
import { checkPlan } from '../../src/sim/checks.ts';
import {
  applySpendingLevers,
  asOfFor,
  defaultSetup,
  isEssential,
  minTierSpend,
  spendingFrom,
  type FreedomSetup,
} from '../../src/sim/inputs.ts';
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

  test('spending after freedom below what the essentials cost (ADR 0033)', async () => {
    const h0 = await household();
    expect(h0.spending.essentials!.monthly).toBeGreaterThan(0);
    expect(h0.spending.essentials!.top[0]!.categoryId).toMatch(
      /^(housing|food|utilities|comms|health|transport|fees)/
    );
    // Rent of $3,000 a month, as in a household whose rent is categorised.
    const tierTotal = Object.values(h0.spending.tier).reduce((a, b) => a + b, 0);
    const e = {
      monthly: tierTotal * 0.8,
      source: 'actual' as const,
      top: [{ categoryId: 'housing.rent', monthly: tierTotal * 0.7 }],
    };
    const h = { ...h0, spending: { ...h0.spending, essentials: e } };
    // At 63 % of the tier, the plan can't pay for them.
    const lever = 0.63;
    const low = { ...h.setup, levers: { tierSpend: lever, currentSpend: 1 } };
    const spending = applySpendingLevers(h.spending, low.levers);
    const c = checkPlan(low, spending, h.asOf).find((x) => x.id === 'below-essentials');
    expect(c?.level).toBe('problem');
    expect(c?.text).toContain('essentials');
    expect(c?.text).toContain('rent');
    // The fix spends exactly enough, and with it the check is gone.
    const need = minTierSpend(spending, lever);
    expect(c?.fix?.setup.levers?.tierSpend).toBe(need);
    const fixed = applySpendingLevers(h.spending, c!.fix!.setup.levers);
    expect(Object.values(fixed.tier).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
      e.monthly * 0.99
    );
    expect(checkPlan(c!.fix!.setup, fixed, h.asOf).map((x) => x.id)).not.toContain(
      'below-essentials'
    );
  });

  test('essentials: rent and groceries count, cafes do not; the larger of actual and the lowest budget', () => {
    expect(isEssential('housing.rent')).toBe(true);
    expect(isEssential('food.groceries')).toBe(true);
    expect(isEssential('food.cafe')).toBe(false);
    expect(isEssential('leisure.travel')).toBe(false);
  });
});
