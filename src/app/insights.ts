/**
 * Answers computed from the person's own data (ADR 0023). Each returns the
 * same result twice: plain-words text for the built-in reply ("Crux"), and
 * rounded facts for the AI's tools. The text is written here, from
 * templates; every number in it is the app's.
 */
import { roughAmount } from '../api/redact.ts';
import {
  againstTarget,
  chanceWords,
  coverageWords,
  dollars,
  DRIVER_WORDS,
  percent,
  TARGET_WORDS,
  years,
} from '../assistant/phrases.ts';
import { categoryName } from '../classify/categories.ts';
import type { DataView } from '../data/service.ts';
import { monthlySeries } from '../forecast/series.ts';
import { optimise, type OptimiseResult } from '../optimise/optimiser.ts';
import type { AsyncCma } from '../optimise/optimiser.ts';
import { baseValues } from '../optimise/levers.ts';
import { defaultSetup, type FreedomSetup } from '../sim/inputs.ts';
import { checkPlan, type PlanCheck } from '../sim/checks.ts';
import { deterministicFreedom, shortfallDrivers } from '../sim/metrics.ts';
import { monthsBetween } from '../sim/modelgen.ts';
import {
  budgetMonthlyFor,
  evaluator,
  inputsFor,
  runIdOf,
  simulateSetup,
} from './freedom-inputs.ts';
import type { Proposal } from './proposals.ts';
import { poolRunner } from './sim-pool.ts';
import { forecast, sim } from './workers.ts';

export interface Insight {
  /** Markdown for the built-in reply. */
  text: string;
  /** Rounded facts for the AI (FR-API-003). */
  facts: Record<string, unknown>;
  runIds: string[];
  chart?: { kind: 'chance'; p: number; target: number };
  proposal?: Proposal;
  /** More cards, e.g. plan checks' fixes. */
  proposals?: Proposal[];
  link?: { label: string; path: string };
  suggestions?: string[];
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export async function currentSetup(v: DataView): Promise<FreedomSetup> {
  return (await sim().loadSetup()) ?? defaultSetup(v);
}

/** The plan checks for the current setup (ADR 0026), problems first. */
export async function planChecks(v: DataView, setup?: FreedomSetup): Promise<PlanCheck[]> {
  const s = setup ?? (await currentSetup(v));
  const { scenario, spending } = await inputsFor(v, s);
  return checkPlan(s, spending, scenario.asOf).sort((a, b) =>
    a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1
  );
}

/** A check's fix as a card that changes the current plan. */
export const checkProposals = (checks: PlanCheck[], from: FreedomSetup): Proposal[] =>
  checks.flatMap((c) =>
    c.fix
      ? [{ kind: 'setup', label: c.fix.label, summary: c.fix.summary, setup: c.fix.setup, from }]
      : []
  );

/** Checks as markdown paragraphs. */
const checkLines = (checks: PlanCheck[]) =>
  checks.map(
    (c) => `${c.level === 'problem' ? '**Check this:**' : '**Worth knowing:**'} ${c.text}`
  );

const monthName = (ym: string) =>
  new Date(`${ym.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
  });

/** How likely the current plan is to work. */
export async function planChance(v: DataView, runs = 500): Promise<Insight> {
  const setup = await currentSetup(v);
  const r = await simulateSetup(v, setup, runs, true);
  const runId = runIdOf(r);
  const target = setup.goal.targetProbability;
  const verdict = againstTarget(r.pSuccess, target);
  const checks = await planChecks(v, setup);
  const text = [
    `Your plan works **${chanceWords(r.pSuccess)}** (${percent(r.pSuccess)}). Your target is ${percent(target)}. ${TARGET_WORDS[verdict]}`,
    `I tried ${r.runs} possible futures for ${years(setup.goal.horizonYears)} of freedom starting ${monthName(setup.goal.start)}, each with its own returns, spending and replacement costs. Run \`${runId}\``,
    ...checkLines(checks),
  ].join('\n\n');
  return {
    text,
    facts: {
      runId,
      chanceOfSuccess: percent(r.pSuccess),
      target: percent(target),
      freedomStarts: setup.goal.start.slice(0, 7),
      yearsOfFreedom: setup.goal.horizonYears,
      runs: r.runs,
    },
    runIds: [runId],
    chart: { kind: 'chance', p: r.pSuccess, target },
    proposals: checkProposals(checks, setup),
    link: { label: 'Open Freedom', path: '/freedom' },
    suggestions:
      verdict === 'met'
        ? ['What could go wrong?', 'How sure is the forecast?']
        : ['Why is it low?', 'What would make it work?'],
  };
}

/** Why the plan falls short: the gap between capital and need, then which uncertainty costs most. */
export async function whyShort(v: DataView): Promise<Insight> {
  const setup = await currentSetup(v);
  const r = await simulateSetup(v, setup, 300, true);
  const runId = runIdOf(r);
  const { scenario, spending } = await inputsFor(v, setup);
  const det = deterministicFreedom(scenario, spending);
  const startIdx = Math.max(
    0,
    Math.min(r.capital.p50.length - 1, monthsBetween(scenario.asOf, setup.goal.start))
  );
  const atStart = r.capital.p50[startIdx] ?? 0;
  const gap = det.freedomNumber - atStart;
  const checks = (await planChecks(v, setup)).filter((c) => c.level === 'problem');
  const lines: string[] = checks.length
    ? [
        `Before the numbers, ${checks.length === 1 ? 'one setting is' : `${checks.length} settings are`} likely holding your plan back:`,
        ...checks.map((c) => `- ${c.text}`),
      ]
    : [];
  if (gap > 0)
    lines.push(
      `When freedom starts in ${monthName(setup.goal.start)}, you'd typically have about **${dollars(atStart)}** invested (half the futures more, half less). The spending you've planned for after that needs about **${dollars(det.freedomNumber)}**: a year of spending, ${dollars(det.annualNeed)}, at a ${percent(det.withdrawalRate)} withdrawal rate. The gap, about **${dollars(gap)}**, is the main reason. Run \`${runId}\``
    );
  else
    lines.push(
      `You'd typically have about **${dollars(atStart)}** invested when freedom starts, more than the simple freedom number of ${dollars(det.freedomNumber)}. So the shortfall comes from the futures where things go badly. Run \`${runId}\``
    );
  let top: string | undefined;
  if (r.pSuccess > 0.02 && r.pSuccess < 0.98) {
    const drivers = await shortfallDrivers(scenario, spending, r, poolRunner, { runs: 200 });
    const d = drivers[0];
    if (d && d.delta > 0.01) {
      top = d.input;
      lines.push(
        `Of the things that vary, **${DRIVER_WORDS[d.input] ?? d.label}** costs the most: with its ups and downs taken out, the plan would work ${chanceWords(d.pSuccess)}.`
      );
    }
  }
  return {
    text: lines.join('\n\n'),
    facts: {
      runId,
      capitalAtFreedomTypical: roughAmount(atStart),
      freedomNumberSimpleRule: roughAmount(det.freedomNumber),
      yearOfSpending: roughAmount(det.annualNeed),
      withdrawalRate: percent(det.withdrawalRate),
      gap: gap > 0 ? roughAmount(gap) : null,
      biggestUncertainty: top ?? null,
      planChecks: checks.map((c) => c.text),
    },
    runIds: [runId],
    proposals: checkProposals(checks, setup),
    link: { label: 'Open Freedom', path: '/freedom' },
    suggestions: ['What would make it work?'],
  };
}

const workerCma: AsyncCma = {
  init: (x0, s, l) => forecast().cmaInit(x0, s, l),
  ask: (st, z) => forecast().cmaAsk(st, z),
  tell: (st, x, f) => forecast().cmaTell(st, x, f),
};

/** The smallest change to when freedom starts and spending after it that reaches the target. */
export async function findChanges(
  v: DataView,
  onProgress?: (done: number, total: number) => void
): Promise<Insight> {
  const setup = await currentSetup(v);
  const base = baseValues(setup);
  const target = setup.goal.targetProbability;
  // Starting later only helps while pay comes in. With none before freedom, a
  // later start adds years paid from savings, so that lever is left alone and
  // the check's own fix (start now) is offered instead (ADR 0026).
  const checks = await planChecks(v, setup);
  const noPay = checks.some((c) => c.id === 'no-pay');
  const result: OptimiseResult = await optimise(
    {
      setup,
      levers: [
        ...(noPay ? [] : [{ id: 'start' as const, lo: 0, hi: 8 }]),
        {
          id: 'tierSpend' as const,
          lo: Math.min(noPay ? 0.5 : 0.7, base.tierSpend),
          hi: base.tierSpend,
        },
      ],
      target,
      budget: 30,
    },
    { evaluate: evaluator(v, 200), cma: workerCma, onProgress: (d, t) => onProgress?.(d, t) }
  );
  const problems = checks.filter((c) => c.level === 'problem');
  const fixes = checkProposals(problems, setup);
  const first = problems.length
    ? `${problems.map((c) => `**Check this:** ${c.text}`).join('\n\n')}\n\n`
    : '';
  const b = result.best;
  if (result.base.feasible)
    return {
      text: `Your plan already works ${chanceWords(result.base.pSuccess)}, which meets your ${percent(target)} target. No change needed. Run \`${result.base.runId}\``,
      facts: { alreadyMeetsTarget: true, runId: result.base.runId },
      runIds: [result.base.runId],
      suggestions: ['How sure is the forecast?'],
    };
  if (!b) {
    const near = [...result.candidates].sort((x, y) => y.pSuccess - x.pSuccess)[0]!;
    return {
      text: `${first}${noPay ? `Spending up to half as much after freedom` : `Even starting freedom up to 8 years later and spending up to 30 % less after it`}, none of the ${result.candidates.length} plans I tried reached ${percent(target)}. The best worked ${chanceWords(near.pSuccess)}. Run \`${near.runId}\`\n\nThe other levers are worth a look on the Scenarios screen: project income after freedom, spending less now, or a lower spending tier.`,
      facts: {
        reachedTarget: false,
        target: percent(target),
        bestChance: percent(near.pSuccess),
        runId: near.runId,
        plansTried: result.candidates.length,
      },
      runIds: [near.runId],
      proposals: fixes,
      link: { label: 'Open Scenarios', path: '/scenarios' },
    };
  }
  const later = b.values.start;
  const spend = b.values.tierSpend;
  // Spending after freedom in dollars a month, not as a share of "the tier".
  const { spending } = await inputsFor(v, setup);
  const perMonth = sum(spending.tier) / Math.max(1e-9, base.tierSpend);
  const changes: string[] = [];
  if (later >= 0.05) changes.push(`start freedom **${years(later)} later**`);
  if (spend < base.tierSpend - 0.005)
    changes.push(
      `spend about **${dollars(perMonth * spend)} a month** after freedom instead of ${dollars(perMonth * base.tierSpend)} (${percent(spend)} of what you've planned)`
    );
  const summary = changes.join(' and ').replace(/\*\*/g, '');
  const works = `works ${chanceWords(b.pSuccess)} (${percent(b.pSuccess)}), meeting your ${percent(target)} target`;
  return {
    text: `${first}The smallest change I found: ${changes.join(' and ')}. That plan ${works}. I tried ${result.candidates.length} plans on the same simulated futures, so the comparison is fair. Run \`${b.runId}\`\n\nYou can use it in your plan now (and undo it), or save it as a scenario to compare first.`,
    facts: {
      reachedTarget: true,
      target: percent(target),
      startYearsLater: Math.round(later * 10) / 10,
      spendingAfterFreedomPerMonth: roughAmount(perMonth * spend),
      spendingAfterFreedomNowPerMonth: roughAmount(perMonth * base.tierSpend),
      spendingAfterFreedom: percent(spend),
      chance: percent(b.pSuccess),
      runId: b.runId,
      plansTried: result.candidates.length,
      offered: 'Two cards: one changes the current plan (with undo), one saves it as a scenario.',
    },
    runIds: [b.runId],
    proposals: [
      ...fixes,
      {
        kind: 'setup',
        label: 'Use in my plan',
        summary,
        setup: b.setup,
        from: setup,
      },
      {
        kind: 'scenario',
        name: `Crux: ${summary}`.slice(0, 80),
        setup: b.setup,
        summary: `${summary}; ${works}.`,
      },
    ],
    link: { label: 'Open Scenarios', path: '/scenarios' },
  };
}

/** How far to trust the spending forecast: the Bayesian model's checks, in plain words. */
export async function forecastConfidence(v: DataView): Promise<Insight> {
  const setup = await currentSetup(v);
  const history = monthlySeries(v.txns);
  const opex = await forecast().opex(history, budgetMonthlyFor(v, setup.goal.tier), {
    horizon: 60,
    seed: '42',
    bayes: true,
  });
  const b = opex.bayes;
  if (!b?.used)
    return {
      text: `The spending forecast adds up each category's own forecast. ${b?.reason ?? 'There is not enough history for the joint model yet.'} As more months come in, the joint model can take over and show its checks.`,
      facts: { jointModel: false, reason: b?.reason ?? 'not enough history' },
      runIds: [],
      link: { label: 'Open Forecast', path: '/forecast' },
    };
  const c = await forecast().opexChecks(history, { seed: '42' });
  const move = Math.exp(b.factor?.lambda[1] ?? 0) - 1;
  const lines = [
    `Your spending forecast is **checked and in use**. ${b.categories.length} categories are modelled together, so the range allows for them rising and falling together: a tighter or looser month moves every category by about ${percent(move)}.`,
  ];
  if (c?.holdout)
    lines.push(
      `I tested it by hiding your last ${c.holdout.months} months: ${percent(c.holdout.coverage)} of them fell inside the forecast range, where about 80 % is right. That is **${coverageWords(c.holdout.coverage)}**.`
    );
  if (c?.priorPredictive) {
    const pp = c.priorPredictive;
    const inside = pp.observed >= pp.p5 && pp.observed <= pp.p95;
    lines.push(
      `Your total moves about ${percent(pp.observed)} from month to month. ${inside ? "That's within what the model expects, so its ranges fit your household." : 'That is outside what the model expected, so treat its ranges with care.'}`
    );
  }
  return {
    text: lines.join('\n\n'),
    facts: {
      jointModel: true,
      categories: b.categories.length,
      commonMonthlyMove: percent(move),
      heldOutMonthsInsideRange: c?.holdout ? percent(c.holdout.coverage) : null,
      monthToMonthChange: c?.priorPredictive ? percent(c.priorPredictive.observed) : null,
    },
    runIds: [],
    link: { label: 'Open Forecast', path: '/forecast' },
    suggestions: ['What does P90 mean?', 'How likely is my plan to work?'],
  };
}

/** Where the money goes: the last 12 months by group. */
export async function spendingSummary(v: DataView): Promise<Insight> {
  const setup = await currentSetup(v);
  const { spending } = await inputsFor(v, setup);
  const total = sum(spending.current);
  const groups = Object.entries(spending.current).sort((a, b) => b[1] - a[1]);
  if (!total)
    return {
      text: 'There is no spending to look at yet. Load a sample household or import your bank data on the Import screen.',
      facts: { total: 0 },
      runIds: [],
      link: { label: 'Open Import', path: '/import' },
    };
  const name = (g: string) => categoryName(g, v.categories).toLowerCase();
  const top = groups
    .slice(0, 4)
    .map(([g, x]) => `- **${name(g)}**: about ${dollars(x)} a month (${percent(x / total)})`);
  return {
    text: `Over the last 12 months you spent about **${dollars(total)} a month**. The biggest parts:\n\n${top.join('\n')}${spending.capexMonthly ? `\n\nOn top of that, your big purchases work out at about ${dollars(spending.capexMonthly)} a month.` : ''}`,
    facts: {
      perMonth: roughAmount(total),
      top: groups
        .slice(0, 4)
        .map(([g, x]) => ({ group: g, perMonth: roughAmount(x), share: percent(x / total) })),
      bigPurchasesPerMonth: roughAmount(spending.capexMonthly),
    },
    runIds: [],
    link: { label: 'Open Budget', path: '/budget' },
    suggestions: ['How likely is my plan to work?'],
  };
}
