/**
 * Why the freedom number's year of spending is what it is (FR-GOAL-024),
 * budget lines that count as nothing (FR-BUD-004), and the chat sending the
 * person's own questions to the AI (ADR 0045). All figures are made up.
 */
import { describe, expect, test } from 'vitest';
import { advisorSystem } from '../../src/advisor/tools.ts';
import { asksForAI, matchIntent, sameMessage } from '../../src/assistant/intents.ts';
import { DEFAULT_TIERS, type BudgetLine } from '../../src/budget/model.ts';
import { emptyBudget } from '../../src/budget/state.ts';
import { checkPlan } from '../../src/sim/checks.ts';
import {
  applySpendingLevers,
  defaultSetup,
  scenarioFrom,
  spendingFrom,
} from '../../src/sim/inputs.ts';
import { needBreakdown } from '../../src/sim/metrics.ts';

const line = (over: Partial<BudgetLine>): BudgetLine => ({
  id: 'l',
  categoryId: 'food.groceries',
  item: 'Groceries',
  cost: 800_00n,
  ccy: 'AUD',
  period: 'm',
  tierMultiplier: { secure: 1, independent: 1, luxury: 1 },
  ...over,
});

const household = (lines: BudgetLine[]) => ({
  accounts: [],
  balances: [],
  txns: [],
  assets: [],
  budget: { ...emptyBudget(), lines, tiers: DEFAULT_TIERS },
});

describe('the year of spending behind the freedom number', () => {
  const mortgage = line({
    id: 'm',
    categoryId: 'housing.mortgage',
    item: 'Mortgage',
    cost: 3_000_00n,
    period: 'm',
  });

  test('a mortgage at the tier counts in full, by group, with the lever and project income', () => {
    const d = household([line({}), mortgage]);
    const setup = defaultSetup(d, '2026-10-01');
    setup.goal = { ...setup.goal, tier: 'secure', projectIncome: 6_000_00n };
    const s = scenarioFrom(setup, '2026-10', 0.03);
    const lever = 0.5;
    const sp = applySpendingLevers(spendingFrom(d, 'secure'), {
      tierSpend: lever,
      currentSpend: 1,
    });
    const n = needBreakdown({ ...s, taxTable: null }, sp, lever);
    expect(n.tierMonthly).toBeCloseTo(3_800, 6);
    expect(n.byGroup.map((g) => g.group)).toEqual(['housing', 'food']);
    expect(n.lever).toBe(0.5);
    expect(n.projectIncome).toBe(6_000);
    // 12 × (3,800 × 50 %) − 6,000.
    expect(n.annualNeed).toBeCloseTo(12 * 1_900 - 6_000, 6);
  });

  test('an essential left out of the plan tier, or a period that can’t be read, is said', () => {
    const d = household([
      line({}),
      { ...mortgage, tierMultiplier: { secure: 0, independent: 1, luxury: 1 } },
      line({ id: 'g', categoryId: 'health.gym', item: 'Gym', period: 'monthly' }),
    ]);
    const sp = spendingFrom(d, 'secure');
    expect(sp.uncounted).toEqual([
      expect.objectContaining({ item: 'Mortgage', reason: 'tier', monthly: 3_000 }),
      expect.objectContaining({ item: 'Gym', reason: 'period', period: 'monthly' }),
    ]);
    const setup = defaultSetup(d, '2026-10-01');
    setup.goal = { ...setup.goal, tier: 'secure' };
    const checks = checkPlan(setup, sp, '2026-10').filter((c) => c.id === 'not-counted');
    expect(checks.map((c) => c.level)).toEqual(['note', 'problem']);
    expect(checks[0]!.text).toContain("isn't counted at the Secure tier");
    // At a tier that counts it, nothing to say about the mortgage.
    expect(spendingFrom(d, 'independent').uncounted?.map((u) => u.item)).toEqual(['Gym']);
  });
});

describe('the chat: the person’s own questions reach the AI (ADR 0045)', () => {
  const pasted = `I see Freedom number $636,455 $24,297 a year of spending at a 4.0 % withdrawal rate. assumed At 90 %: $878,950 Outside super: $465,844 But I don't understand why the spending is $24k when the morgage alone is about ~$35k per year ... ?`;

  test('a pasted screen with amounts in it is not a budget line', () => {
    expect(matchIntent(pasted)).toBeNull();
    expect(matchIntent('I pay $45 a month for the gym')?.id).toBe('budget-line');
    expect(matchIntent('Our mortgage is $3,035 a month')?.id).toBe('budget-line');
  });

  test('asking for the AI by name', () => {
    expect(asksForAI(`please ask gemini, ${pasted}`, 'Google Gemini')).toBe(true);
    expect(asksForAI('ok but please ask the local ai about this.')).toBe(true);
    expect(asksForAI('send this to the AI')).toBe(true);
    expect(asksForAI('Gemini: why is it low?')).toBe(true);
    expect(asksForAI('ask Qwen why', 'Qwen 3 (Ollama)')).toBe(true);
    expect(asksForAI('How likely is my plan to work?', 'Google Gemini')).toBe(false);
    expect(asksForAI('I want to repair my car')).toBe(false);
  });

  test('a message re-sent with a few words changed is the same message', () => {
    expect(sameMessage(pasted, `you just added another budget line! Please ${pasted}`)).toBe(true);
    expect(sameMessage('I pay $45 a month for the gym', 'I pay $20 a month for Netflix')).toBe(
      false
    );
  });

  test('the model is told who it is', () => {
    const s = advisorSystem('Google Gemini');
    expect(s).toContain('You are Google Gemini');
    expect(s).toContain('Earlier in this chat, answered by Crux');
  });
});
