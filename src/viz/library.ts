/**
 * The built-in charts (ADR 0036): specs anyone can put on a dashboard. A
 * dashboard refers to them by id, so they improve with the app.
 */
import { SPENDING_BY_GROUP } from './requests.ts';
import type { ChartSpec } from './spec.ts';

export interface LibraryChart {
  id: string;
  spec: ChartSpec;
}

export const LIBRARY: readonly LibraryChart[] = [
  {
    id: 'spending-vs-budget',
    spec: {
      kind: 'line',
      title: 'Spending against the budget, by month',
      groupBy: 'month',
      series: [
        { label: 'Spending', dataset: 'spending', filter: { lastMonths: 12 } },
        { label: 'Budget', dataset: 'budget', filter: { lastMonths: 12 } },
      ],
    },
  },
  { id: 'spending-by-group', spec: SPENDING_BY_GROUP },
  {
    id: 'income-vs-spending',
    spec: {
      kind: 'bar',
      title: 'Income and spending, by quarter',
      groupBy: 'quarter',
      series: [
        { label: 'Income', dataset: 'income' },
        { label: 'Spending', dataset: 'spending' },
      ],
    },
  },
  {
    id: 'top-merchants',
    spec: {
      kind: 'bar',
      title: 'Where the money goes: top merchants, last 12 months',
      groupBy: 'merchant',
      series: [{ label: 'Spending', dataset: 'spending', filter: { lastMonths: 12 } }],
    },
  },
  {
    id: 'big-purchases-by-year',
    spec: {
      kind: 'bar',
      title: 'Big purchases coming up, by year',
      groupBy: 'year',
      series: [{ label: 'Big purchases', dataset: 'big-purchases' }],
    },
  },
  {
    id: 'savings-over-time',
    spec: {
      kind: 'fan',
      title: "Your savings in your plan, in today's dollars",
      groupBy: 'year',
      series: [{ label: 'Savings', dataset: 'capital' }],
    },
  },
];

export const libraryChart = (id: string) => LIBRARY.find((c) => c.id === id);
