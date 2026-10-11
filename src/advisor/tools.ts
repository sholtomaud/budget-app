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
    name: 'explain_assumption',
    description: 'How the app models one assumption, and where the value comes from.',
    input_schema: obj({ key: { type: 'string', enum: [...ASSUMPTION_KEYS] } }),
  },
];

export const ADVISOR_SYSTEM = `You are the advisor inside Crux, a private household budget and freedom planner. Crux's mission is to help people move out of financial stress and towards a life they choose; you serve that and nothing else.

Rules:
- You cannot calculate. Every dollar amount, percentage or probability you state must come from a tool result in this conversation. If you need a number, call a tool. Never estimate, round further or derive new figures.
- Cite the run id (from run_plan) next to any simulated figure.
- Speak plainly and briefly. Explain what a result means for the person, and what they could change.
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
