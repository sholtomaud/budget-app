import { describe, expect, test } from 'vitest';
import { addMonths } from '../../src/lib/dates.ts';
import { earliestFreedom } from '../../src/optimise/earliest.ts';
import { baseValues } from '../../src/optimise/levers.ts';
import type { FreedomSetup } from '../../src/sim/inputs.ts';
import { monthsBetween } from '../../src/sim/modelgen.ts';
import { sampleScenario } from '../kernel/sim-fixtures.ts';

function setup(): FreedomSetup {
  const s = sampleScenario();
  return {
    version: 1,
    seed: s.seed,
    goal: s.goal,
    holdings: s.holdings,
    decisions: s.decisions,
    people: s.people,
    returnModels: s.returnModels,
    taxTable: s.taxTable,
    provenance: {},
  };
}

const START = setup().goal.start.slice(0, 7);
const months = (s: FreedomSetup) => monthsBetween(START, s.goal.start.slice(0, 7));
const shifted = (m: number) => addMonths(`${START}-01`, m).slice(0, 7);

/** A stand-in for pSuccess: a later start and less spending after freedom help. */
function fake(shift = 0) {
  const seen: number[] = [];
  const evaluate = (s: FreedomSetup) => {
    seen.push(months(s));
    const p = 0.5 + shift + (0.06 * months(s)) / 12 - 1.2 * (baseValues(s).tierSpend - 1);
    return Promise.resolve({
      pSuccess: Math.min(1, Math.max(0, p)),
      runId: `fake:${months(s)}:${baseValues(s).tierSpend}`,
    });
  };
  return { evaluate, seen };
}

describe('earliest freedom date (FR-OPT-001, ADR 0031)', () => {
  test('bisects to the earliest start that reaches the target, with two alternatives', async () => {
    const f = fake();
    const r = await earliestFreedom(
      { setup: setup(), target: 0.9, soonest: shifted(-24) },
      { evaluate: f.evaluate }
    );
    // p ≥ 0.9 from 80 months later; the grid is every 3 months from −24.
    expect(r.plans.map((p) => [p.id, p.months])).toEqual([
      ['target', 81],
      ['safer', 90],
      ['spend-less', 57],
    ]);
    const [first, safer, less] = r.plans;
    expect(first!.start).toBe(shifted(81));
    expect(first!.pSuccess).toBeGreaterThanOrEqual(0.9);
    expect(safer!.target).toBeCloseTo(0.95);
    expect(safer!.pSuccess).toBeGreaterThanOrEqual(0.95);
    expect(less!.tierSpend).toBe(0.9);
    expect(less!.setup.levers?.tierSpend).toBe(0.9);
    // Every answer was simulated, and the grid step before it missed.
    expect(f.seen).toContain(78);
    expect(r.current.start).toBe(START);
    // A search, not a sweep: far fewer simulations than grid points (≈ 49).
    expect(r.simulations).toBeLessThan(25);
  });

  test('a plan that already works looks for sooner dates, back to the soonest', async () => {
    const f = fake(0.5);
    const r = await earliestFreedom(
      { setup: setup(), target: 0.9, soonest: shifted(-60) },
      { evaluate: f.evaluate }
    );
    // p ≥ 0.9 from 20 months sooner: the first grid point at or after −20 is −18.
    expect(r.plans[0]).toMatchObject({ id: 'target', months: -18 });
    expect(f.seen.every((m) => m >= -60)).toBe(true);
  });

  test('alternatives on the same date as the first are dropped', async () => {
    const r = await earliestFreedom(
      { setup: setup(), target: 0.5, soonest: shifted(-12) },
      { evaluate: async () => ({ pSuccess: 1, runId: 'always' }) }
    );
    expect(r.plans.map((p) => [p.id, p.months])).toEqual([['target', -12]]);
  });

  test('when no date in range works, it says how close the latest came', async () => {
    const r = await earliestFreedom(
      { setup: setup(), target: 0.9, soonest: shifted(-12), laterYears: 2 },
      { evaluate: fake(-0.3).evaluate }
    );
    expect(r.plans.filter((p) => p.id !== 'spend-less')).toEqual([]);
    expect(r.latest).toMatchObject({ start: shifted(24) });
    expect(r.latest!.pSuccess).toBeLessThan(0.9);
  });

  test('the same inputs give the same answer (NFR-DET-001)', async () => {
    const run = () =>
      earliestFreedom(
        { setup: setup(), target: 0.9, soonest: shifted(-24) },
        { evaluate: fake().evaluate }
      );
    const [a, b] = [await run(), await run()];
    expect(a.plans.map((p) => p.runId)).toEqual(b.plans.map((p) => p.runId));
  });
});
