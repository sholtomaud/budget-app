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
import { budgetReview } from './budget-review.ts';
import {
  glossaryEntry,
  asksForAI,
  matchIntent,
  sameMessage,
  STARTERS,
  wantsAI,
  type Intent,
} from '../assistant/intents.ts';
import { dollars } from '../assistant/phrases.ts';
import type { DataView } from '../data/service.ts';
import { canonicalJson } from '../lib/hash.ts';
import { fnv1a64 } from '../lib/prng.ts';
import { step, type ActivitySink } from './activity.ts';
import { buildChart, type BuiltChart } from './charts.ts';
import {
  fullRunText,
  PLAN_STEPS,
  runFullPlan,
  saveRun,
  STEP_WORDS,
  type FullRun,
} from './plan-run.ts';
import { SPENDING_BY_GROUP, specFromRequest } from '../viz/requests.ts';
import { AdvisorSession } from './advisor.ts';
import { navigate } from './core/router.ts';
import { activeProvider } from './egress.ts';
import { GUIDE } from './guide.ts';
import {
  currentSetup,
  earliestDate,
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
  chart?: Insight['chart'];
  /** Charts built from the app's data (ADR 0028). */
  charts?: BuiltChart[];
  proposals: Proposal[];
  links: { label: string; path: string }[];
  suggestions: string[];
}

/** What to suggest on each screen. */
const PAGE_SUGGESTIONS: Record<string, string[]> = {
  '/': ['How likely is my plan to work?', 'Where does my money go?'],
  '/import': ['What does reconciliation mean?', 'Show me the transactions'],
  '/ledger': ['Categorise the cafe ones as Cafes', 'Where does my money go?'],
  '/budget': ['Review my budget', 'I pay $45 a month for the gym', 'Where does my money go?'],
  '/capex': ['My car is 6 years old', 'What is a big purchase?'],
  '/forecast': ['How sure is the forecast?', 'What does P90 mean?'],
  '/freedom': ['How likely is my plan to work?', 'Why is it low?', 'What would make it work?'],
  '/scenarios': ['What would make it work?', 'What is a freedom number?'],
};

const reply = (r: Partial<ChatReply> & { text: string }): ChatReply => ({
  source: 'crux',
  runIds: [],
  unverified: [],
  proposals: [],
  links: [],
  suggestions: [],
  ...r,
});

export const fromInsight = (i: Insight): ChatReply =>
  reply({
    text: i.text,
    runIds: i.runIds,
    ...(i.chart ? { chart: i.chart } : {}),
    proposals: [...(i.proposals ?? []), ...(i.proposal ? [i.proposal] : [])],
    links: i.link ? [i.link] : [],
    suggestions: i.suggestions ?? [],
  });

const contextText = (c: PageContext | null) =>
  c ? `${c.title}${c.detail ? ` · ${c.detail}` : ''}` : undefined;

export class Assistant {
  private session: AdvisorSession;
  private readonly cache = new Map<string, ChatReply>();
  /** The last message Crux answered itself, to send a repeat to the AI. */
  private lastBuiltIn: string | undefined;

  private readonly view: () => DataView;

  constructor(view: () => DataView) {
    this.view = view;
    this.session = new AdvisorSession(view);
  }

  /** Forget the conversation (the panel's "New chat"). */
  reset(): void {
    this.session = new AdvisorSession(this.view);
    this.cache.clear();
    this.lastBuiltIn = undefined;
  }

  /**
   * Answer one message. What happens on the way (Crux's steps, requests to
   * the AI, the AI's words as they stream) goes to `onActivity`; the reply
   * itself (text, cards, buttons, footnotes) is returned at the end.
   */
  async answer(
    question: string,
    context: PageContext | null,
    opts: { onActivity?: ActivitySink; signal?: AbortSignal } = {}
  ): Promise<ChatReply> {
    const ap = await activeProvider();
    // Asked for the AI by name ("please ask Gemini…"): never Crux's template.
    const named = asksForAI(question, ap.ok ? ap.provider.label : '');
    const intent = named ? null : matchIntent(question);
    // With an AI set up, a long message, or much the same message sent again
    // after Crux's answer, goes to the AI: the template didn't answer it.
    const again = this.lastBuiltIn !== undefined && sameMessage(question, this.lastBuiltIn);
    if (intent && !(ap.ok && (again || wantsAI(question, intent)))) {
      this.lastBuiltIn = question;
      const r = await this.builtIn(intent, context, opts.onActivity);
      // The AI sees Crux's answers too, so a follow-up to it makes sense.
      this.session.heard(
        question,
        r.proposals.length
          ? `${r.text}\n(Offered ${r.proposals.length === 1 ? 'a card' : `${r.proposals.length} cards`} to apply or discard.)`
          : r.text
      );
      return r;
    }
    this.lastBuiltIn = undefined;

    if (!ap.ok)
      return reply({
        text: `I can answer common questions on my own, on this device: how likely your plan is to work, why, what would make it work, where your money goes, how sure the forecast is, and what the terms mean. I can also add budget lines, big purchases and categories for you to approve.\n\nFor anything else, an AI provider can help. It's optional: turn one on in Settings. Your key is kept only while the app is open.`,
        links: [{ label: 'Open Settings', path: '/settings' }],
        suggestions: STARTERS,
      });

    const key = await this.cacheKey(question, context);
    const hit = this.cache.get(key);
    if (hit) {
      await step(
        opts.onActivity,
        'Checking this session’s answers…',
        `Asked before about the same data on the same screen: reusing ${hit.provider ?? 'the AI'}’s answer. Nothing sent`,
        async () => undefined
      );
      return { ...hit, cached: true };
    }

    const ctx = contextText(context);
    const m = await this.session.ask(question, {
      ...(ctx ? { context: ctx } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onActivity ? { onActivity: opts.onActivity } : {}),
    });
    const r = reply({
      source: 'ai',
      provider: m.provider,
      text: m.text || 'The provider gave no answer.',
      runIds: [...new Set(m.runIds)],
      unverified: m.unverified,
      ...(m.chart ? { chart: m.chart } : {}),
      ...(m.charts.length ? { charts: m.charts } : {}),
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
    say: ActivitySink | undefined
  ): Promise<ChatReply> {
    const v = this.view();
    switch (intent.id) {
      case 'full-run': {
        const setup = await currentSetup(v);
        const tierName = (id: string) => v.budget.tiers.find((t) => t.id === id)?.name ?? id;
        const full = await step(
          say,
          'Running your plan in full: every step of the Freedom screen…',
          (f: FullRun) =>
            f.run.done.length === PLAN_STEPS.length
              ? 'Ran every step and kept it in History'
              : 'Ran part of it',
          (update) =>
            runFullPlan(v, setup, {
              runs: 500,
              onStep: (k, state) => {
                if (state === 'running') update(`${STEP_WORDS[k][0]}…`);
              },
            })
        );
        await saveRun(full.run);
        return reply({
          text: fullRunText(full.run, tierName),
          runIds: [full.run.runId, ...(full.run.earliest?.plans.map((p) => p.runId) ?? [])],
          chart: { kind: 'chance', p: full.run.pSuccess, target: full.run.goal.target },
          links: [{ label: 'Open Freedom', path: '/freedom' }],
          suggestions: ['Why is it low?', 'How sure is the forecast?'],
        });
      }
      case 'chance':
        return fromInsight(
          await step(
            say,
            'Running your plan in 500 simulated futures…',
            'Ran 500 simulated futures',
            () => planChance(v)
          )
        );
      case 'why':
        return fromInsight(
          await step(
            say,
            'Running your plan and comparing your capital with what you need…',
            'Compared your capital with what you need',
            () => whyShort(v)
          )
        );
      case 'fix':
        return fromInsight(
          await step(
            say,
            'Trying changes to when freedom starts and spending after it…',
            'Tried changes to your plan',
            (update) => findChanges(v, (d, t) => update(`Trying plans: ${d} of up to ${t}…`))
          )
        );
      case 'earliest':
        return fromInsight(
          await step(
            say,
            'Searching for the earliest date your plan reaches its target…',
            'Searched for the earliest date',
            (update) => earliestDate(v, (d) => update(`Searching start dates: ${d} plans tried…`))
          )
        );
      case 'sure':
        return fromInsight(
          await step(
            say,
            "Checking the forecast model's checks…",
            "Read the forecast model's checks",
            () => forecastConfidence(v)
          )
        );
      case 'review':
        return fromInsight(
          await step(
            say,
            'Reviewing your budget against the last months of spending…',
            'Reviewed your budget',
            () => budgetReview(v)
          )
        );
      case 'spending': {
        const r = fromInsight(
          await step(say, 'Adding up the last 12 months…', 'Added up the last 12 months', () =>
            spendingSummary(v)
          )
        );
        const c = await buildChart(v, SPENDING_BY_GROUP);
        return c.ok ? { ...r, charts: [c.chart] } : r;
      }
      case 'chart': {
        const spec = specFromRequest(intent.request, v.categories);
        const c = await step(say, 'Drawing the chart from your data…', 'Drew the chart', () =>
          buildChart(v, spec)
        );
        if (!c.ok)
          return reply({
            text: c.error,
            suggestions:
              intent.request.dataset === 'capital' ? ['Run my plan'] : ['Where does my money go?'],
          });
        if (intent.request.dataset === 'capital') {
          const t = c.chart.table;
          const typical = t.series.find((s) => s.role === 'p50')!.values;
          const bad = t.series.find((s) => s.role === 'p5')!.values;
          const end = t.labels[t.labels.length - 1];
          return reply({
            text: `In the typical future your savings go from about **${dollars(typical[0]!)}** now to about **${dollars(typical[typical.length - 1]!)}** in ${end}, in today's dollars. In a bad case (1 future in 20) they are about ${dollars(bad[bad.length - 1]!)} by then. The shaded bands show where most futures fall; the dashed line is your floor. **Save chart** keeps it under Saved charts.`,
            charts: [c.chart],
            suggestions: ['What would make it work?', 'Run my plan'],
          });
        }
        return reply({
          text: `Here is **${spec.title.toLowerCase()}**, from your own data on this device. **Save chart** keeps it under Saved charts.`,
          charts: [c.chart],
          suggestions: ['Chart my spending by group', 'Chart my income by month'],
        });
      }
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
