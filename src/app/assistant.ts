/**
 * The chat panel's brain (ADR 0023). A message is answered, in order:
 *
 * 1. by Crux itself, when it is one of the common questions or requests
 *    (src/assistant/intents.ts): built from the app's own results and
 *    templates, with no AI and nothing leaving the device;
 * 2. from this session's cache, when the same question was asked about the
 *    same data on the same screen and the AI already answered it;
 * 3. by the AI provider, if one is set up, through the egress gate;
 * 4. otherwise with what Crux can do, and how to turn on a provider.
 *
 * Every reply says which: "Crux" or "Crux + <provider>". Conversations live
 * in memory for the session only.
 */
import { glossaryEntry, matchIntent, STARTERS, type Intent } from '../assistant/intents.ts';
import { dollars } from '../assistant/phrases.ts';
import type { DataView } from '../data/service.ts';
import { canonicalJson } from '../lib/hash.ts';
import { fnv1a64 } from '../lib/prng.ts';
import { AdvisorSession } from './advisor.ts';
import { navigate } from './core/router.ts';
import { activeProvider } from './egress.ts';
import { GUIDE } from './guide.ts';
import {
  currentSetup,
  findChanges,
  forecastConfidence,
  planChance,
  spendingSummary,
  whyShort,
  type Insight,
} from './insights.ts';
import {
  assetProposal,
  budgetLineProposal,
  categoriseProposal,
  describe,
  PERIOD_WORDS,
  type Proposal,
} from './proposals.ts';

export interface PageContext {
  path: string;
  title: string;
  /** What the screen shows right now, in a few words (already rounded). */
  detail?: string;
}

export interface ChatReply {
  source: 'crux' | 'ai';
  provider?: string;
  /** Repeated from earlier in this session (no new AI call). */
  cached?: boolean;
  /** Markdown; run ids become footnotes. */
  text: string;
  runIds: string[];
  unverified: string[];
  /** What was done to answer: "Ran your plan in 500 futures". */
  steps: string[];
  chart?: Insight['chart'];
  proposals: Proposal[];
  links: { label: string; path: string }[];
  suggestions: string[];
}

/** What to suggest on each screen. */
const PAGE_SUGGESTIONS: Record<string, string[]> = {
  '/': ['How likely is my plan to work?', 'Where does my money go?'],
  '/import': ['What does reconciliation mean?', 'Show me the transactions'],
  '/ledger': ['Categorise the cafe ones as Cafes', 'Where does my money go?'],
  '/budget': ['I pay $45 a month for the gym', 'Where does my money go?'],
  '/capex': ['My car is 6 years old', 'What is a big purchase?'],
  '/forecast': ['How sure is the forecast?', 'What does P90 mean?'],
  '/freedom': ['How likely is my plan to work?', 'Why is it low?', 'What would make it work?'],
  '/scenarios': ['What would make it work?', 'What is a freedom number?'],
};

const reply = (r: Partial<ChatReply> & { text: string }): ChatReply => ({
  source: 'crux',
  runIds: [],
  unverified: [],
  steps: [],
  proposals: [],
  links: [],
  suggestions: [],
  ...r,
});

const fromInsight = (i: Insight, steps: string[]): ChatReply =>
  reply({
    text: i.text,
    runIds: i.runIds,
    steps,
    ...(i.chart ? { chart: i.chart } : {}),
    proposals: i.proposal ? [i.proposal] : [],
    links: i.link ? [i.link] : [],
    suggestions: i.suggestions ?? [],
  });

const contextText = (c: PageContext | null) =>
  c ? `${c.title}${c.detail ? ` · ${c.detail}` : ''}` : undefined;

export class Assistant {
  private session: AdvisorSession;
  private readonly cache = new Map<string, ChatReply>();

  private readonly view: () => DataView;

  constructor(view: () => DataView) {
    this.view = view;
    this.session = new AdvisorSession(view);
  }

  /** Forget the conversation (the panel's "New chat"). */
  reset(): void {
    this.session = new AdvisorSession(this.view);
    this.cache.clear();
  }

  async answer(
    question: string,
    context: PageContext | null,
    onStatus: (text: string) => void = () => {}
  ): Promise<ChatReply> {
    const intent = matchIntent(question);
    if (intent) return this.builtIn(intent, context, onStatus);

    const ap = await activeProvider();
    if (!ap.ok)
      return reply({
        text: `I can answer common questions on my own, on this device: how likely your plan is to work, why, what would make it work, where your money goes, how sure the forecast is, and what the terms mean. I can also add budget lines, big purchases and categories for you to approve.\n\nFor anything else, an AI provider can help. It's optional: turn one on in Settings. Your key is kept only while the app is open.`,
        links: [{ label: 'Open Settings', path: '/settings' }],
        suggestions: STARTERS,
      });

    const key = await this.cacheKey(question, context);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };

    onStatus(`Asking ${ap.provider.label}…`);
    const ctx = contextText(context);
    const m = await this.session.ask(
      question,
      (tool) => onStatus(`Working: ${TOOL_STEPS[tool] ?? tool}…`),
      { ...(ctx ? { context: ctx } : {}), onProgress: onStatus }
    );
    const r = reply({
      source: 'ai',
      provider: m.provider,
      text: m.text || 'The provider gave no answer.',
      runIds: [...new Set(m.runIds)],
      unverified: m.unverified,
      steps: [...new Set(m.tools.map((t) => TOOL_STEPS[t] ?? t))],
      ...(m.chart ? { chart: m.chart } : {}),
      proposals: m.proposals,
      links: m.links,
      suggestions: [],
    });
    this.cache.set(key, r);
    return r;
  }

  /** Session-cache key: the question, the screen and a fingerprint of the data and plan. */
  private async cacheKey(question: string, context: PageContext | null): Promise<string> {
    const v = this.view();
    const setup = await currentSetup(v);
    const data = `${v.txns.length}|${v.budget.lines.length}|${v.assets.length}|${v.userLabelled.length}|${fnv1a64(canonicalJson(setup))}`;
    return `${question.trim().toLowerCase()}|${context?.path ?? ''}|${data}`;
  }

  private async builtIn(
    intent: Intent,
    context: PageContext | null,
    onStatus: (text: string) => void
  ): Promise<ChatReply> {
    const v = this.view();
    switch (intent.id) {
      case 'chance':
        onStatus('Running your plan in 500 simulated futures…');
        return fromInsight(await planChance(v), ['Ran your plan in 500 simulated futures']);
      case 'why':
        onStatus('Looking at what holds your plan back…');
        return fromInsight(await whyShort(v), [
          'Ran your plan',
          'Compared capital with what you need',
        ]);
      case 'fix':
        onStatus('Trying different plans…');
        return fromInsight(
          await findChanges(v, (d, t) => onStatus(`Trying plans: ${d} of up to ${t}…`)),
          ['Tried changes to when freedom starts and spending after it']
        );
      case 'sure':
        onStatus('Checking the forecast model…');
        return fromInsight(await forecastConfidence(v), ["Read the forecast model's checks"]);
      case 'spending':
        return fromInsight(await spendingSummary(v), ['Added up the last 12 months']);
      case 'define': {
        const e = glossaryEntry(intent.text);
        return reply({
          text: e?.text ?? 'I don’t have a plain definition for that yet.',
          suggestions: context ? (PAGE_SUGGESTIONS[context.path] ?? STARTERS) : STARTERS,
        });
      }
      case 'page': {
        const step = GUIDE.find((g) => g.path === context?.path);
        const title = context?.title ?? 'this screen';
        return reply({
          text: step
            ? `**${step.title}.** ${step.text}`
            : `This is ${title}. Ask me about your plan, your spending or the forecast, or tell me about a cost to add.`,
          suggestions: PAGE_SUGGESTIONS[context?.path ?? ''] ?? STARTERS,
        });
      }
      case 'navigate':
        navigate(intent.path);
        return reply({
          text: `Opened ${intent.label}.`,
          suggestions: PAGE_SUGGESTIONS[intent.path] ?? [],
        });
      case 'budget-line': {
        const p = budgetLineProposal(v, intent.item, intent.amount, intent.period);
        return reply({
          text: `Here's that as a budget line: **${dollars(intent.amount)} ${PERIOD_WORDS[intent.period] ?? ''}** for ${intent.item}. Check the details, then apply it.`,
          proposals: [p],
          links: [{ label: 'Open Budget', path: '/budget' }],
        });
      }
      case 'asset': {
        const p = assetProposal(v, intent.name, {
          ...(intent.cost !== undefined ? { costDollars: intent.cost } : {}),
          ...(intent.ageYears !== undefined ? { ageYears: intent.ageYears } : {}),
        });
        return reply({
          text: `I can add your ${intent.name} to Big purchases, so its replacement is planned for. ${intent.cost === undefined ? 'Add what a replacement would cost, then apply it.' : 'Check the details, then apply it.'}`,
          proposals: [p],
          links: [{ label: 'Open Big purchases', path: '/capex' }],
        });
      }
      case 'categorise': {
        const p = categoriseProposal(v, intent.match, intent.category);
        if ('error' in p)
          return reply({ text: p.error, links: [{ label: 'Open Transactions', path: '/ledger' }] });
        return reply({
          text: describe(p, v),
          proposals: [p],
          links: [{ label: 'Open Transactions', path: '/ledger' }],
        });
      }
    }
  }
}

const TOOL_STEPS: Record<string, string> = {
  get_plan: 'Read your plan',
  get_spending_summary: 'Read your spending summary',
  list_scenarios: 'Listed your scenarios',
  run_plan: 'Ran a simulation',
  propose_plan: 'Saved a proposed plan to Scenarios',
  explain_assumption: 'Looked up an assumption',
  explain_shortfall: 'Looked at what holds your plan back',
  find_plan_changes: 'Tried changes to your plan',
  get_forecast_confidence: "Read the forecast model's checks",
  propose_budget_line: 'Prepared a budget line',
  propose_big_purchase: 'Prepared a big purchase',
  propose_categorisation: 'Prepared category changes',
  go_to_screen: 'Offered a screen',
};
