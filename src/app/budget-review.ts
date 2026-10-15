/**
 * "Review my budget" (ADR 0038): the review's alerts and proposals as a chat
 * answer with cards. Alerts watch the essential variables: the floor (the
 * Secure budget covers what essentials cost), the plan (its chance against
 * its target), and the buffer (cash on hand against months of Secure
 * spending). Proposals change budget lines; each is a card with Undo, and
 * each applied change is logged so the next reviews hold it.
 */
import { categoryName } from '../classify/categories.ts';
import type { DataView } from '../data/service.ts';
import {
  donorFor,
  monthlyBudget,
  reviewBudget,
  scaleCategory,
  type Finding,
  type ReviewLogEntry,
} from '../budget/review.ts';
import { essentialsFrom } from '../sim/inputs.ts';
import { percent } from '../assistant/phrases.ts';
import { currentSetup, type Insight } from './insights.ts';
import { loadRuns } from './plan-run.ts';
import { loadReviewLog } from './review-log.ts';
import type { BudgetChange } from './proposals.ts';

/** Months of Secure spending the person should hold in cash. */
export const BUFFER_MONTHS = 3;

const aud = (minor: number) =>
  `$${Math.round(minor / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;

/** The review as a chat answer: alerts, then cards, then what was left alone and why. */
export async function budgetReview(v: DataView): Promise<Insight> {
  const setup = await currentSetup(v);
  const tiers = v.budget.tiers;
  const tier = setup.goal.tier;
  const tierName = tiers.find((t) => t.id === tier)?.name ?? tier;
  const name = (id: string) => categoryName(id, v.categories);
  const input = {
    lines: v.budget.lines,
    txns: v.txns,
    periods: v.budget.periods,
    tier,
    tiers,
    log: await loadReviewLog(),
  };
  if (!v.budget.lines.length)
    return {
      text: 'There is no budget to review yet. Import your budget spreadsheet on the Budget screen, or tell me a cost ("I pay $45 a month for the gym").',
      facts: { budget: 'none' },
      runIds: [],
      suggestions: ['Where does my money go?'],
    };
  const r = reviewBudget(input);

  // 1. The essential variables.
  const alerts: string[] = [];
  const e = essentialsFrom(v);
  for (const o of e?.outdated ?? [])
    alerts.push(
      `**Floor:** ${o.group} has cost about ${aud(o.actual * 100)} a month, but your ${tiers[0]?.name ?? 'Secure'} budget has about ${aud(o.budgeted * 100)}. Plans are held to that budget as the least you can live on.`
    );
  const last = (await loadRuns()).at(-1);
  if (!last)
    alerts.push('**Plan:** no full run yet, so its chance is unknown. Run my plan to check it.');
  else if (last.pSuccess < last.goal.target)
    alerts.push(
      `**Plan:** your last run (${last.at.slice(0, 10)}) works in ${percent(last.pSuccess)} of futures, under your target of ${percent(last.goal.target)}. Changes to the budget change that; run your plan again after applying them.`
    );
  const secureMonthly = tiers[0]
    ? [...monthlyBudget(v.budget.lines, tiers[0].id, v.budget.periods).values()].reduce(
        (a, b) => a + b,
        0
      )
    : 0;
  const cash = Number(setup.decisions.bankBuffer);
  if (secureMonthly > 0 && cash < BUFFER_MONTHS * secureMonthly)
    alerts.push(
      `**Buffer:** about ${aud(cash)} in the bank is ${(cash / secureMonthly).toFixed(1)} months of ${tiers[0]!.name} spending; ${BUFFER_MONTHS} months (${aud(BUFFER_MONTHS * secureMonthly)}) gives room for a bad month.`
    );

  // 2. Proposals: a card per change.
  const proposals: BudgetChange[] = [];
  const lines: string[] = [];
  const change = (
    f: Finding,
    label: string,
    summary: string,
    extra?: { donor: string; amount: number }
  ) => {
    const main = scaleCategory(v.budget.lines, f.categoryId, f.budget, f.proposed);
    const after = [...main.after];
    const before = [...main.before];
    const entries: ReviewLogEntry[] = [
      { categoryId: f.categoryId, month: r.month ?? '', from: f.budget, to: f.proposed },
    ];
    if (extra) {
      const from = monthlyBudget(v.budget.lines, tier, v.budget.periods).get(extra.donor) ?? 0;
      const d = scaleCategory(v.budget.lines, extra.donor, from, from - extra.amount);
      after.push(...d.after);
      before.push(...d.before);
      entries.push({
        categoryId: extra.donor,
        month: r.month ?? '',
        from,
        to: from - extra.amount,
      });
    }
    proposals.push({ kind: 'budget-change', label, summary, after, before, entries });
  };
  for (const f of r.findings) {
    const what = `${name(f.categoryId)}: ${aud(f.budget)} a month budgeted at ${tierName}, about ${aud(f.runRate)} spent a month over the last 3 months`;
    if (f.kind === 'raise') {
      lines.push(`- ${what}. An essential: raise it.`);
      change(
        f,
        `Raise ${name(f.categoryId)} to ${aud(f.proposed)} a month`,
        `${what}. Half way to what it costs; the next reviews take it the rest of the way if it holds.`
      );
    } else if (f.kind === 'lower') {
      lines.push(`- ${what}. Lower it.`);
      change(
        f,
        `Lower ${name(f.categoryId)} to ${aud(f.proposed)} a month`,
        `${what}. Half way down to what it costs.`
      );
    } else if (f.kind === 'choice') {
      lines.push(
        `- ${what}. Your choice: raise it, take it from another category, or discard both cards to keep the budget and aim to spend less.`
      );
      change(f, `Raise ${name(f.categoryId)} to ${aud(f.proposed)} a month`, `${what}.`);
      const donor = donorFor(f, r);
      if (donor)
        change(
          f,
          `Raise ${name(f.categoryId)} to ${aud(f.proposed)}, taking ${aud(f.proposed - f.budget)} from ${name(donor.categoryId)}`,
          `${what}. ${name(donor.categoryId)} has cost about ${aud(donor.room)} a month less than its budget, so the total stays the same.`,
          { donor: donor.categoryId, amount: f.proposed - f.budget }
        );
    } else
      lines.push(
        `- ${what}. An essential that has cost well under its budget for 6 months; it stays as it is unless you change it.`
      );
  }

  const held = r.skipped.filter((s) => s.why === 'recent').map((s) => name(s.categoryId));
  const fresh = r.skipped.filter((s) => s.why === 'new').map((s) => name(s.categoryId));
  const text = [
    alerts.length ? alerts.join('\n\n') : '',
    lines.length
      ? `**Budget review${r.month ? ` to ${r.month}` : ''}** (${tierName} tier):\n${lines.join('\n')}`
      : `**Budget review${r.month ? ` to ${r.month}` : ''}:** every category is within its usual range of what it costs. Nothing to change.`,
    [
      held.length ? `Changed recently, so left for now: ${held.join(', ')}.` : '',
      fresh.length ? `Under 6 months of spending, so not reviewed yet: ${fresh.join(', ')}.` : '',
      r.steady.length
        ? `Within their usual range: ${r.steady.length} categor${r.steady.length === 1 ? 'y' : 'ies'}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    text,
    facts: {
      month: r.month,
      alerts: alerts.length,
      changes: r.findings.map((f) => ({
        category: name(f.categoryId),
        kind: f.kind,
        budgetMonthly: aud(f.budget),
        spentMonthly: aud(f.runRate),
        proposedMonthly: aud(f.proposed),
      })),
    },
    runIds: [],
    proposals,
    suggestions: ['Run my plan', 'Where does my money go?'],
  };
}
