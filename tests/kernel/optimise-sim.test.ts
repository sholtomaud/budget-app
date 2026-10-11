import { beforeAll, describe, expect, test } from 'vitest';
import { tsCma } from '../../src/optimise/cmaes.ts';
import { optimise, type AsyncCma } from '../../src/optimise/optimiser.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { applySpendingLevers, type FreedomSetup } from '../../src/sim/inputs.ts';
import { simulate } from '../../src/sim/montecarlo.ts';
import { loadKernel } from './helpers.ts';
import { sampleScenario, sampleSpending } from './sim-fixtures.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

const cma: AsyncCma = {
  init: async (x, s, l) => tsCma.init(x, s, l),
  ask: async (s, z) => tsCma.ask(s, z),
  tell: async (s, x, f) => tsCma.tell(s, x, f),
};

function setup(): FreedomSetup {
  const s = sampleScenario({
    goal: { ...sampleScenario().goal, start: '2028-01-01', horizonYears: 15 },
  });
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

const spending = sampleSpending({ current: { all: 8_000 }, tier: { all: 7_500 } });

/** The optimiser's evaluation on the real simulator, as the app does it. */
const evaluate = async (s: FreedomSetup) => {
  const scenario = {
    ...sampleScenario(),
    ...s,
    asOf: '2026-01',
    cpi: 0.03,
    id: 'opt',
    name: 'opt',
  };
  const r = simulate(kernel, scenario, applySpendingLevers(spending, s.levers), { runs: 12 });
  return { pSuccess: r.pSuccess, runId: `seed ${s.seed}·runs 0–11` };
};

describe('optimiser on the simulator (FR-OPT-001)', () => {
  test('finds a later start or leaner spending that reaches the target, deterministically', async () => {
    const req = {
      setup: setup(),
      target: 0.9,
      budget: 20,
      levers: [
        { id: 'start' as const, lo: 0, hi: 8 },
        { id: 'tierSpend' as const, lo: 0.6, hi: 1 },
      ],
    };
    const a = await optimise(req, { evaluate, cma });
    expect(a.base.feasible).toBe(false);
    expect(a.best).not.toBeNull();
    expect(a.best!.pSuccess).toBeGreaterThanOrEqual(0.9);
    // Common random numbers and a fixed search: the same answer every time.
    const b = await optimise(req, { evaluate, cma });
    expect(b.best!.values).toEqual(a.best!.values);
    expect(b.candidates.map((c) => c.pSuccess)).toEqual(a.candidates.map((c) => c.pSuccess));
  }, 60_000);
});

describe('golden simulation (SPEC §16.1)', () => {
  test('fixed scenario and seed give fixed results', () => {
    const s = sampleScenario({
      goal: { ...sampleScenario().goal, start: '2029-01-01', horizonYears: 10 },
    });
    const r = simulate(kernel, s, sampleSpending(), { runs: 24 });
    expect({
      pSuccess: r.pSuccess,
      p50End: r.capital.p50.at(-1)!.toFixed(6),
      p10End: r.capital.p10.at(-1)!.toFixed(6),
      tax0: r.summaries[0]!.totalTax.toFixed(6),
    }).toMatchSnapshot();
  });
});
