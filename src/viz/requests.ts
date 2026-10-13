/**
 * Built-in charts (FR-VIZ-004, ADR 0028): a chart asked for in words, as a
 * spec. Pure: the words are matched in src/assistant/intents.ts.
 */
import type { ChartRequest } from '../assistant/intents.ts';
import type { Category } from '../classify/categories.ts';
import { isTime, type ChartSpec, type SeriesFilter } from './spec.ts';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The categories a topic names: by name or id, a group taking its categories with it. */
export function topicCategories(topic: string, categories: readonly Category[]): string[] {
  const t = norm(topic).replace(/s$/, '');
  if (!t) return [];
  const hits = categories.filter((c) => {
    const n = norm(c.name).replace(/s$/, '');
    const id = norm(c.id.split('.').pop() ?? c.id).replace(/s$/, '');
    return n === t || id === t || n.split(' ').includes(t);
  });
  return [...new Set(hits.map((c) => c.id))];
}

const GROUP_WORDS: Record<ChartRequest['groupBy'], string> = {
  month: 'by month',
  quarter: 'by quarter',
  year: 'by year',
  category: 'by category',
  group: 'by group',
  merchant: 'by merchant',
  item: 'by item',
};

export function specFromRequest(r: ChartRequest, categories: readonly Category[]): ChartSpec {
  if (r.dataset === 'big-purchases')
    return {
      kind: 'bar',
      title: `Big purchases coming up ${GROUP_WORDS[r.groupBy]}`,
      caption:
        "When each big purchase falls due, in today's dollars, from the Big purchases screen.",
      groupBy: r.groupBy,
      series: [
        {
          label: 'Big purchases',
          dataset: 'big-purchases',
          ...(r.months ? { filter: { nextMonths: r.months } } : {}),
        },
      ],
    };
  const cats = r.topic ? topicCategories(r.topic, categories) : [];
  const filter: SeriesFilter = {
    ...(cats.length ? { categories: cats } : r.topic ? { text: r.topic.slice(0, 40) } : {}),
    ...(r.months ? { lastMonths: r.months } : {}),
  };
  const has = Object.keys(filter).length > 0;
  const what = r.dataset === 'income' ? 'Income' : 'Spending';
  const topic = r.topic ? ` on ${r.topic}` : '';
  const series: ChartSpec['series'] = [
    { label: what, dataset: r.dataset, ...(has ? { filter } : {}) },
  ];
  if (r.vsBudget && r.dataset === 'spending') {
    const b: SeriesFilter = {
      ...(cats.length ? { categories: cats } : {}),
      ...(r.months ? { lastMonths: r.months } : {}),
    };
    series.push({
      label: 'Budget',
      dataset: 'budget',
      ...(Object.keys(b).length ? { filter: b } : {}),
    });
  }
  return {
    kind: isTime(r.groupBy) ? 'line' : 'bar',
    title:
      `${what}${topic} ${GROUP_WORDS[r.groupBy]}${r.vsBudget ? ', against the budget' : ''}`.slice(
        0,
        80
      ),
    groupBy: r.groupBy,
    series,
    ...(r.topic && !cats.length
      ? {
          caption: `No category is called “${r.topic}”, so this shows transactions that mention it.`,
        }
      : {}),
  };
}

/** The "Where does my money go?" chart: the last 12 months by group. */
export const SPENDING_BY_GROUP: ChartSpec = {
  kind: 'bar',
  title: 'Spending by group, last 12 months',
  groupBy: 'group',
  series: [{ label: 'Spending', dataset: 'spending', filter: { lastMonths: 12 } }],
};
