/**
 * Simulation properties with common random numbers (SPEC §16.1): run i has
 * the same seed in every variant, so each comparison is run by run.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import type { Scenario, WithdrawalStrategy } from '../../src/sim/model.ts';
import { simulate } from '../../src/sim/montecarlo.ts';
import { loadKernel } from '../kernel/helpers.ts';
import { sampleScenario, sampleSpending } from '../kernel/sim-fixtures.ts';
import { forAll } from './prop.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

const RUNS = 8;

function randomCase(rng: import('../../src/lib/prng.ts').Rng) {
  const base = sampleScenario();
  const withdrawal: WithdrawalStrategy = rng.chance(0.5)
    ? { kind: 'fixed-real' }
    : { kind: 'hold', holdingIds: ['super'] };
  const scale = (v: bigint) => BigInt(Math.round(Number(v) * rng.uniform(0.2, 1.2)));
  const s: Scenario = {
    ...base,
    seed: String(rng.int(1_000_000)),
    goal: {
      ...base.goal,
      start: '2028-01-01',
      horizonYears: 8,
      floor: BigInt(rng.int(3)) * 50_000_00n,
    },
    holdings: base.holdings.map((h) => ({ ...h, value: scale(h.value) })),
    decisions: { ...base.decisions, withdrawal },
    taxTable: rng.chance(0.8) ? base.taxTable : null,
  };
  const monthly = rng.uniform(3_000, 9_000);
  return { s, monthly };
}

const spend = (m: number, k = 1) =>
  sampleSpending({ current: { all: m * k }, tier: { all: m * 0.9 * k } });

describe('simulation properties (SPEC §16.1)', () => {
  test('more starting capital never turns a success into a failure', () =>
    forAll(6, 'sim: more capital', (rng) => {
      const { s, monthly } = randomCase(rng);
      const a = simulate(kernel, s, spend(monthly), { runs: RUNS });
      const b = simulate(kernel, s, spend(monthly), { runs: RUNS, holdingScale: 1.5 });
      expect(b.pSuccess).toBeGreaterThanOrEqual(a.pSuccess);
      a.summaries.forEach((r, i) => {
        if (r.success) expect(b.summaries[i]!.success, `run ${i}`).toBe(true);
        expect(b.summaries[i]!.minCapital, `run ${i}`).toBeGreaterThanOrEqual(r.minCapital - 1e-6);
      });
    }));

  test('more spending never turns a failure into a success (doubling OPEX)', () =>
    forAll(6, 'sim: more spending', (rng) => {
      const { s, monthly } = randomCase(rng);
      const a = simulate(kernel, s, spend(monthly), { runs: RUNS });
      const b = simulate(kernel, s, spend(monthly, 2), { runs: RUNS });
      expect(b.pSuccess).toBeLessThanOrEqual(a.pSuccess);
      a.summaries.forEach((r, i) => {
        if (!r.success) expect(b.summaries[i]!.success, `run ${i}`).toBe(false);
      });
    }));

  test('the money balance holds in every run (FR-SIM-003)', () =>
    forAll(6, 'sim: balance', (rng) => {
      const { s, monthly } = randomCase(rng);
      const r = simulate(kernel, s, spend(monthly), { runs: RUNS });
      expect(r.invalidRuns).toBe(0);
      expect(r.maxDrift).toBeLessThanOrEqual(1e-9);
    }));
});
