import { beforeAll, describe, expect, test } from 'vitest';
import { addMonths } from '../../src/lib/dates.ts';
import { makePlan, runOnce, wire } from '../../src/sim/controller.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import {
  bridgeFreedom,
  deterministicFreedom,
  p90Freedom,
  projectRunway,
  shortfallDrivers,
  yearsToFreedom,
  type Runner,
} from '../../src/sim/metrics.ts';
import type { ReturnModel, Scenario } from '../../src/sim/model.ts';
import { modelgen, POOL } from '../../src/sim/modelgen.ts';
import {
  combine,
  NoValidRunsError,
  runChunk,
  runSeed,
  simulate,
} from '../../src/sim/montecarlo.ts';
import { monthlyFixed } from '../../src/sim/returns.ts';
import { loadKernel } from './helpers.ts';
import { sampleScenario, sampleSpending } from './sim-fixtures.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

/** A short scenario so the kernel tests stay fast: 3 years working, 5 years free. */
const short = (over: Partial<Scenario> = {}) =>
  sampleScenario({
    goal: { ...sampleScenario().goal, start: '2029-01-01', horizonYears: 5 },
    ...over,
  });

const local: Runner = async (req) => simulate(kernel, req.scenario, req.spending, req);

describe('modelgen (FR-SIM-001)', () => {
  test('GSSK_Init accepts the generated model; sinks open at zero, pools large', () => {
    const s = short();
    const { json, layout } = modelgen(s);
    const inst = kernel.init(json);
    try {
      const st = inst.state();
      for (const id of ['opex', 'capex', 'tax', 'market_loss'])
        expect(st[inst.nodeIndex(id)]).toBe(0);
      expect(st[inst.nodeIndex('income')]).toBe(POOL);
      expect(st[inst.nodeIndex('bank')]).toBe(10_000);
      expect(st[inst.nodeIndex('h_etf')]).toBe(600_000);
      expect(inst.edgeIds).toHaveLength(5 + 4 * s.holdings.length);
      expect(inst.tEnd).toBe(layout.months);
      expect(layout.months).toBe(36 + 60);
    } finally {
      inst.free();
    }
  });

  test('is a pure function of the scenario', () => {
    expect(modelgen(short()).json).toBe(modelgen(short()).json);
  });
});

describe('Monte-Carlo (FR-SIM-002…004)', () => {
  test('money balance holds at every step of every run (FR-SIM-003)', () => {
    const r = simulate(kernel, short(), sampleSpending({ assets: [] }), { runs: 20 });
    expect(r.invalidRuns).toBe(0);
    expect(r.maxDrift).toBeLessThanOrEqual(1e-9);
  });

  test('negative spending is never simulated: money cannot appear from nowhere (ADR 0025)', () => {
    // Before the fix, a negative tier total made every run fail the money
    // balance, and the screens reported that as a 0 % chance.
    const sp = sampleSpending({ assets: [] });
    const r = simulate(kernel, short(), { ...sp, tier: { food: 500, other: -5000 } }, { runs: 20 });
    expect(r.invalidRuns).toBe(0);
    expect(r.pSuccess).toBe(1);
  });

  test('no valid run is an error, never a 0 % result (ADR 0025)', () => {
    const s = short();
    const part = runChunk(kernel, { scenario: s, spending: sampleSpending(), from: 0, to: 4 });
    const broken = { ...part, summaries: part.summaries.map((x) => ({ ...x, valid: false })) };
    expect(() => combine([broken])).toThrow(NoValidRunsError);
  });

  test('deterministic, and independent of how runs are split into chunks', () => {
    const s = short();
    const sp = sampleSpending();
    const whole = runChunk(kernel, { scenario: s, spending: sp, from: 0, to: 8 });
    const parts = [
      runChunk(kernel, { scenario: s, spending: sp, from: 4, to: 8 }),
      runChunk(kernel, { scenario: s, spending: sp, from: 0, to: 4 }),
    ];
    const a = combine([whole]);
    const b = combine(parts);
    expect(b.summaries).toEqual(a.summaries);
    expect(b.capital).toEqual(a.capital);
    expect(Array.from(parts[1]!.capital!)).toEqual(Array.from(whole.capital!.subarray(0, 4 * 97)));
  });

  test('a run re-executes exactly from its seed, and its mutation log replays in GSSK (FR-SIM-004)', () => {
    const s = short();
    const sp = sampleSpending();
    const { json, layout } = modelgen(s);
    const plan = makePlan(s, sp, layout);
    const a = kernel.init(json);
    const b = kernel.init(json);
    try {
      const wa = wire(a, layout);
      runOnce(plan, wa, 0, runSeed(s, 0)); // run 0, then reset, then run 3
      a.reset();
      const ra = runOnce(plan, wa, 3, runSeed(s, 3));
      const rb = runOnce(plan, wire(b, layout), 3, runSeed(s, 3));
      expect(Array.from(rb.capital)).toEqual(Array.from(ra.capital));

      const log = a.exportMutationLog();
      expect(JSON.parse(log).length).toBeGreaterThan(0);
      expect(log).toContain('policy:');
      const replayed = kernel.replay(json, log, layout.months);
      try {
        const sa = a.state();
        const sr = replayed.state();
        for (let i = 0; i < sa.length; i++) expect(sr[i]).toBeCloseTo(sa[i]!, 6);
      } finally {
        replayed.free();
      }
    } finally {
      a.free();
      b.free();
    }
  });

  test('keeps the first 20 runs whole as example paths', () => {
    const r = simulate(kernel, short(), sampleSpending(), { runs: 24 });
    expect(r.examples.map((e) => e.run)).toEqual([...Array(20).keys()]);
    expect(r.examples[0]!.capital).toHaveLength(r.months + 1);
    expect(r.capital.p5[0]).toBeCloseTo(950_000, 6);
  });
});

describe('policy controller (SPEC §11.2)', () => {
  test('never draws super before its preservation date', () => {
    const s = short({
      holdings: [
        {
          id: 'cash',
          name: 'Cash',
          assetClass: 'cash',
          value: 5_000_00n,
          returnModelId: 'cash',
          provenance: 'illustrative',
        },
        {
          id: 'super',
          name: 'Super',
          assetClass: 'super',
          value: 900_000_00n,
          returnModelId: 'super',
          accessibleFrom: '2040-01-01',
          provenance: 'illustrative',
        },
      ],
      decisions: {
        ...sampleScenario().decisions,
        sellOrder: ['cash', 'super'],
        allocation: { cash: 1 },
      },
    });
    const r = simulate(kernel, s, sampleSpending(), { runs: 3 });
    // Capital is mostly locked: spending fails once the cash runs out.
    expect(r.pSuccess).toBe(0);
    expect(r.summaries.every((x) => x.ruinMonth >= 36)).toBe(true);
  });

  test('`hold` never sells the held holding', () => {
    const s = short({
      decisions: {
        ...sampleScenario().decisions,
        withdrawal: { kind: 'hold', holdingIds: ['etf'] },
      },
    });
    const { json, layout } = modelgen(s);
    const inst = kernel.init(json);
    try {
      const out = runOnce(
        makePlan(s, sampleSpending(), layout),
        wire(inst, layout),
        0,
        runSeed(s, 0)
      );
      expect(out.summary.valid).toBe(true);
      // The controller writes a rate only when it changes: the one entry is
      // the month-0 write of k = 0; any later entry would be a sale.
      const log = JSON.parse(inst.exportMutationLog()) as { t: number; target_id: string }[];
      const draws = log.filter((e) => e.target_id === 'draw_h_etf');
      expect(draws.map((e) => e.t)).toEqual([0]);
    } finally {
      inst.free();
    }
  });

  test('tax is paid when there is taxable investment income', () => {
    const r = simulate(kernel, short(), sampleSpending(), { runs: 2 });
    expect(r.summaries[0]!.totalTax).toBeGreaterThan(0);
    const untaxed = simulate(kernel, short({ taxTable: null }), sampleSpending(), { runs: 2 });
    expect(untaxed.summaries[0]!.totalTax).toBe(0);
  });
});

describe('FR-SIM-006 bridge test', () => {
  test('a fixed return model and one run reproduce a spreadsheet projection to within AUD 1 a year', () => {
    const fixed: ReturnModel = {
      id: 'fixed5',
      kind: 'fixed',
      rate: 0.05,
      incomeYield: 0,
      label: '5 % real',
    };
    const s: Scenario = {
      ...sampleScenario(),
      asOf: '2026-01',
      goal: { ...sampleScenario().goal, start: '2036-01-01', horizonYears: 30 },
      holdings: [
        {
          id: 'etf',
          name: 'Shares',
          assetClass: 'equity',
          value: 200_000_00n,
          returnModelId: 'fixed5',
          provenance: 'illustrative',
        },
      ],
      decisions: {
        withdrawal: { kind: 'fixed-real' },
        sellOrder: ['etf'],
        allocation: { etf: 1 },
        bankBuffer: 0n,
        netPayMonthly: 9_000_00n,
      },
      returnModels: [fixed],
      taxTable: null,
    };
    const sp = sampleSpending({ current: { all: 5_000 }, tier: { all: 4_500 } });
    const r = simulate(kernel, s, sp, { runs: 1 });

    // The spreadsheet: one row per month, capital × (1 + r) + pay − spending.
    const rm = monthlyFixed(0.05);
    let c = 200_000;
    const sheet = [c];
    for (let m = 0; m < r.months; m++) {
      const working = m < 120;
      c = c * (1 + rm) + (working ? 9_000 : 0) - (working ? 5_000 : 4_500);
      sheet.push(c);
    }
    const sim = r.examples[0]!.capital;
    for (let y = 0; y * 12 <= r.months; y++)
      expect(Math.abs(sim[y * 12]! - sheet[y * 12]!)).toBeLessThan(1);
    expect(r.summaries[0]!.success).toBe(sheet.every((x) => x >= 0));
    expect(addMonths('2026-01-01', r.months).slice(0, 7)).toBe('2066-01');
  });
});

describe('goal metrics (FR-GOAL)', () => {
  test('deterministic freedom number grosses the need up for tax at the withdrawal rate', () => {
    const s = short();
    const sp = sampleSpending();
    const d = deterministicFreedom(s, sp);
    expect(d.annualNeed).toBe(12 * 5_900);
    expect(d.grossWithdrawal).toBeGreaterThan(d.annualNeed);
    expect(d.freedomNumber).toBeCloseTo(d.grossWithdrawal / 0.04, 6);
    expect(d.provenance).toBe('assumed');
    const untaxed = deterministicFreedom({ ...s, taxTable: null }, sp);
    expect(untaxed.freedomNumber).toBeCloseTo((12 * 5_900) / 0.04, 6);
  });

  test('P90 freedom number: the bisection lands where pSuccess crosses the target', async () => {
    const s = short();
    const sp = sampleSpending();
    const f = await p90Freedom(s, sp, local, { runs: 30, iterations: 6 });
    expect(f.capital).not.toBeNull();
    expect(f.pSuccess).toBeGreaterThanOrEqual(0.9);
  });

  test('a budget line that ends stops being spent from its month (FR-BUD-005)', () => {
    const s = short();
    const runs = { runs: 12 };
    const base = simulate(kernel, s, sampleSpending(), runs);
    // Housing (2,500 a month after freedom) ends two years into freedom.
    const ends = [{ item: 'Mortgage', group: 'housing', from: '2031-01', monthly: 2_500 }];
    const paidOff = simulate(kernel, s, sampleSpending({ ends }), runs);
    for (const [a, b] of base.summaries.map((r, i) => [r, paidOff.summaries[i]!] as const)) {
      // 3 years of freedom at 2,500 a month less, in every future (same seeds).
      expect(a.totalSpend - b.totalSpend).toBeCloseTo(3 * 12 * 2_500, -3);
      expect(b.endCapital).toBeGreaterThan(a.endCapital);
    }
    // Ended before freedom: never spent after it.
    const before = simulate(
      kernel,
      s,
      sampleSpending({ ends: [{ ...ends[0]!, from: '2027-01' }] }),
      runs
    );
    expect(base.summaries[0]!.totalSpend - before.summaries[0]!.totalSpend).toBeCloseTo(
      5 * 12 * 2_500,
      -3
    );
  });

  test('the bridge: capital outside super, smaller when super unlocks during freedom', async () => {
    const sp = sampleSpending();
    const withSuper = (accessibleFrom: string) =>
      short({
        holdings: sampleScenario().holdings.map((h) =>
          h.assetClass === 'super' ? { ...h, accessibleFrom } : h
        ),
      });
    const opts = { runs: 30, iterations: 6 };
    const soon = await bridgeFreedom(withSuper('2031-01-01'), sp, local, opts);
    const never = await bridgeFreedom(withSuper('2040-01-01'), sp, local, opts);
    expect(soon).toMatchObject({ locked: 300_000, until: '2031-01' });
    expect(soon!.capital).not.toBeNull();
    expect(soon!.pSuccess).toBeGreaterThanOrEqual(0.9);
    expect(soon!.capital!).toBeLessThan(never!.capital!);
    // Nothing locked at the start: no bridge.
    expect(await bridgeFreedom(withSuper('2028-01-01'), sp, local, opts)).toBeNull();
    // Two bisections of simulations: ~3 s here, over the 5 s default on a slower machine.
  }, 30_000);

  test('years to freedom and project runway', async () => {
    const s = short();
    const sp = sampleSpending();
    const y = await yearsToFreedom(s, sp, 1_100_000, local, { runs: 12 });
    expect(y.p50).not.toBeNull();
    expect(y.p10!).toBeLessThanOrEqual(y.p50!);
    const runway = projectRunway(s, sp);
    // Bank and accessible holdings (not super) over the tier's monthly need.
    expect(runway).toBeCloseTo((10_000 + 40_000 + 600_000) / 5_900, 6);
  });

  test('shortfall drivers report each input frozen at its median', async () => {
    const s = short();
    const sp = sampleSpending();
    const main = simulate(kernel, s, sp, { runs: 12 });
    const d = await shortfallDrivers(s, sp, main, local, { runs: 12 });
    expect(d.map((x) => x.input).sort()).toEqual(['capex', 'returns', 'spending']);
  });
});

describe('monotonicity with common random numbers (SPEC §16.1)', () => {
  const sp = sampleSpending({ current: { all: 7_000 }, tier: { all: 6_500 } });
  test('more starting capital never decreases pSuccess', async () => {
    const s = short({ goal: { ...short().goal, horizonYears: 12 } });
    let prev = -1;
    for (const scale of [0.4, 0.7, 1, 1.5]) {
      const p = simulate(kernel, s, sp, { runs: 16, holdingScale: scale }).pSuccess;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  test('doubling OPEX never increases pSuccess', () => {
    const s = short({ goal: { ...short().goal, horizonYears: 12 } });
    const base = simulate(kernel, s, sp, { runs: 16 });
    const doubled = simulate(
      kernel,
      s,
      sampleSpending({ current: { all: 14_000 }, tier: { all: 13_000 } }),
      { runs: 16 }
    );
    expect(doubled.pSuccess).toBeLessThanOrEqual(base.pSuccess);
    for (let i = 0; i < 16; i++) {
      if (!base.summaries[i]!.success) expect(doubled.summaries[i]!.success).toBe(false);
    }
  });
});

describe('imported return history (FR-FC-020)', () => {
  test('a holding can bootstrap from an imported history', () => {
    const rets = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.02 : -0.01));
    const s = short({
      returnModels: [
        ...sampleScenario().returnModels,
        {
          id: 'hist:mine',
          kind: 'block-bootstrap',
          seriesId: 'user:mine',
          block: 12,
          incomeYield: 0,
          label: 'mine',
        },
      ],
      histories: { 'user:mine': rets },
      holdings: sampleScenario().holdings.map((h) =>
        h.id === 'etf' ? { ...h, returnModelId: 'hist:mine' } : h
      ),
    });
    const r = simulate(kernel, s, sampleSpending(), { runs: 4 });
    expect(r.invalidRuns).toBe(0);
    expect(r.summaries.length).toBe(4);
  });
});
