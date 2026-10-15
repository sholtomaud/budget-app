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
import { DASHBOARD_TOOL_SCHEMA } from '../viz/dashboard-ai.ts';
import { LIBRARY } from '../viz/library.ts';
import { MAX_TILES } from '../viz/dashboard.ts';

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
          'Dashboards',
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
    name: 'run_my_plan',
    description:
      "Run the user's plan in full, exactly as the Freedom screen's Run my plan button does, and keep it in their history: the chance of success, plan checks, the chance at each tier, what drives shortfalls, the freedom number at their target and years to reach it, the earliest freedom date with a safer and a spend-less plan (each found by searching on the same simulated futures, never below what the essentials cost), and how much the chance depends on the Bayesian spending model's starting assumptions. Also returns how far to trust the spending forecast (the model's checks). For savings over time afterwards, call make_chart with the capital dataset. Takes 20–60 seconds. Use it when asked how the plan is doing overall or to run everything; for one quick number, run_plan is faster.",
    input_schema: obj({ runs: { type: 'integer', enum: [200, 500, 1000] } }),
  },
  {
    name: 'get_plan_history',
    description:
      "The user's earlier full runs, newest first: when, the chance of success against the target, the tier and start date, and whether the newest is out of date (their data or settings changed since). Use it to say how their plan has changed over time.",
    input_schema: obj({}),
  },
  {
    name: 'make_chart',
    description: `Draw a chart for the user from their own data (ADR 0028). You describe it; the app runs the queries on the device, shows the chart with exact values, and returns rounded facts about it for you to describe. You never supply values.

Datasets:
${DATASETS.map((d) => `- ${d}: ${CATALOGUE[d]}`).join('\n')}

${CATALOGUE_NOTE}

kind: line (needs groupBy month, quarter or year), bar, stacked-bar, or table. Up to 6 series, all grouped the same way. For "when are my big purchases" or "what is coming up", use big-purchases grouped by month, quarter or year (a bar chart reads best); for the future against today's spending, put big-purchases and spending on the same time axis. filter.categories takes category ids ('food.groceries'), group ids ('food'), or plain names ('groceries'). filter.text looks for words in the merchant, description or item. from/to are 'YYYY-MM'; lastMonths counts back from the latest complete month; nextMonths counts forward from this month (big purchases only). Keep the title under 80 characters and labels under 40.`,
    input_schema: CHART_TOOL_SCHEMA,
  },
  {
    name: 'review_budget',
    description:
      "Review the budget against the last months of spending (ADR 0038): alerts on the floor, the plan's chance and the cash buffer, then per category whether it is within its usual range, and cards to raise essentials that cost more, lower discretionary categories that cost less, or choose for discretionary ones that cost more. Changes go half way and are cards the user applies. Use it when asked whether the budget is right or to review or adjust it.",
    input_schema: obj({}),
  },
  {
    name: 'list_dashboards',
    description:
      "The user's dashboards (named pages of charts, ADR 0036): each one's id, name, whether it is open, and its charts in order (a built-in id, a saved chart id, or a chart spec, and whether it is wide). Also the built-in charts and the saved charts that can go on a dashboard, by id and title. Call it before propose_dashboard.",
    input_schema: obj({}),
  },
  {
    name: 'propose_dashboard',
    description: `Offer the user a card to make a dashboard or change one: a named page of up to ${MAX_TILES} charts the app draws from today's data. Nothing changes until they click Save dashboard. Give the whole layout, in order: to change a dashboard, pass its dashboardId and every chart it should have, including the ones to keep (from list_dashboards); to make one, dashboardId null. Each chart is exactly one of: builtin (an id below), saved (a saved chart's id from list_dashboards), or chart (a chart spec as for make_chart, for anything else). wide gives a chart the whole row; use it for timelines. Prefer built-in and saved charts; design a chart only when none fits.

Built-in charts:
${LIBRARY.map((c) => `- ${c.id}: ${c.spec.title}`).join('\n')}`,
    input_schema: DASHBOARD_TOOL_SCHEMA,
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
- To check the whole plan (chance, drivers, freedom number, earliest date, the forecast's checks), call run_my_plan; get_plan_history says how it has changed.
- When the user asks for a dashboard, or for several charts on one page to come back to, call list_dashboards, then propose_dashboard with the whole layout. It is a card they save; say so.
- To show something over time or by category, call make_chart; the chart appears in the chat. Describe it from the facts it returns. When the user asks for a chart, always try make_chart before saying a chart can't be drawn: combine datasets, groupings and filters to get as close as you can. If it returns an error, fix the spec and try again; only then say what can't be charted and what you drew instead.
- Spending after freedom can never go below the floor: the lowest (Secure) tier's budget, the least the person can live on (essentialsPerMonth in get_plan; with no budget, what essentials like rent and groceries cost). Never suggest a plan below it; the app raises any proposal that is.
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
