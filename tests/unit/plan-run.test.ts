/** "Run my plan": a run in facts and words, and the history (FR-OPT-002, FR-OPT-007, ADR 0032). */
import { describe, expect, test } from 'vitest';
import { matchIntent } from '../../src/assistant/intents.ts';
import { fullRunText, previousRun, runFacts, type PlanRun } from '../../src/app/plan-run.ts';

const base: PlanRun = {
  id: 'run-1',
  at: '2026-10-13T03:42:00.000Z',
  inputsHash: 'abc',
  record: {
    gsskVersion: '5.3.0',
    wasmSha256: 'x',
    modelHash: 'm',
    inputsHash: 'abc',
    seed: '42',
    runs: 500,
  },
  runId: 'abc123·seed 42·runs 0–499',
  goal: { tier: 'independent', start: '2031-07', horizonYears: 35, target: 0.9, floor: 50_000 },
  pSuccess: 0.62,
  validRuns: 500,
  invalidRuns: 0,
  done: ['chance', 'checks', 'tiers', 'drivers', 'freedom-number', 'earliest', 'priors'],
  checks: [{ level: 'problem', text: 'All your savings are in cash.' }],
  tiers: [
    { id: 'independent', pSuccess: 0.62, runs: 500 },
    { id: 'secure', pSuccess: 0.81, runs: 200 },
  ],
  drivers: [
    { label: 'Returns', pSuccess: 0.79, delta: 0.17 },
    { label: 'Spending', pSuccess: 0.66, delta: 0.04 },
  ],
  freedomNumber: {
    deterministic: 1_234_567,
    annualNeed: 52_000,
    withdrawalRate: 0.04,
    atTarget: 1_612_345,
    atTargetChance: 0.9,
    atTargetRuns: 200,
  },
  yearsToFreedom: { p10: 6.2, p50: 8.4, p90: 12.9, reached: 0.95 },
  runwayMonths: 30,
  earliest: {
    current: { start: '2031-07', pSuccess: 0.62 },
    plans: [
      {
        id: 'target',
        start: '2034-01',
        months: 30,
        tierSpend: 1,
        pSuccess: 0.91,
        target: 0.9,
        runId: 'r2',
        setup: {} as never,
      },
    ],
    simulations: 7,
  },
  capital: {
    months: [0, 12],
    q: { p5: [1, 2], p25: [1, 2], p50: [1, 2], p75: [1, 2], p95: [1, 2] },
  },
  months: 480,
  asOf: '2026-10',
};

describe('a run, for the AI', () => {
  test('chances as percentages, money rounded, no exact figures', () => {
    const f = runFacts(base, (id) => (id === 'secure' ? 'Secure' : 'Independent'));
    expect(f.chanceOfSuccess).toBe('62 %');
    expect(f.meetsTarget).toBe(false);
    expect(f.goal.target).toBe('90 %');
    expect(f.byTier).toEqual([
      { tier: 'Independent', chance: '62 %', runs: 500 },
      { tier: 'Secure', chance: '81 %', runs: 200 },
    ]);
    expect(f.shortfallDrivers?.[0]).toEqual({
      input: 'Returns',
      chanceIfCertain: '79 %',
      change: '+17.0 points',
    });
    expect(f.freedomNumber).toMatchObject({ simple: '~$1,200,000', atTarget: '~$1,600,000' });
    expect(f.freedomNumber).not.toHaveProperty('outsideSuper');
    expect(f.earliest?.plans[0]).toMatchObject({
      plan: 'earliest at the target',
      freedomStarts: '2034-01',
    });
    expect(JSON.stringify(f)).not.toContain('1612345');
    expect(f.finished).toBe('every step');
  });

  test('with super locked, the bridge outside super, rounded, and both in words', () => {
    const r = {
      ...base,
      freedomNumber: {
        ...base.freedomNumber!,
        bridge: { capital: 912_345, locked: 287_654, until: '2033-10' },
      },
    };
    expect(runFacts(r).freedomNumber?.outsideSuper).toMatchObject({
      needed: '~$910,000',
      superToday: '~$290,000',
      superUnlocks: '2033-10',
    });
    const text = fullRunText(r);
    expect(text).toContain('super included');
    expect(text).toContain('locked until 2033-10');
  });

  test('a stopped run says what finished', () => {
    const r: PlanRun = { ...base, done: ['chance', 'checks'] };
    delete r.drivers;
    delete r.earliest;
    const f = runFacts(r);
    expect(f.finished).toBe('stopped after: chance, checks');
    expect(f).not.toHaveProperty('shortfallDrivers');
    expect(f).not.toHaveProperty('earliest');
  });
});

describe('a run, in words', () => {
  test('the chance, a problem, the biggest risk, the freedom number and the earliest date', () => {
    const t = fullRunText(base, () => 'Independent');
    expect(t).toContain('(62 %); your target is 90 %');
    expect(t).toContain('**Check this:** All your savings are in cash.');
    expect(t).toContain('**returns**');
    expect(t).toContain('2034-01');
    expect(t).toContain('History');
  });

  test('no date reaches the target', () => {
    const t = fullRunText({
      ...base,
      earliest: {
        current: base.earliest!.current,
        plans: [],
        latest: { start: '2041-07', pSuccess: 0.4 },
        simulations: 6,
      },
    });
    expect(t).toContain('No start date up to 2041-07 reaches the target');
  });
});

describe('history and words', () => {
  test('the run before', () => {
    const a = { ...base, id: 'a' };
    const b = { ...base, id: 'b' };
    expect(previousRun([a, b], b)?.id).toBe('a');
    expect(previousRun([a, b], a)).toBeUndefined();
  });

  test('"run my plan" asks for the full run; "how likely" stays the quick one', () => {
    expect(matchIntent('Run my plan')).toEqual({ id: 'full-run' });
    expect(matchIntent('please run everything')).toEqual({ id: 'full-run' });
    expect(matchIntent('analyse my whole plan')).toEqual({ id: 'full-run' });
    expect(matchIntent('How likely is my plan to work?')).toEqual({ id: 'chance' });
  });

  test('the spending model’s assumptions: facts and words', () => {
    const narrow = { ...base, priors: { runs: 200, baseline: 0.62, weaker: 0.6, stronger: 0.63 } };
    expect(runFacts(narrow).spendingModelAssumptions).toMatchObject({
      chanceAsBuilt: '62 %',
      withWeakerAssumptions: '60 %',
      withStrongerAssumptions: '63 %',
    });
    expect(fullRunText(narrow)).toContain("don't change this");
    expect(
      fullRunText({ ...base, priors: { runs: 200, baseline: 0, weaker: 0, stronger: 0 } })
    ).toContain('stays at 0 %');
    const wide = { ...base, priors: { runs: 200, baseline: 0.62, weaker: 0.45, stronger: 0.7 } };
    expect(fullRunText(wide)).toContain('between 45 % and 70 %');
    const none = { ...base, priors: { unavailable: 'not in use' } };
    expect(runFacts(none).spendingModelAssumptions).toBe('not in use');
  });
});
