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
  | { id: 'page' }
  | { id: 'define'; text: string }
  | { id: 'navigate'; path: string; label: string }
  | { id: 'budget-line'; item: string; amount: number; period: string }
  | { id: 'asset'; name: string; ageYears?: number; cost?: number }
  | { id: 'categorise'; match: string; category: string }
  | { id: 'chart'; request: ChartRequest };

/** A chart asked for in words (ADR 0028): turned into a spec by src/viz/requests.ts. */
export interface ChartRequest {
  dataset: 'spending' | 'income' | 'capital';
  groupBy: 'month' | 'quarter' | 'year' | 'category' | 'group' | 'merchant';
  /** "on groceries": a category, group or words to look for. */
  topic?: string;
  months?: number;
  vsBudget: boolean;
}

/** "Chart my spending on groceries by month against the budget", and the like. */
export function matchChart(t: string): ChartRequest | null {
  const chartWord = /\b(chart|graph|plot|visuali[sz]e|draw)\b/.test(t);
  // Savings over time: from the plan's simulation, not the ledger.
  if (
    /\b(savings|capital|balance|net worth|wealth|nest egg|money left|investments)\b/.test(t) &&
    (chartWord ||
      /\b(over time|forecast|future|in (my |the )?(plan|freedom|scenario))\b/.test(t)) &&
    /\b(chart|graph|plot|draw|show|see|forecast|visuali[sz]e)\b/.test(t)
  )
    return { dataset: 'capital', groupBy: 'year', vsBudget: false };
  const income = /\b(income|earnings|salary|wages)\b/.test(t);
  const spending = /\b(spend|spending|spent|expenses?|costs?|outgoings)\b/.test(t);
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
  { words: /^(saved charts|my charts|charts)$/, path: '/charts', label: 'Saved charts' },
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

const clean = (s: string) =>
  s
    .replace(/^(the|my|our|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export function matchIntent(raw: string): Intent | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  const t = text.toLowerCase();

  // Requests to change something (proposals): these carry their own details.
  const dollars = parseDollars(text);
  const recurring = PERIODS.some(([re]) => re.test(t));
  if (
    dollars !== undefined &&
    (/\b(i (pay|spend)|we (pay|spend)|add (a )?(budget|line)|costs? (me|us))\b|\bbudget for\b/.test(
      t
    ) ||
      (recurring && /\b(is|costs?)\s+\$/.test(t)))
  ) {
    const period = PERIODS.find(([re]) => re.test(t))?.[1] ?? 'm';
    const item =
      /\bfor\s+([a-z][\w' -]{1,40}?)(?=\s+(?:a|per|each|every)\s|[.,!?]|$)/i.exec(text)?.[1] ??
      /\bon\s+([a-z][\w' -]{1,40}?)(?=\s+(?:a|per|each|every)\s|[.,!?]|$)/i.exec(text)?.[1] ??
      /^(?:my\s+|our\s+)?([a-z][\w' -]{1,40}?)\s+(?:is|costs?)\s+\$/i.exec(text)?.[1];
    return { id: 'budget-line', item: clean(item ?? 'New budget line'), amount: dollars, period };
  }
  const old =
    /\b(?:my|our|the)\s+([a-z][\w -]{1,30}?)\s+is\s+(\d+(?:\.\d+)?)\s+years?\s+old\b/i.exec(text);
  if (old)
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
  if (buy && /\b(big purchases?|capex|replace|replacing|buy|buying|new)\b/i.test(t))
    return {
      id: 'asset',
      name: clean(buy[1]!),
      ...(dollars !== undefined ? { cost: dollars } : {}),
    };
  const cat =
    /\b(?:categori[sz]e|put|move|mark|file|label)\s+(?:all\s+)?(?:of\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:ones\s+|transactions\s+|purchases\s+|payments\s+)?(?:as|to|under|into|in)\s+(?:the\s+)?(.+?)(?:\s+category)?[.!?]*$/i.exec(
      text
    );
  if (cat) return { id: 'categorise', match: clean(cat[1]!), category: clean(cat[2]!) };

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
  if (/\b(what('s| is| are| does)|explain|meaning of|define|mean)\b/.test(t) && glossaryEntry(t))
    return { id: 'define', text: t };
  return null;
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
