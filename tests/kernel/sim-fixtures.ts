import type { Scenario, SpendingInput } from '../../src/sim/model.ts';
import { DEFAULT_RETURN_MODELS } from '../../src/sim/model.ts';

/** A synthetic couple, ten years from freedom. All values illustrative. */
export function sampleScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 'test',
    name: 'Test household',
    seed: '42',
    asOf: '2026-01',
    goal: {
      id: 'g',
      name: 'Freedom',
      tier: 'independent',
      start: '2031-01-01',
      horizonYears: 30,
      floor: 0n,
      targetProbability: 0.9,
    },
    holdings: [
      {
        id: 'cash',
        name: 'Savings',
        assetClass: 'cash',
        value: 40_000_00n,
        returnModelId: 'cash',
        provenance: 'illustrative',
      },
      {
        id: 'etf',
        name: 'Shares',
        assetClass: 'equity',
        value: 600_000_00n,
        costBase: 400_000_00n,
        acquiredAt: '2018-03-01',
        returnModelId: 'equity',
        owner: 'joint',
        provenance: 'illustrative',
      },
      {
        id: 'super',
        name: 'Super',
        assetClass: 'super',
        value: 300_000_00n,
        returnModelId: 'super',
        accessibleFrom: '2040-01-01',
        provenance: 'illustrative',
      },
    ],
    decisions: {
      withdrawal: { kind: 'fixed-real' },
      sellOrder: ['cash', 'etf', 'super'],
      allocation: { etf: 1 },
      bankBuffer: 10_000_00n,
      netPayMonthly: 12_000_00n,
    },
    people: [
      { id: 'p1', name: 'A', grossSalary: 120_000_00n },
      { id: 'p2', name: 'B', grossSalary: 60_000_00n },
    ],
    returnModels: DEFAULT_RETURN_MODELS,
    cpi: 0.03,
    taxTable: 'au-2025-26',
    ...over,
  };
}

export function sampleSpending(over: Partial<SpendingInput> = {}): SpendingInput {
  return {
    current: { housing: 3000, food: 1500, other: 2500 },
    tier: { housing: 2500, food: 1400, other: 2000 },
    ratio: null,
    assets: [],
    capexMonthly: 0,
    ...over,
  };
}
