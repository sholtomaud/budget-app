/**
 * What a chat message asks for, without an AI (ADR 0023). Common questions
 * and requests are recognised by simple patterns and answered by the app
 * itself ("Crux"); anything else goes to the AI provider, if one is set up.
 * Pure functions: the app-side handlers live in src/app/assistant.ts.
 */
import { GLOSSARY } from './phrases.ts';

export type Intent =
  | { id: 'chance' }
  | { id: 'full-run' }
  | { id: 'why' }
  | { id: 'fix' }
  | { id: 'earliest' }
  | { id: 'sure' }
  | { id: 'spending' }
  | { id: 'review' }
  | { id: 'page' }
  | { id: 'define'; text: string }
  | { id: 'navigate'; path: string; label: string }
  | {
      id: 'budget-line';
      item: string;
      amount: number;
      period: string;
      /** "until March 2038": the last month paid, YYYY-MM (FR-BUD-005). */
      until?: string;
      /** "for 12 more years": resolved against today by the app. */
      forYears?: number;
    }
  | { id: 'asset'; name: string; ageYears?: number; cost?: number }
  | { id: 'categorise'; match: string; category: string }
  | { id: 'chart'; request: ChartRequest };

/** A chart asked for in words (ADR 0028): turned into a spec by src/viz/requests.ts. */
export interface ChartRequest {
  dataset: 'spending' | 'income' | 'big-purchases' | 'capital' | 'flows';
  /** For 'flows': which of spending, income and savings to draw on one timeline. */
  flows?: ('spending' | 'income' | 'saved')[];
  groupBy: 'month' | 'quarter' | 'year' | 'category' | 'group' | 'merchant' | 'item';
  /** "on groceries": a category, group or words to look for. */
  topic?: string;
  months?: number;
  vsBudget: boolean;
}

/** "Chart my spending on groceries by month against the budget", and the like. */
export function matchChart(t: string): ChartRequest | null {
  const chartWord = /\b(chart|graph|plot|visuali[sz]e|draw)\b/.test(t);
  const income = /\b(income|earnings|salary|wages)\b/.test(t);
  const spending = /\b(spend|spending|spent|expenses?|costs?|outgoings)\b/.test(t);
  const saving = /\b(savings?|saved|kept|left over)\b/.test(t);
  // Two or more of spending, income and savings: one timeline from the ledger.
  if (chartWord && [income, spending, saving].filter(Boolean).length >= 2) {
    const flows: NonNullable<ChartRequest['flows']> = [];
    if (spending) flows.push('spending');
    if (income) flows.push('income');
    if (saving) flows.push('saved');
    const n = /\b(?:last|past)\s+(\d+)\s+(months?|years?)\b/.exec(t);
    return {
      dataset: 'flows',
      flows,
      groupBy: /\b(yearly|per year|each year|by year)\b/.test(t)
        ? 'year'
        : /\b(quarterly|by quarter)\b/.test(t)
          ? 'quarter'
          : 'month',
      ...(n ? { months: Math.min(120, Number(n[1]) * (n[2]!.startsWith('year') ? 12 : 1)) } : {}),
      vsBudget: false,
    };
  }
  // Savings over time: from the plan's simulation, not the ledger.
  if (
    /\b(savings|capital|balance|net worth|wealth|nest egg|money left|investments)\b/.test(t) &&
    (chartWord ||
      /\b(over time|forecast|future|in (my |the )?(plan|freedom|scenario))\b/.test(t)) &&
    /\b(chart|graph|plot|draw|show|see|forecast|visuali[sz]e)\b/.test(t)
  )
    return { dataset: 'capital', groupBy: 'year', vsBudget: false };
  const by =
    /\bby (month|quarter|year|category|categories|group|merchant|shop|store|payee)s?\b/.exec(
      t
    )?.[1];
  const time = /\b(monthly|per month|each month|over time|trend|month by month)\b/.test(t)
    ? 'month'
    : /\b(yearly|per year|each year|year by year)\b/.test(t)
      ? 'year'
      : /\bquarterly\b/.test(t)
        ? 'quarter'
        : undefined;
  if (!chartWord && !(/\bshow\b/.test(t) && (by || time) && (income || spending))) return null;
  // "When can I make my big purchases?": the register's timeline, ahead of today.
  if (/\b(big purchases?|big[- ]ticket|capex|replacements?)\b/.test(t) && !spending && !income) {
    const ahead = /\b(?:next|coming)\s+(\d+)\s+(months?|years?)\b/.exec(t);
    const groupBy: ChartRequest['groupBy'] = /\b(by|per|each) (item|thing)s?\b/.test(t)
      ? 'item'
      : by === 'category' || by === 'categories'
        ? 'category'
        : by === 'month' || by === 'quarter' || by === 'year' || by === 'group'
          ? by
          : (time ?? 'year');
    return {
      dataset: 'big-purchases',
      groupBy,
      ...(ahead
        ? { months: Math.min(600, Number(ahead[1]) * (ahead[2]!.startsWith('year') ? 12 : 1)) }
        : {}),
      vsBudget: false,
    };
  }
  const groupBy: ChartRequest['groupBy'] =
    by === 'categories' || by === 'category'
      ? 'category'
      : by === 'shop' || by === 'store' || by === 'payee' || by === 'merchant'
        ? 'merchant'
        : ((by as ChartRequest['groupBy'] | undefined) ?? time ?? 'month');
  const topic =
    /\b(?:on|for|at)\s+([a-z][a-z &'-]{1,30}?)(?=\s+(?:by|over|per|each|in|for|during|last|past|this|against|vs|versus|compared|month|monthly|quarterly|yearly)\b|[.?!]|$)/.exec(
      t
    )?.[1];
  // A chart of something Crux can't name ("my coffee habit") is left for the AI.
  const named = topic && !/^(my|the|me|it|this|that|time)$/.test(topic) ? topic.trim() : undefined;
  if (!income && !spending && !named) return null;
  const n = /\b(?:last|past)\s+(\d+)\s+(months?|years?)\b/.exec(t);
  const months = n
    ? Number(n[1]) * (n[2]!.startsWith('year') ? 12 : 1)
    : /\b(?:last|past|this)\s+year\b/.test(t)
      ? 12
      : undefined;
  return {
    dataset: income && !spending ? 'income' : 'spending',
    groupBy,
    ...(named ? { topic: named } : {}),
    ...(months ? { months: Math.min(120, months) } : {}),
    vsBudget: /\b(against|vs\.?|versus|compared (to|with))\s+(my |the |our )?budget/.test(t),
  };
}

/** Screens by the words people use for them. */
export const SCREEN_WORDS: { words: RegExp; path: string; label: string }[] = [
  { words: /^(start|home)$/, path: '/', label: 'Start' },
  { words: /^import$/, path: '/import', label: 'Import' },
  { words: /^(transactions|ledger)$/, path: '/ledger', label: 'Transactions' },
  { words: /^budget$/, path: '/budget', label: 'Budget' },
  { words: /^(big purchases|capex|capex register)$/, path: '/capex', label: 'Big purchases' },
  { words: /^forecasts?$/, path: '/forecast', label: 'Forecast' },
  { words: /^(freedom|freedom number|my plan|plan)$/, path: '/freedom', label: 'Freedom' },
  { words: /^(scenarios|compare plans)$/, path: '/scenarios', label: 'Scenarios' },
  { words: /^(dashboards?|my dashboards?)$/, path: '/dashboards', label: 'Dashboards' },
  { words: /^(saved charts|my charts|charts)$/, path: '/charts', label: 'Saved charts' },
  { words: /^(schedules?|my schedules?)$/, path: '/schedules', label: 'Schedules' },
  { words: /^(profile|my profile|my age)$/, path: '/profile', label: 'Profile' },
  { words: /^settings$/, path: '/settings', label: 'Settings' },
];

const PERIODS: [RegExp, string][] = [
  [/\b(a|per|each|every)\s+day\b|\bdaily\b/, 'd'],
  [/\b(a|per|each|every)\s+fortnight\b|\bfortnightly\b/, 'f'],
  [/\b(a|per|each|every)\s+week\b|\bweekly\b/, 'w'],
  [/\b(a|per|each|every)\s+quarter\b|\bquarterly\b/, 'q'],
  [/\b(a|per|each|every)\s+year\b|\b(yearly|annually)\b/, 'y'],
  [/\b(a|per|each|every)\s+month\b|\bmonthly\b/, 'm'],
];

/** "$45", "$1,200.50", "$2k": the first dollar amount, in dollars. */
export function parseDollars(text: string): number | undefined {
  const m = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ''));
  return m[2] ? n * 1000 : n;
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const sentences = (t: string) => t.split(/[.?!]+(?:\s|$)/).filter((x) => x.trim()).length;
/** A message short enough to be one request: a card is only offered for one of these. */
const oneRequest = (t: string) => words(t) <= 25 && sentences(t) <= 2;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "until March 2038", "till 2038", "for 12 more years": when a cost stops (FR-BUD-005). */
function untilOf(t: string): { until?: string; forYears?: number } {
  const u =
    /\b(?:until|till|to|ending|ends?(?: in)?)\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(20\d{2}|21\d{2})\b/.exec(
      t
    );
  if (u)
    return {
      until: `${u[2]}-${String(u[1] ? MONTHS.indexOf(u[1]) + 1 : 12).padStart(2, '0')}`,
    };
  const f = /\bfor\s+(?:another\s+|the next\s+)?(\d{1,2})\s+(?:more\s+)?years?\b/.exec(t);
  return f ? { forYears: Number(f[1]) } : {};
}

const clean = (s: string) =>
  s
    .replace(/^(the|my|our|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export function matchIntent(raw: string): Intent | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  const t = text.toLowerCase();

  // Requests to change something (proposals): these carry their own details.
  // Only in a short message with one amount: a pasted screen or a long
  // question that mentions "$24k a year" in passing is not a request.
  const single = oneRequest(text) && (text.match(/\$\s?\d/g) ?? []).length <= 1;
  const dollars = single ? parseDollars(text) : undefined;
  const recurring = PERIODS.some(([re]) => re.test(t));
  if (
    dollars !== undefined &&
    (/\b(i (pay|spend)|we (pay|spend)|add (a )?(budget|line)|costs? (me|us))\b|\bbudget for\b/.test(
      t
    ) ||
      (recurring && /\b(is|costs?)\s+\$/.test(t)))
  ) {
    const period = PERIODS.find(([re]) => re.test(t))?.[1] ?? 'm';
    const stop = String.raw`(?=\s+(?:a|per|each|every|until|for|till)\s|[.,!?]|$)`;
    const item =
      new RegExp(String.raw`\bfor\s+([a-z][\w' -]{1,40}?)${stop}`, 'i').exec(text)?.[1] ??
      new RegExp(String.raw`\bon\s+([a-z][\w' -]{1,40}?)${stop}`, 'i').exec(text)?.[1] ??
      /^(?:my\s+|our\s+)?([a-z][\w' -]{1,40}?)\s+(?:is|costs?)\s+\$/i.exec(text)?.[1];
    return {
      id: 'budget-line',
      item: clean(item ?? 'New budget line'),
      amount: dollars,
      period,
      ...untilOf(t),
    };
  }
  const old =
    /\b(?:my|our|the)\s+([a-z][\w -]{1,30}?)\s+is\s+(\d+(?:\.\d+)?)\s+years?\s+old\b/i.exec(text);
  if (old && single)
    return {
      id: 'asset',
      name: clean(old[1]!),
      ageYears: Number(old[2]),
      ...(dollars !== undefined ? { cost: dollars } : {}),
    };
  const buy =
    /\b(?:add|plan(?:ning)? to (?:buy|replace)|need (?:a|to replace)|replace|replacing|buying)\s+(?:a |an |my |the |our )?([a-z][\w -]{1,30}?)(?=\s+(?:for|costing|at|in|next|this|soon)\b|\s+to\s+(?:my\s+)?big purchases|[.,!?]|$)/i.exec(
      text
    );
  if (single && buy && /\b(big purchases?|capex|replace|replacing|buy|buying|new)\b/i.test(t))
    return {
      id: 'asset',
      name: clean(buy[1]!),
      ...(dollars !== undefined ? { cost: dollars } : {}),
    };
  const cat =
    /\b(?:categori[sz]e|put|move|mark|file|label)\s+(?:all\s+)?(?:of\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:ones\s+|transactions\s+|purchases\s+|payments\s+)?(?:as|to|under|into|in)\s+(?:the\s+)?(.+?)(?:\s+category)?[.!?]*$/i.exec(
      text
    );
  if (cat && single) return { id: 'categorise', match: clean(cat[1]!), category: clean(cat[2]!) };

  const chart = matchChart(t);
  if (chart) return { id: 'chart', request: chart };

  const go =
    /\b(?:go to|open|show me|take me to|show)\s+(?:the\s+|my\s+)?([a-z ]+?)(?:\s+(?:screen|page|tab))?[.!?]*$/i.exec(
      t
    );
  if (go) {
    const s = SCREEN_WORDS.find((x) => x.words.test(go[1]!.trim()));
    if (s) return { id: 'navigate', path: s.path, label: s.label };
  }

  // Questions the app answers from its own results.
  if (
    /\b(run (my|the) (whole |full |entire )?(plan|freedom)( in full)?|run everything|full (analysis|run|check)|analy[sz]e (my|the) (whole |full )?plan|check everything)\b/.test(
      t
    )
  )
    return { id: 'full-run' };
  if (
    /\b(earliest|soonest|how (soon|early) can i|when can i (retire|stop work|stop working|be free|quit)|stop working (sooner|earlier)|retire (sooner|earlier))\b/.test(
      t.replace(/[_*~]/g, ' ')
    )
  )
    return { id: 'earliest' };
  if (
    /\b(what would (it take|make)|how (can|do|could) i (improve|fix|reach|get|make)|make (it|my plan|this) work|reach (my )?target|what (can|should) i change|what if i)\b/.test(
      t
    )
  )
    return { id: 'fix' };
  if (/\bwhy\b/.test(t) && /\b(low|fail|not work|doesn'?t work|zero|0 ?%|short|bad|so)\b/.test(t))
    return { id: 'why' };
  if (
    /\b(how (likely|sure is my plan)|chances?|odds|will (my|the|this) plan work|does (my|the|this) plan work|am i on track|is my plan ok)\b/.test(
      t
    )
  )
    return { id: 'chance' };
  if (
    /\b(how (sure|confident|certain|accurate|reliable|good) is (the|this|my) (forecast|model|range)|trust (the|this) (forecast|model)|is the forecast (right|accurate|any good))\b/.test(
      t
    )
  )
    return { id: 'sure' };
  if (
    /\b((review|check|adjust|tune|update|correct) (my|the|our) budget|budget review|is (my|the|our) budget (right|realistic|ok|okay|still right))\b/.test(
      t
    )
  )
    return { id: 'review' };
  if (
    /\b(where does (my|the|our) money go|biggest (spend|spending|cost|expense)s?|what do (i|we) spend (the )?most on|spending summary|where('s| is) my money going)\b/.test(
      t
    )
  )
    return { id: 'spending' };
  if (
    /\b(what is this (page|screen)|explain this (page|screen)|what can i do here|how do i use this( page| screen)?|what am i looking at)\b|^help\??$/.test(
      t
    )
  )
    return { id: 'page' };
  // Only a short question about a term: "that would mean…" in a long message is not one.
  if (
    words(t) <= 10 &&
    /\b(what('s| is| are| does)|explain|meaning of|define|mean)\b/.test(t) &&
    glossaryEntry(t)
  )
    return { id: 'define', text: t };
  return null;
}

/** Intents that answer a question, as opposed to doing something (a card, a chart, a screen). */
const ANSWERS: ReadonlySet<Intent['id']> = new Set([
  'chance',
  'why',
  'fix',
  'earliest',
  'sure',
  'spending',
  'review',
  'page',
  'define',
]);

/**
 * Whether a message is better answered by the AI, when one is set up, even
 * though Crux recognised it: a long or several-sentence message that only
 * matched a question pattern in passing. Crux's templates answer the common
 * question, not the person's own reasoning.
 */
export function wantsAI(raw: string, intent: Intent): boolean {
  if (!ANSWERS.has(intent.id)) return false;
  const text = raw.trim();
  return words(text) > 20 || sentences(text) > 2;
}

/**
 * "Please ask Gemini…", "send this to the AI", "local model: …": the person
 * wants the AI, not Crux's built-in answer. `provider` is the active
 * provider's label ("Google Gemini"), whose words count too.
 */
export function asksForAI(raw: string, provider = ''): boolean {
  const own = provider
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9.]+/)
    .filter((w) => w.length >= 3 && !/^(the|and|model|local|google)$/.test(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const names = [
    'ai',
    'a\\.i\\.?',
    'llm',
    'gemini',
    'claude',
    'chat ?gpt',
    'gpt',
    'openai',
    'ollama',
    'advisor',
    'local (?:ai|model|llm)',
    'model',
    ...own,
  ].join('|');
  const t = raw.toLowerCase();
  return (
    new RegExp(
      `\\b(?:ask|asking|send (?:this|it|that)(?: over)? to|pass (?:this|it|that) (?:on )?to|check with|run (?:this|it) (?:by|past)|use)\\s+(?:the\\s+|my\\s+)?(?:${names})\\b`
    ).test(t) || new RegExp(`^\\s*(?:hey\\s+)?(?:${names})\\s*[,:]`).test(t)
  );
}

/** Two messages that say much the same (one re-sent with a few words changed). */
export function sameMessage(a: string, b: string): boolean {
  const set = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? []);
  const x = set(a);
  const y = set(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.6;
}

/** The glossary entry a question is about, by its longest matching term. */
export function glossaryEntry(text: string): (typeof GLOSSARY)[number] | undefined {
  const t = text.toLowerCase();
  let best: { e: (typeof GLOSSARY)[number]; len: number } | undefined;
  for (const e of GLOSSARY)
    for (const term of e.terms)
      if (
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t) &&
        term.length > (best?.len ?? 0)
      )
        best = { e, len: term.length };
  return best?.e;
}

/** The suggestion chips shown before the first message and after answers. */
export const STARTERS = [
  'How likely is my plan to work?',
  'What would make it work?',
  'Where does my money go?',
  'How sure is the forecast?',
  'Explain this screen',
];
