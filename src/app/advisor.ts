/**
 * The advisor's runtime (SPEC §13.3): the tool implementations, which run
 * on this device against the user's own plan and simulator, and the
 * conversation loop, where every provider call goes through the egress
 * gate. The conversation lives in memory only.
 */
import { checkToolInput, chatRequest, parseReply, type Turn } from '../api/llm.ts';
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
import { activeProvider, send } from './egress.ts';
import { inputsFor, runIdOf, simulateSetup } from './freedom-inputs.ts';
import { addScenario, loadScenarios } from './scenarios.ts';
import { findChanges, forecastConfidence, whyShort, type Insight } from './insights.ts';
import {
  assetProposal,
  budgetLineProposal,
  categoriseProposal,
  describe,
  type Proposal,
} from './proposals.ts';
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
    case 'explain_shortfall': {
      const i = await whyShort(v);
      return JSON.stringify(i.facts);
    }
    case 'find_plan_changes': {
      const i = await findChanges(v, (d, t) =>
        sink?.onProgress?.(`Trying plans: ${d} of up to ${t}…`)
      );
      if (i.proposal) sink?.proposals.push(i.proposal);
      if (i.link) sink?.links.push(i.link);
      return JSON.stringify({
        ...i.facts,
        ...(i.proposal ? { offered: 'Shown to the user as a scenario card to save.' } : {}),
      });
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
      const saved = await addScenario(String(input.name || 'Advisor proposal'), next, 'advisor');
      return JSON.stringify({
        scenarioId: saved.id,
        name: saved.name,
        freedomStarts: next.goal.start.slice(0, 7),
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
  /** The provider's label, e.g. "Google Gemini". */
  provider: string;
}

export class AdvisorSession {
  turns: Turn[] = [];
  private toolTexts: string[] = [];
  private readonly view: () => DataView;

  constructor(view: () => DataView) {
    this.view = view;
  }

  async ask(
    question: string,
    onTool?: (name: string) => void,
    opts: { context?: string; onProgress?: (text: string) => void } = {}
  ): Promise<AdvisorMessage> {
    const ap = await activeProvider();
    if (!ap.ok) throw new Error(ap.reason);
    this.turns.push({
      role: 'user',
      text: opts.context ? `[Screen: ${opts.context}]\n${question}` : question,
    });
    const sink: ToolSink = {
      proposals: [],
      links: [],
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    };
    const runIds: string[] = [];
    const tools: string[] = [];
    let text = '';
    for (let step = 0; step < 8; step++) {
      const json = await send({
        provider: ap.provider,
        auth: ap.provider,
        purpose: 'advisor',
        purposeLabel:
          'Advisor: your question, the conversation so far, and tool results with rounded amounts.',
        note: 'Tool results contain rounded totals from your plan and simulations, never transactions, account details or exact balances.',
        request: chatRequest(ap.provider, {
          system: ADVISOR_SYSTEM,
          turns: this.turns,
          tools: ADVISOR_TOOLS,
        }),
      });
      const reply = parseReply(ap.provider, json);
      this.turns.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
      text = reply.text;
      if (reply.stop === 'refusal') {
        text = 'The provider declined to answer this.';
        break;
      }
      if (!reply.calls.length) break;
      const results = [];
      for (const c of reply.calls) {
        onTool?.(c.name);
        tools.push(c.name);
        const tool = ADVISOR_TOOLS.find((t) => t.name === c.name);
        const bad = tool ? checkToolInput(tool, c.input) : `Unknown tool ${c.name}`;
        const content = bad
          ? JSON.stringify({ error: `Invalid input: ${bad}` })
          : await runTool(this.view(), c.name, c.input as Record<string, unknown>, sink);
        this.toolTexts.push(content);
        const id = /"runId":"([^"]+)"/.exec(content)?.[1];
        if (id) runIds.push(id);
        results.push({ id: c.id, content, ...(bad ? { isError: true } : {}) });
      }
      this.turns.push({ role: 'tool', results });
    }
    return {
      role: 'advisor',
      text,
      unverified: unverifiedFigures(text, this.toolTexts, question),
      runIds,
      tools,
      proposals: sink.proposals,
      links: sink.links,
      ...(sink.chart ? { chart: sink.chart } : {}),
      provider: ap.provider.label,
    };
  }
}
