/**
 * The advisor's tools and its figure check (SPEC §13.3, NFR-HON-002).
 *
 * The advisor is a tool-using agent that cannot compute: every figure it
 * may quote comes from a tool result, and tool results carry rounded
 * amounts only (FR-API-003). A reply containing a dollar amount or a
 * percentage that no tool returned in the conversation is flagged
 * "unverified" in the UI.
 */
import type { ToolDef } from '../api/llm.ts';
import type { Schema } from '../lib/jsonschema.ts';
import { CATALOGUE, CATALOGUE_NOTE, CHART_TOOL_SCHEMA, DATASETS } from '../viz/spec.ts';

const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });

export const ASSUMPTION_KEYS = [
  'returns',
  'tax',
  'inflation',
  'spending',
  'big-purchases',
  'withdrawals',
  'floor',
] as const;
export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

export const WITHDRAWALS = ['fixed-real', 'percent', 'guardrails', 'skim', 'hold'] as const;

export const ADVISOR_TOOLS: ToolDef[] = [
  {
    name: 'get_plan',
    description:
      "The user's current plan from the Freedom screen: goal (tier, when freedom starts, years, target probability, floor), spending levers, withdrawal strategy, holdings by kind, take-home pay. Amounts are rounded.",
    input_schema: obj({}),
  },
  {
    name: 'get_spending_summary',
    description:
      "Average monthly spending by group over the last 12 months, and the goal tier's budget by group. Amounts are rounded.",
    input_schema: obj({}),
  },
  {
    name: 'list_scenarios',
    description: 'Saved scenarios (plans) with their ids and names.',
    input_schema: obj({}),
  },
  {
    name: 'run_plan',
    description:
      'Simulate a plan: the current plan (scenarioId null) or a saved scenario. Returns a run id, the chance of success, end capital at P10/P50/P90 and the deterministic freedom number. Use this for every figure you quote.',
    input_schema: obj({
      scenarioId: nullable({ type: 'string' }),
      runs: { type: 'integer', enum: [200, 500] },
    }),
  },
  {
    name: 'propose_plan',
    description:
      'Save a changed version of the current plan as a new scenario for the user to review. Only the given changes apply; null leaves a lever as it is. Returns the new scenario id; run it with run_plan.',
    input_schema: obj({
      name: { type: 'string' },
      startYearsLater: nullable({ type: 'number' }),
      tierSpendPercent: nullable({ type: 'number' }),
      currentSpendPercent: nullable({ type: 'number' }),
      projectIncomePerYear: nullable({ type: 'number' }),
      withdrawal: nullable({ type: 'string', enum: [...WITHDRAWALS] }),
    }),
  },
  {
    name: 'check_plan',
    description:
      "Check the current plan's settings for things that make it fail in ways the user probably didn't mean: no pay before freedom, paid work ending before freedom, a large bank buffer that earns nothing, all savings in cash, spending more than take-home pay, income filed as spending. Fixes are offered to the user as cards. Call this first when a plan looks surprisingly bad.",
    input_schema: obj({}),
  },
  {
    name: 'explain_shortfall',
    description:
      'Why the current plan falls short: typical capital when freedom starts against the simple freedom number, and which uncertainty (returns, spending, big purchases) costs the most. Cites a run id.',
    input_schema: obj({}),
  },
  {
    name: 'find_plan_changes',
    description:
      'Search for the smallest change to when freedom starts and spending after it that reaches the target, on the same simulated futures. Takes a while. Offers the result to the user as a scenario card.',
    input_schema: obj({}),
  },
  {
    name: 'find_earliest_freedom',
    description:
      'Find the earliest month freedom can start and still reach the target, by a search over start dates on the same simulated futures. Returns up to three plans: the earliest at the target, the earliest with a safer margin, and the earliest when spending a little less after freedom, each with its chance and run id. Offers them to the user as scenario cards. Use this for any "earliest", "how soon" or "when can I stop work" question; never test dates one at a time.',
    input_schema: obj({}),
  },
  {
    name: 'get_forecast_confidence',
    description:
      "How far to trust the spending forecast: whether the Bayesian model is in use, how much categories move together, held-out months inside the range, and month-to-month variability against the model's expectations.",
    input_schema: obj({}),
  },
  {
    name: 'propose_budget_line',
    description:
      'Offer the user a card to add a recurring cost to their budget. Nothing changes until they click Apply. Use when they mention a regular cost.',
    input_schema: obj({
      item: { type: 'string' },
      amountDollars: { type: 'number' },
      period: { type: 'string', enum: ['d', 'w', 'f', 'm', 'q', 'y'] },
      categoryHint: nullable({ type: 'string' }),
    }),
  },
  {
    name: 'propose_big_purchase',
    description:
      'Offer the user a card to add something they own and will replace (a car, a laptop) to Big purchases. Nothing changes until they click Apply.',
    input_schema: obj({
      name: { type: 'string' },
      costDollars: nullable({ type: 'number' }),
      ageYears: nullable({ type: 'number' }),
    }),
  },
  {
    name: 'propose_categorisation',
    description:
      'Offer the user a card to put every transaction mentioning some text (a merchant) in a category, by the category name. Nothing changes until they click Apply.',
    input_schema: obj({ match: { type: 'string' }, category: { type: 'string' } }),
  },
  {
    name: 'go_to_screen',
    description: 'Offer the user a button to open a screen of the app.',
    input_schema: obj({
      screen: {
        type: 'string',
        enum: [
          'Start',
          'Import',
          'Transactions',
          'Budget',
          'Big purchases',
          'Forecast',
          'Freedom',
          'Scenarios',
          'Saved charts',
          'Settings',
        ],
      },
    }),
  },
  {
    name: 'explain_assumption',
    description: 'How the app models one assumption, and where the value comes from.',
    input_schema: obj({ key: { type: 'string', enum: [...ASSUMPTION_KEYS] } }),
  },
  {
    name: 'make_chart',
    description: `Draw a chart for the user from their own data (ADR 0028). You describe it; the app runs the queries on the device, shows the chart with exact values, and returns rounded facts about it for you to describe. You never supply values.

Datasets:
${DATASETS.map((d) => `- ${d}: ${CATALOGUE[d]}`).join('\n')}

${CATALOGUE_NOTE}

kind: line (needs groupBy month, quarter or year), bar, stacked-bar, or table. Up to 6 series, all grouped the same way. filter.categories takes category ids ('food.groceries'), group ids ('food'), or plain names ('groceries'). filter.text looks for words in the merchant or description. from/to are 'YYYY-MM'; lastMonths counts back from the latest complete month. Keep the title under 80 characters and labels under 40.`,
    input_schema: CHART_TOOL_SCHEMA,
  },
];

export const ADVISOR_SYSTEM = `You are the advisor inside Crux, a private household budget and freedom planner. Crux's mission is to help people move out of financial stress and towards a life they choose; you serve that and nothing else.

The user may know budgeting arithmetic but not statistics. Each message may start with [Screen: …], the screen they are looking at.

Rules:
- You cannot calculate. Every dollar amount, percentage or probability you state must come from a tool result in this conversation. If you need a number, call a tool. Never estimate, round further or derive new figures.
- Cite the run id once, after the first simulated figure. The app turns it into a footnote; don't repeat it.
- Before calling tools, you may say in one short line what you are about to do ("I'll run your plan first."). The app shows it as you go, with each step it runs.
- Speak plainly and briefly: a few short paragraphs at most. Use frequencies ("in about 9 in 10 simulated futures"), not jargon (no "pSuccess", "P90" without saying what it means).
- Explain what a result means for the person, why (check_plan first, then explain_shortfall), and what they could change (find_plan_changes).
- When a plan looks surprisingly bad, call check_plan before anything else: a setting is often the cause, not the person's finances.
- To show something over time or by category, call make_chart; the chart appears in the chat. Describe it from the facts it returns.
- Changes go through the propose_ tools as cards the user applies. Never say a change was made; say it is ready for them to apply.
- Don't add a "not financial advice" note: the app shows it once.
- For "when is the earliest I can stop work?" and the like, call find_earliest_freedom once and present its plans. Don't search for a date yourself with propose_plan and run_plan.
- To explore a change, use propose_plan, then run_plan on the new scenario, and compare it with the current plan. The user decides; scenarios you propose are saved for them to review.
- Ask about what matters to them (what they'd do with free time, which standard of living is non-negotiable) when it helps.
- This is not financial advice. The figures come from the user's own assumptions. For tax, legal or product decisions, suggest a licensed professional.
- Never recommend credit, buy-now-pay-later, gambling or speculative products.`;

/** Numbers that look like money or percentages, as values. */
function figures(text: string): { raw: string; value: number; kind: '$' | '%' }[] {
  const out: { raw: string; value: number; kind: '$' | '%' }[] = [];
  const money = /(?:~|about\s+)?-?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?/gi;
  for (const m of text.matchAll(money)) {
    const mult = /^(k|thousand)$/i.test(m[2] ?? '')
      ? 1e3
      : /^(m|million)$/i.test(m[2] ?? '')
        ? 1e6
        : 1;
    out.push({ raw: m[0].trim(), value: Number(m[1]!.replace(/,/g, '')) * mult, kind: '$' });
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g))
    out.push({ raw: m[0], value: Number(m[1]), kind: '%' });
  return out;
}

/**
 * Figures in the reply that no tool result supports (within 1 %, or 0.5
 * percentage points). Small amounts under $10 and the percentages that
 * appear in the user's own question are not checked.
 */
export function unverifiedFigures(
  reply: string,
  toolResults: readonly string[],
  userText = ''
): string[] {
  const known = toolResults.flatMap(figures);
  // Tool results also carry plain numbers (e.g. pSuccess 0.91 → 91 %).
  for (const t of toolResults)
    for (const m of t.matchAll(
      /"(?:pSuccess|probability|rate|share)[^"]*"\s*:\s*(0?\.\d+|1(?:\.0+)?)/g
    ))
      known.push({ raw: m[0], value: Number(m[1]) * 100, kind: '%' });
  const fromUser = figures(userText);
  return figures(reply)
    .filter((f) => !(f.kind === '$' && f.value < 10))
    .filter((f) => !fromUser.some((u) => u.kind === f.kind && Math.abs(u.value - f.value) < 1e-9))
    .filter(
      (f) =>
        !known.some((k) =>
          k.kind !== f.kind
            ? false
            : f.kind === '%'
              ? Math.abs(k.value - f.value) <= 0.5
              : Math.abs(k.value - f.value) <= 0.01 * Math.max(1, Math.abs(k.value))
        )
    )
    .map((f) => f.raw);
}
