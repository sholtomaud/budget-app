/**
 * Schedules (ADR 0041): things Crux does on its own at set times, while it is
 * open. Pure: when a schedule is next due, whether it is due now, and what
 * it says in words. A schedule never changes data; it asks the chat a
 * question, and any change is a card the person applies.
 */

export const ACTIONS = ['budget-review', 'plan-run', 'spending', 'ai-review', 'reminder'] as const;
export type Action = (typeof ACTIONS)[number];
export const EVERY = ['day', 'week', 'month'] as const;
export type Every = (typeof EVERY)[number];

export interface Schedule {
  id: string;
  name: string;
  action: Action;
  every: Every;
  /** Local time, 'HH:MM'. */
  at: string;
  /** 0 = Sunday … 6 = Saturday (every week). */
  weekday?: number;
  /** 1–28 (every month), so every month has it. */
  monthday?: number;
  /** A reminder's words. */
  note?: string;
  enabled: boolean;
  createdBy: 'you' | 'ai';
  createdAt: string;
  lastRun?: string;
  /** What happened last time, in words. */
  lastResult?: string;
}

/** What each action does: the question asked in the chat, and whether it needs the AI. */
export const ACTION_INFO: Record<Action, { label: string; question: string; ai: boolean }> = {
  'budget-review': { label: 'Review my budget', question: 'Review my budget', ai: false },
  'plan-run': { label: 'Run my plan', question: 'Run my plan', ai: false },
  spending: { label: 'Where my money goes', question: 'Where does my money go?', ai: false },
  'ai-review': {
    label: 'A review by the AI',
    question:
      'Give me my weekly money review: what changed in my spending, budget and plan since last week, and what to look at.',
    ai: true,
  },
  reminder: { label: 'A reminder', question: '', ai: false },
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Problems with a schedule, in words, or null. */
export function checkSchedule(s: Partial<Schedule>): string | null {
  if (!s.name?.trim()) return 'Give it a name.';
  if (!s.action || !ACTIONS.includes(s.action)) return 'Choose what it does.';
  if (!s.every || !EVERY.includes(s.every)) return 'Choose how often.';
  if (!s.at || !TIME.test(s.at)) return 'Give a time like 08:00.';
  if (s.every === 'week' && !(Number.isInteger(s.weekday) && s.weekday! >= 0 && s.weekday! <= 6))
    return 'Choose a day of the week.';
  if (
    s.every === 'month' &&
    !(Number.isInteger(s.monthday) && s.monthday! >= 1 && s.monthday! <= 28)
  )
    return 'Choose a day of the month from 1 to 28.';
  if (s.action === 'reminder' && !s.note?.trim()) return 'Say what to remind you of.';
  return null;
}

/** The first time the schedule falls due strictly after `after` (local time). */
export function nextRun(s: Schedule, after: Date): Date {
  const [h, m] = s.at.split(':').map(Number) as [number, number];
  const at = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
  if (s.every === 'day') {
    const t = at(after);
    return t > after ? t : at(new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1));
  }
  if (s.every === 'week') {
    const want = s.weekday ?? 1;
    for (let i = 0; i <= 7; i++) {
      const t = at(new Date(after.getFullYear(), after.getMonth(), after.getDate() + i));
      if (t.getDay() === want && t > after) return t;
    }
  }
  const day = s.monthday ?? 1;
  for (let i = 0; i <= 1; i++) {
    const t = new Date(after.getFullYear(), after.getMonth() + i, day, h, m, 0, 0);
    if (t > after) return t;
  }
  return new Date(after.getFullYear(), after.getMonth() + 2, day, h, m, 0, 0);
}

/**
 * Due now: it fell due since it last ran (or since it was made). Times missed
 * while the app was closed run once, not once for each.
 */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  return nextRun(s, new Date(s.lastRun ?? s.createdAt)) <= now;
}

/** "Every Monday at 08:00", in words. */
export function whenText(s: Schedule): string {
  if (s.every === 'day') return `Every day at ${s.at}`;
  if (s.every === 'week') return `Every ${WEEKDAYS[s.weekday ?? 1]} at ${s.at}`;
  const d = s.monthday ?? 1;
  const nth =
    d === 1 || d === 21 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
  return `Every month on the ${d}${nth} at ${s.at}`;
}

/** Ready-made schedules people often want. */
export const PRESETS: Omit<Schedule, 'id' | 'createdAt' | 'createdBy'>[] = [
  {
    name: 'Morning budget check',
    action: 'budget-review',
    every: 'day',
    at: '08:00',
    enabled: true,
  },
  {
    name: 'Weekly plan run',
    action: 'plan-run',
    every: 'week',
    weekday: 1,
    at: '08:00',
    enabled: true,
  },
  {
    name: 'Weekly AI review',
    action: 'ai-review',
    every: 'week',
    weekday: 0,
    at: '18:00',
    enabled: true,
  },
  {
    name: 'Import new transactions',
    action: 'reminder',
    every: 'month',
    monthday: 1,
    at: '09:00',
    note: 'Export last month from your bank and import it on the Import screen.',
    enabled: true,
  },
];
