/**
 * The advisor's runtime (SPEC §13.3): the tool implementations, which run
 * on this device against the user's own plan and simulator, and the
 * conversation loop, where every provider call goes through the egress
 * gate. The conversation lives in memory only.
 */
import { checkToolInput, chatRequest, type Turn } from '../api/llm.ts';
import { roughAmount } from '../api/redact.ts';
import {
  ADVISOR_SYSTEM,
  ADVISOR_TOOLS,
  unverifiedFigures,
  type AssumptionKey,
} from '../advisor/tools.ts';
import type { DataView } from '../data/service.ts';
import { applyLevers } from '../optimise/levers.ts';
import { defaultSetup, type FreedomSetup } from '../sim/inputs.ts';
import { deterministicFreedom } from '../sim/metrics.ts';
import type { WithdrawalStrategy } from '../sim/model.ts';
import { taxProvenance, taxTable } from '../sim/tax.ts';
import { activityId, elapsed, kb, step, type ActivitySink } from './activity.ts';
import { activeProvider, sendStream } from './egress.ts';
import { inputsFor, runIdOf, simulateSetup } from './freedom-inputs.ts';
import { addScenario, loadScenarios } from './scenarios.ts';
import {
  checkProposals,
  earliestDate,
  findChanges,
  forecastConfidence,
  planChecks,
  whyShort,
  type Insight,
} from './insights.ts';
import {
  assetProposal,
  budgetLineProposal,
  categoriseProposal,
  describe,
  type Proposal,
} from './proposals.ts';
import { percent } from '../assistant/phrases.ts';
import { minTierSpend } from '../sim/inputs.ts';
import { buildChart, chartFacts, type BuiltChart } from './charts.ts';
import {
  currentInputsHash,
  loadRuns,
  runFacts,
  runFullPlan,
  saveRun,
  STEP_WORDS,
} from './plan-run.ts';
import { withoutNulls } from '../viz/spec.ts';
import { topicCategories } from '../viz/requests.ts';
import { SCREEN_WORDS } from '../assistant/intents.ts';
import { sim } from './workers.ts';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const rough = (minor: bigint | number) => roughAmount(Number(minor) / 100);

async function currentSetup(v: DataView): Promise<FreedomSetup> {
  return (await sim().loadSetup()) ?? defaultSetup(v);
}

function withdrawalOf(
  kind: (typeof import('../advisor/tools.ts').WITHDRAWALS)[number],
  s: FreedomSetup
): WithdrawalStrategy {
  switch (kind) {
    case 'percent':
      return { kind, rate: 0.04 };
    case 'guardrails':
      return { kind, initialRate: 0.04, band: 0.2, adjust: 0.1, minSpendFraction: 0.8 };
    case 'skim':
      return { kind, threshold: 0.02 };
    case 'hold':
      return {
        kind,
        holdingIds: s.holdings.filter((h) => h.assetClass === 'btc').map((h) => h.id),
      };
    default:
      return { kind: 'fixed-real' };
  }
}

/** What tools hand to the panel besides their text for the model: cards, buttons, a chart. */
export interface ToolSink {
  proposals: Proposal[];
  links: { label: string; path: string }[];
  chart?: Insight['chart'];
  charts: BuiltChart[];
  onProgress?: (text: string) => void;
}

/** Run one tool; returns JSON text for the model. Amounts are rounded (FR-API-003). */
export async function runTool(
  v: DataView,
  name: string,
  input: Record<string, unknown>,
  sink?: ToolSink
): Promise<string> {
  const setup = await currentSetup(v);
  const offered = (p: Proposal) => {
    sink?.proposals.push(p);
    return JSON.stringify({
      offered: describe(p, v),
      note: 'Shown to the user as a card. Nothing has changed until they click Apply.',
    });
  };
  switch (name) {
    case 'run_my_plan': {
      const runs = [200, 500, 1000].includes(Number(input.runs)) ? Number(input.runs) : 500;
      const tierName = (id: string) => v.budget.tiers.find((t) => t.id === id)?.name ?? id;
      const full = await runFullPlan(v, setup, {
        runs,
        onStep: (k, state) => {
          if (state === 'running') sink?.onProgress?.(`${STEP_WORDS[k][0]}…`);
        },
      });
      await saveRun(full.run);
      const trust = await forecastConfidence(v);
      if (sink) sink.chart = { kind: 'chance', p: full.run.pSuccess, target: full.run.goal.target };
      sink?.links.push({ label: 'Open Freedom', path: '/freedom' });
      return JSON.stringify({
        ...runFacts(full.run, tierName),
        spendingForecast: trust.facts,
        shown: 'Kept in the History on the Freedom screen, with the full results.',
      });
    }
    case 'get_plan_history': {
      const list = (await loadRuns()).slice().reverse().slice(0, 10);
      const latest = list[0];
      const stale = latest ? (await currentInputsHash(v, setup)) !== latest.inputsHash : false;
      return JSON.stringify({
        runs: list.map((r) => ({
          ranAt: r.at,
          chance: percent(r.pSuccess),
          target: percent(r.goal.target),
          freedomStarts: r.goal.start,
          tier: v.budget.tiers.find((t) => t.id === r.goal.tier)?.name ?? r.goal.tier,
          runId: r.runId,
        })),
        newestOutOfDate: stale,
        ...(list.length ? {} : { note: 'No full runs yet: run_my_plan makes one.' }),
      });
    }
    case 'make_chart': {
      const spec = withoutNulls(input) as { series?: { filter?: { categories?: string[] } }[] };
      // Plain names become category ids (the AI sees names, not every id).
      for (const s of spec.series ?? []) {
        const f = s.filter;
        if (!f?.categories) continue;
        f.categories = [
          ...new Set(
            f.categories.flatMap((c) =>
              v.categories.some((x) => x.id === c || x.id.startsWith(`${c}.`))
                ? [c]
                : topicCategories(c, v.categories)
            )
          ),
        ];
        if (!f.categories.length) delete f.categories;
      }
      const r = await buildChart(v, spec);
      if (!r.ok) return JSON.stringify({ error: r.error });
      sink?.charts.push(r.chart);
      return JSON.stringify(chartFacts(r.chart));
    }
    case 'check_plan': {
      const checks = await planChecks(v, setup);
      for (const p of checkProposals(checks, setup)) sink?.proposals.push(p);
      return JSON.stringify({
        checks: checks.map((c) => ({
          level: c.level,
          finding: c.text,
          ...(c.fix ? { offered: `A card to ${c.fix.label.toLowerCase()}.` } : {}),
        })),
        note: checks.some((c) => c.fix)
          ? 'Fixes are shown to the user as cards. Nothing has changed until they click Apply.'
          : undefined,
      });
    }
    case 'explain_shortfall': {
      const i = await whyShort(v);
      for (const p of i.proposals ?? []) sink?.proposals.push(p);
      return JSON.stringify(i.facts);
    }
    case 'find_plan_changes': {
      const i = await findChanges(v, (d, t) =>
        sink?.onProgress?.(`Trying plans: ${d} of up to ${t}…`)
      );
      for (const p of i.proposals ?? []) sink?.proposals.push(p);
      if (i.proposal) sink?.proposals.push(i.proposal);
      if (i.link) sink?.links.push(i.link);
      return JSON.stringify({
        ...i.facts,
        ...(i.proposal ? { offered: 'Shown to the user as a scenario card to save.' } : {}),
      });
    }
    case 'find_earliest_freedom': {
      const i = await earliestDate(v, (d) =>
        sink?.onProgress?.(`Searching start dates: ${d} plans tried…`)
      );
      for (const p of i.proposals ?? []) sink?.proposals.push(p);
      if (i.link) sink?.links.push(i.link);
      if (i.chart && sink) sink.chart = i.chart;
      return JSON.stringify(i.facts);
    }
    case 'get_forecast_confidence': {
      const i = await forecastConfidence(v);
      if (i.link) sink?.links.push(i.link);
      return JSON.stringify(i.facts);
    }
    case 'propose_budget_line':
      return offered(
        budgetLineProposal(
          v,
          String(input.item),
          Number(input.amountDollars),
          String(input.period),
          (input.categoryHint as string | null) ?? undefined
        )
      );
    case 'propose_big_purchase':
      return offered(
        assetProposal(v, String(input.name), {
          ...(typeof input.costDollars === 'number' ? { costDollars: input.costDollars } : {}),
          ...(typeof input.ageYears === 'number' ? { ageYears: input.ageYears } : {}),
        })
      );
    case 'propose_categorisation': {
      const p = categoriseProposal(v, String(input.match), String(input.category));
      return 'error' in p ? JSON.stringify({ error: p.error }) : offered(p);
    }
    case 'go_to_screen': {
      const s = SCREEN_WORDS.find((x) => x.label === input.screen);
      if (!s) return JSON.stringify({ error: 'Unknown screen' });
      sink?.links.push({ label: `Open ${s.label}`, path: s.path });
      return JSON.stringify({ offered: `A button to open ${s.label}.` });
    }
    case 'get_plan': {
      const byClass: Record<string, bigint> = {};
      for (const h of setup.holdings)
        byClass[h.assetClass] = (byClass[h.assetClass] ?? 0n) + h.value;
      const w = setup.decisions.withdrawal;
      return JSON.stringify({
        tier: setup.goal.tier,
        freedomStarts: setup.goal.start.slice(0, 7),
        yearsOfFreedom: setup.goal.horizonYears,
        targetProbability: pct(setup.goal.targetProbability),
        floor: rough(setup.goal.floor),
        spendingAfterFreedom: `${pct(setup.levers?.tierSpend ?? 1)} of the tier`,
        ...(await (async () => {
          const sp = (await inputsFor(v, setup)).spending;
          const e = sp.essentials;
          const lever = setup.levers?.tierSpend ?? 1;
          const tier = Object.values(sp.tier).reduce((a, b) => a + b, 0);
          return {
            spendingAfterFreedomPerMonth: rough(BigInt(Math.round(tier * 100))),
            tierBudgetPerMonth: rough(BigInt(Math.round((tier / Math.max(1e-9, lever)) * 100))),
            ...(e
              ? {
                  essentialsPerMonth: rough(BigInt(Math.round(e.monthly * 100))),
                  essentialsFrom:
                    e.source === 'actual'
                      ? 'what they cost over the last 12 months'
                      : 'the lowest tier budget',
                  lowestSpendingAfterFreedom: `${pct(minTierSpend(sp, lever))} of the tier: below this the essentials (rent, groceries, utilities…) can't be paid`,
                }
              : {}),
          };
        })()),
        spendingNow: `${pct(setup.levers?.currentSpend ?? 1)} of today's`,
        projectIncomePerYear: rough(setup.goal.projectIncome ?? 0n),
        takeHomePayPerMonth: rough(setup.decisions.netPayMonthly ?? 0n),
        withdrawal: w.kind === 'percent' ? `percent, ${pct(w.rate)} a year` : w.kind,
        cashInBank: rough(setup.decisions.bankBuffer),
        holdings: Object.entries(byClass).map(([kind, value]) => ({ kind, value: rough(value) })),
        tax: setup.taxTable ?? 'off (before tax)',
      });
    }
    case 'get_spending_summary': {
      const { spending } = await inputsFor(v, setup);
      const by = (r: Record<string, number>) =>
        Object.fromEntries(Object.entries(r).map(([g, x]) => [g, roughAmount(x)]));
      return JSON.stringify({
        currentPerMonth: {
          total: roughAmount(sum(spending.current)),
          byGroup: by(spending.current),
        },
        tierPerMonth: {
          tier: setup.goal.tier,
          total: roughAmount(sum(spending.tier)),
          byGroup: by(spending.tier),
          source: spending.tierSource,
        },
        bigPurchasesPerMonth: roughAmount(spending.capexMonthly),
      });
    }
    case 'list_scenarios':
      return JSON.stringify(
        (await loadScenarios()).map((s) => ({ id: s.id, name: s.name, source: s.source }))
      );
    case 'run_plan': {
      const id = input.scenarioId as string | null;
      const saved = id ? (await loadScenarios()).find((s) => s.id === id) : undefined;
      if (id && !saved) return JSON.stringify({ error: `No scenario ${id}` });
      const s = saved?.setup ?? setup;
      const runs = (input.runs as number) || 200;
      const r = await simulateSetup(v, s, runs, true);
      const { scenario, spending } = await inputsFor(v, s);
      const det = deterministicFreedom(scenario, spending);
      const end = (k: 'p10' | 'p50' | 'p90') => roughAmount(r.capital[k].at(-1) ?? 0);
      if (sink) sink.chart = { kind: 'chance', p: r.pSuccess, target: s.goal.targetProbability };
      return JSON.stringify({
        runId: runIdOf(r),
        plan: saved?.name ?? 'current plan',
        freedomStarts: s.goal.start.slice(0, 7),
        pSuccess: Math.round(r.pSuccess * 1000) / 1000,
        chanceOfSuccess: pct(r.pSuccess),
        endCapital: { p10: end('p10'), p50: end('p50'), p90: end('p90') },
        freedomNumberAssumed: roughAmount(det.freedomNumber),
        runs: r.runs,
      });
    }
    case 'propose_plan': {
      const n = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : undefined);
      let next = applyLevers(setup, {
        ...(n('startYearsLater') !== undefined ? { start: n('startYearsLater') } : {}),
        ...(n('tierSpendPercent') !== undefined ? { tierSpend: n('tierSpendPercent')! / 100 } : {}),
        ...(n('currentSpendPercent') !== undefined
          ? { currentSpend: n('currentSpendPercent')! / 100 }
          : {}),
        ...(n('projectIncomePerYear') !== undefined
          ? { projectIncome: n('projectIncomePerYear') }
          : {}),
      });
      if (typeof input.withdrawal === 'string')
        next = {
          ...next,
          decisions: {
            ...next.decisions,
            withdrawal: withdrawalOf(input.withdrawal as never, next),
          },
        };
      // Never below what the essentials cost (ADR 0033).
      const lever = next.levers?.tierSpend ?? 1;
      const nextSpending = (await inputsFor(v, next)).spending;
      const floor = minTierSpend(nextSpending, lever);
      const raised = lever < floor;
      if (raised)
        next = {
          ...next,
          levers: { tierSpend: floor, currentSpend: next.levers?.currentSpend ?? 1 },
        };
      const saved = await addScenario(String(input.name || 'Advisor proposal'), next, 'advisor');
      return JSON.stringify({
        scenarioId: saved.id,
        name: saved.name,
        freedomStarts: next.goal.start.slice(0, 7),
        spendingAfterFreedom: `${pct(next.levers?.tierSpend ?? 1)} of the tier`,
        ...(raised
          ? {
              raised: `Spending after freedom was raised from ${pct(lever)} to ${pct(floor)} of the tier: lower can't pay for the essentials (about ${rough(BigInt(Math.round((nextSpending.essentials?.monthly ?? 0) * 100)))} a month).`,
            }
          : {}),
        note: 'Saved for the user to review on the Scenarios screen.',
      });
    }
    case 'explain_assumption': {
      const key = input.key as AssumptionKey;
      const models = new Map(setup.returnModels.map((m) => [m.id, m.label]));
      const t = setup.taxTable ? taxTable(setup.taxTable) : null;
      const text: Record<AssumptionKey, string> = {
        returns: `Each holding's returns are drawn from its model every simulated month: ${[...new Set(setup.holdings.map((h) => models.get(h.returnModelId) ?? h.returnModelId))].join('; ')}. These are assumptions (labelled assumed), editable on the Freedom screen.`,
        tax: t
          ? `Australian ${t.financialYear} resident rates, Medicare levy and the capital gains discount, per person, held constant in today's dollars. Provenance: ${taxProvenance(t)}.`
          : 'Tax is off: results are before tax.',
        inflation: `Everything is simulated in today's dollars. The CPI assumption is ${pct(v.budget.settings.cpi)} a year (assumed), used for dollars of the day on the Forecast screen and to convert imported price histories to real returns.`,
        spending:
          'Before freedom: the average of the last 12 months. After: the goal tier from the budget (or current spending if there is no budget), times the spending levers, varied by the forecast range.',
        'big-purchases':
          'Replacements of items in the Big purchases register, simulated from their expected lives, plus wish-list items with a buy-by decision.',
        withdrawals: `Strategy: ${setup.decisions.withdrawal.kind}. Holdings are sold in a set order to cover spending; super stays locked until its date.`,
        floor: `A plan succeeds only if capital never falls below ${rough(setup.goal.floor)} and spending is always met, from freedom's start to its end.`,
      };
      return JSON.stringify({ key, explanation: text[key] });
    }
    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}

export interface AdvisorMessage {
  role: 'user' | 'advisor';
  text: string;
  /** Figures in the reply no tool returned (NFR-HON-002). */
  unverified: string[];
  runIds: string[];
  tools: string[];
  /** Cards, buttons and a chart the tools offered. */
  proposals: Proposal[];
  links: { label: string; path: string }[];
  chart?: Insight['chart'];
  charts: BuiltChart[];
  /** The provider's label, e.g. "Google Gemini". */
  provider: string;
}

/** What a tool call looks like in the activity log: while it runs, and once done. */
export function toolActivity(name: string, input: Record<string, unknown>): [string, string] {
  const runs = typeof input.runs === 'number' && input.runs > 0 ? input.runs : 200;
  switch (name) {
    case 'run_plan':
      return [
        `Running ${input.scenarioId ? 'that scenario' : 'your plan'} in ${runs} simulated futures…`,
        `Ran ${runs} simulated futures`,
      ];
    case 'get_plan':
      return ['Reading your plan…', 'Read your plan'];
    case 'get_spending_summary':
      return ['Adding up your spending…', 'Added up your spending'];
    case 'list_scenarios':
      return ['Listing your scenarios…', 'Listed your scenarios'];
    case 'propose_plan':
      return ['Saving a proposed plan to Scenarios…', 'Saved a proposed plan to Scenarios'];
    case 'explain_assumption':
      return ['Looking up an assumption…', 'Looked up an assumption'];
    case 'check_plan':
      return ["Checking your plan's settings…", "Checked your plan's settings"];
    case 'explain_shortfall':
      return ['Looking at what holds your plan back…', 'Looked at what holds your plan back'];
    case 'find_plan_changes':
      return ['Trying changes to your plan…', 'Tried changes to your plan'];
    case 'find_earliest_freedom':
      return [
        'Searching for the earliest date your plan reaches its target…',
        'Searched for the earliest date',
      ];
    case 'get_forecast_confidence':
      return ["Reading the forecast model's checks…", "Read the forecast model's checks"];
    case 'propose_budget_line':
      return ['Preparing a budget line…', 'Prepared a budget line for you to check'];
    case 'propose_big_purchase':
      return ['Preparing a big purchase…', 'Prepared a big purchase for you to check'];
    case 'propose_categorisation':
      return ['Preparing category changes…', 'Prepared category changes for you to check'];
    case 'go_to_screen':
      return ['Finding that screen…', 'Offered a button to open it'];
    case 'make_chart':
      return ['Drawing the chart from your data…', 'Drew the chart'];
    case 'run_my_plan':
      return ['Running your plan in full…', 'Ran your plan in full and kept it in History'];
    case 'get_plan_history':
      return ['Reading your earlier runs…', 'Read your earlier runs'];
    default:
      return [`Running ${name}…`, `Ran ${name}`];
  }
}

/** Rounds of tool calls in one answer; one more request then asks for the answer itself. */
export const MAX_TOOL_ROUNDS = 8;

export class AdvisorSession {
  turns: Turn[] = [];
  private toolTexts: string[] = [];
  private readonly view: () => DataView;

  constructor(view: () => DataView) {
    this.view = view;
  }

  /**
   * One question, answered by the AI with the tools on this device. Each
   * request, each tool run and the AI's words are reported to `onActivity` as
   * they happen. Stopping (`signal`) forgets the unfinished exchange, so the
   * conversation stays valid for the next question.
   */
  async ask(
    question: string,
    opts: { context?: string; signal?: AbortSignal; onActivity?: ActivitySink } = {}
  ): Promise<AdvisorMessage> {
    const ap = await activeProvider();
    if (!ap.ok) throw new Error(ap.reason);
    const label = ap.provider.label;
    const say = opts.onActivity;
    const mark = this.turns.length;
    this.turns.push({
      role: 'user',
      text: opts.context ? `[Screen: ${opts.context}]\n${question}` : question,
    });
    const sink: ToolSink = { proposals: [], links: [], charts: [] };
    const runIds: string[] = [];
    const tools: string[] = [];
    let text = '';
    try {
      for (let n = 0; n <= MAX_TOOL_ROUNDS; n++) {
        // After the last round of tools, the model must answer with what it has,
        // so a question never ends on an unanswered tool call.
        const last = n === MAX_TOOL_ROUNDS;
        const request = chatRequest(ap.provider, {
          system: ADVISOR_SYSTEM,
          turns: this.turns,
          tools: ADVISOR_TOOLS,
          ...(last ? { toolChoice: 'none' as const } : {}),
          stream: true,
        });
        const size = kb(new TextEncoder().encode(JSON.stringify(request.body)).length);
        const sendId = activityId('send');
        const t0 = performance.now();
        say?.({
          kind: 'crux',
          id: sendId,
          state: 'running',
          text:
            n === 0
              ? `Sending your question${opts.context ? ', the screen' : ''} and our conversation to ${label}…`
              : `Sending the results back to ${label}…`,
        });
        const aiId = activityId('ai');
        let first = true;
        const reply = await sendStream({
          provider: ap.provider,
          auth: ap.provider,
          purpose: 'advisor',
          purposeLabel:
            'Advisor: your question, the conversation so far, and tool results with rounded amounts.',
          note: 'Tool results contain rounded totals from your plan and simulations, never transactions, account details or exact balances.',
          request,
          ...(opts.signal ? { signal: opts.signal } : {}),
          onSent: () =>
            say?.({
              kind: 'crux',
              id: sendId,
              state: 'running',
              text: `Sent to ${label} (${size}, amounts rounded). Waiting for its reply…`,
            }),
          onDelta: (d) => {
            if (d.kind === 'tool') return;
            if (first) {
              first = false;
              say?.({
                kind: 'crux',
                id: sendId,
                state: 'done',
                text: `Sent to ${label} (${size}, amounts rounded) · replied in ${elapsed(t0)}`,
              });
            }
            say?.({
              kind: 'ai',
              id: aiId,
              provider: label,
              text: d.text,
              ...(d.kind === 'note' ? { note: true } : {}),
            });
          },
        });
        if (first)
          say?.({
            kind: 'crux',
            id: sendId,
            state: 'done',
            text: `Sent to ${label} (${size}, amounts rounded) · replied in ${elapsed(t0)}`,
          });
        say?.({ kind: 'ai-end', id: aiId });
        this.turns.push({
          role: 'assistant',
          text: reply.text,
          calls: reply.calls,
          raw: reply.raw,
        });
        text = reply.text;
        if (reply.stop === 'refusal') {
          text = 'The provider declined to answer this.';
          break;
        }
        if (reply.stop === 'max_tokens' && !reply.calls.length) {
          text = `${text}\n\n*(The reply was cut off.)*`;
          break;
        }
        if (last && reply.calls.length) {
          // A provider that ignored "no tools": a call without its result would
          // make the next request invalid, so the turn is dropped.
          this.turns.pop();
          text ||= 'I ran out of steps before I could answer. Try asking a narrower question.';
        }
        if (!reply.calls.length || last) break;
        const results = [];
        for (const c of reply.calls) {
          opts.signal?.throwIfAborted();
          tools.push(c.name);
          const tool = ADVISOR_TOOLS.find((t) => t.name === c.name);
          const bad = tool ? checkToolInput(tool, c.input) : `Unknown tool ${c.name}`;
          const input = (c.input ?? {}) as Record<string, unknown>;
          const [running, done] = toolActivity(c.name, input);
          const content = bad
            ? JSON.stringify({ error: `Invalid input: ${bad}` })
            : await step(say, `${running} (${label} asked)`, done, (update) => {
                sink.onProgress = update;
                return runTool(this.view(), c.name, input, sink);
              });
          this.toolTexts.push(content);
          for (const [, id] of content.matchAll(/"runId":"([^"]+)"/g)) {
            runIds.push(id!);
            say?.({ kind: 'run', runId: id! });
          }
          results.push({ id: c.id, content, ...(bad ? { isError: true } : {}) });
        }
        this.turns.push({ role: 'tool', results });
      }
    } catch (err) {
      // Stopped or failed part-way: drop the unfinished exchange (a tool call
      // without its result would make the next request invalid).
      this.turns.length = mark;
      throw err;
    }
    return {
      role: 'advisor',
      text,
      // The screen context the person sent counts as theirs (e.g. their own target).
      unverified: unverifiedFigures(text, this.toolTexts, `${opts.context ?? ''}\n${question}`),
      runIds,
      tools,
      proposals: sink.proposals,
      links: sink.links,
      ...(sink.chart ? { chart: sink.chart } : {}),
      charts: sink.charts,
      provider: label,
    };
  }
}
