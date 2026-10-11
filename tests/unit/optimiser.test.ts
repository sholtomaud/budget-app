import { describe, expect, test } from 'vitest';
import { tsCma } from '../../src/optimise/cmaes.ts';
import { baseValues, applyLevers } from '../../src/optimise/levers.ts';
import { gridPoints, optimise, pareto, type AsyncCma } from '../../src/optimise/optimiser.ts';
import type { FreedomSetup } from '../../src/sim/inputs.ts';
import { sampleScenario } from '../kernel/sim-fixtures.ts';

const asyncCma: AsyncCma = {
  init: async (x0, s, l) => tsCma.init(x0, s, l),
  ask: async (st, z) => tsCma.ask(st, z),
  tell: async (st, x, f) => tsCma.tell(st, x, f),
};

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

/** A smooth stand-in for pSuccess: later freedom and less spending help. */
function fake(s: FreedomSetup) {
  const v = baseValues(s);
  const years = (Date.parse(s.goal.start) - Date.parse(setup().goal.start)) / (365.25 * 864e5);
  const p =
    0.5 +
    0.06 * years -
    1.2 * (v.tierSpend - 1) -
    0.8 * (v.currentSpend - 1) +
    v.projectIncome / 100_000;
  return Promise.resolve({
    pSuccess: Math.min(1, Math.max(0, p)),
    runId: `fake:${years.toFixed(2)}`,
  });
}

describe('levers', () => {
  test('apply moves freedom and paid work together, and scales spending', () => {
    const s = { ...setup(), decisions: { ...setup().decisions, workUntil: '2030-06-01' } };
    const moved = applyLevers(s, { start: 2.5, tierSpend: 0.9, projectIncome: 12_000 });
    expect(moved.goal.start).toBe('2033-07-01');
    expect(moved.decisions.workUntil).toBe('2032-12-01');
    expect(moved.levers).toEqual({ tierSpend: 0.9, currentSpend: 1 });
    expect(moved.goal.projectIncome).toBe(1_200_000n);
    expect(baseValues(moved).tierSpend).toBe(0.9);
  });
});

describe('optimiser (FR-OPT-001)', () => {
  test('grid search: the smallest change that reaches the target', async () => {
    const r = await optimise(
      {
        setup: setup(),
        target: 0.9,
        levers: [
          { id: 'start', lo: 0, hi: 10 },
          { id: 'tierSpend', lo: 0.7, hi: 1.1 },
        ],
      },
      { evaluate: fake, cma: asyncCma }
    );
    expect(r.method).toBe('grid');
    expect(r.base.feasible).toBe(false);
    const b = r.best!;
    expect(b.pSuccess).toBeGreaterThanOrEqual(0.9);
    // In normalised units p = 0.86 + 0.6·a − 0.48·b, base (0, 0.75): the nearest
    // feasible point is 0.4 / √(0.6² + 0.48²) ≈ 0.521 away.
    expect(b.distance).toBeGreaterThanOrEqual(0.52);
    expect(b.distance).toBeLessThan(0.55);
    expect(r.candidates.every((c) => c.runId.startsWith('fake:'))).toBe(true);
  });

  test('CMA-ES for more than two levers finds a feasible, smaller change', async () => {
    const r = await optimise(
      {
        setup: setup(),
        target: 0.9,
        budget: 120,
        levers: [
          { id: 'start', lo: 0, hi: 10 },
          { id: 'tierSpend', lo: 0.7, hi: 1.1 },
          { id: 'currentSpend', lo: 0.7, hi: 1 },
          { id: 'projectIncome', lo: 0, hi: 40_000 },
        ],
      },
      { evaluate: fake, cma: asyncCma }
    );
    expect(r.method).toBe('cma-es');
    expect(r.best).not.toBeNull();
    expect(r.best!.pSuccess).toBeGreaterThanOrEqual(0.9);
    expect(r.best!.distance).toBeLessThan(0.6);
  });

  test('a setup already on target is its own answer', async () => {
    const r = await optimise(
      { setup: setup(), target: 0.4, levers: [{ id: 'start', lo: 0, hi: 5 }] },
      { evaluate: fake, cma: asyncCma }
    );
    expect(r.best).toBe(r.base);
    expect(r.candidates).toHaveLength(1);
  });

  test('the Pareto set has no dominated member', () => {
    const mk = (p: number, t: number, start: number) =>
      ({
        pSuccess: p,
        values: { start, tierSpend: t, currentSpend: 1, projectIncome: 0 },
      }) as never;
    const cs = [mk(0.9, 1, 2), mk(0.8, 1, 2), mk(0.95, 0.9, 3), mk(0.7, 1.1, 0), mk(0.9, 1, 3)];
    const f = pareto(cs);
    expect(f).toHaveLength(3);
    expect(f.map((c) => c.values.start)).toEqual([0, 2, 3]);
  });

  test('grid points cover the corners', () => {
    expect(gridPoints(2, 3)).toHaveLength(9);
    expect(gridPoints(2, 3)).toContainEqual([1, 0]);
  });
});
