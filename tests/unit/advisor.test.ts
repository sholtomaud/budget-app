import { describe, expect, test } from 'vitest';
import { ADVISOR_TOOLS, unverifiedFigures } from '../../src/advisor/tools.ts';
import { checkToolInput } from '../../src/api/llm.ts';

describe('advisor figure check (NFR-HON-002, §13.3)', () => {
  const tool = JSON.stringify({
    runId: 'abc·seed 42·runs 0–199',
    pSuccess: 0.913,
    chanceOfSuccess: '91 %',
    endCapital: { p10: '~$120,000', p50: '~$650,000', p90: '~$1,400,000' },
    freedomNumberAssumed: '~$1,600,000',
  });

  test('figures from tool results pass, in the forms a model writes them', () => {
    const reply =
      'Your plan succeeds in about 91% of futures (run abc). Median end capital is ~$650,000, or $650k; the freedom number is about $1.6 million.';
    expect(unverifiedFigures(reply, [tool])).toEqual([]);
  });

  test('an invented amount or percentage is flagged', () => {
    const reply = 'You could retire with $900,000 and a 75% chance.';
    expect(unverifiedFigures(reply, [tool])).toEqual(['$900,000', '75%']);
  });

  test("the user's own numbers and trivial amounts aren't flagged", () => {
    expect(
      unverifiedFigures(
        'Yes, cutting $50 a week is reasonable; coffee is $5.',
        [tool],
        'Can I cut $50 a week?'
      )
    ).toEqual([]);
  });

  test("figures in the screen context the person sent (their own target) aren't flagged", () => {
    const context = 'Freedom · last run: works in 92 % of futures, target 90 %';
    expect(
      unverifiedFigures('That meets your 90 % target.', [tool], `${context}\nFind changes`)
    ).toEqual([]);
  });
});

describe('advisor tool schemas are strict', () => {
  test('every object schema forbids extra properties and lists all as required', () => {
    for (const t of ADVISOR_TOOLS) {
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(t.input_schema.required).toEqual(Object.keys(t.input_schema.properties ?? {}));
    }
  });

  test('inputs are validated before a tool runs', () => {
    const run = ADVISOR_TOOLS.find((t) => t.name === 'run_plan')!;
    expect(checkToolInput(run, { scenarioId: null, runs: 200 })).toBeNull();
    expect(checkToolInput(run, { scenarioId: null, runs: 100000 })).not.toBeNull();
    const propose = ADVISOR_TOOLS.find((t) => t.name === 'propose_plan')!;
    expect(
      checkToolInput(propose, {
        name: 'Later start',
        startYearsLater: 2,
        tierSpendPercent: null,
        currentSpendPercent: null,
        projectIncomePerYear: null,
        withdrawal: 'gamble',
      })
    ).not.toBeNull();
  });
});
