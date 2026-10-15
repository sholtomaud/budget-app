/**
 * Schedules in the vault, and the runner (ADR 0041). While the app is open
 * it checks every minute; a schedule that fell due runs once, by asking the
 * chat its question (labelled as scheduled) or showing its reminder. Missed
 * times while the app was closed run once on opening. AI calls happen only
 * when the person allowed schedules to call the AI on their own.
 */
import { askChat } from './chat-ask.ts';
import { activeProvider } from './egress.ts';
import { sim } from './workers.ts';
import { ACTION_INFO, isDue, type Schedule } from '../sched/schedule.ts';

export interface ScheduleState {
  list: Schedule[];
  /** Schedules may call the AI on their own (off by default). */
  allowAI: boolean;
  /** Show a system notification when a schedule runs while the app is in the background. */
  notify: boolean;
}

export const SCHEDULES_CHANGED = 'app:schedules-changed';
const EMPTY: ScheduleState = { list: [], allowAI: false, notify: false };

export async function loadSchedules(): Promise<ScheduleState> {
  return { ...EMPTY, ...((await sim().loadKv('schedules')) as ScheduleState | null) };
}

export async function saveSchedules(s: ScheduleState): Promise<void> {
  await sim().saveKv('schedules', s);
  window.dispatchEvent(new CustomEvent(SCHEDULES_CHANGED));
}

/** Add a schedule or replace the one with its id; returns how to undo it. */
export async function putSchedule(x: Schedule): Promise<() => Promise<void>> {
  const before = await loadSchedules();
  const has = before.list.some((s) => s.id === x.id);
  await saveSchedules({
    ...before,
    list: has ? before.list.map((s) => (s.id === x.id ? x : s)) : [...before.list, x],
  });
  return () => saveSchedules(before);
}

export async function removeSchedule(id: string): Promise<() => Promise<void>> {
  const before = await loadSchedules();
  await saveSchedules({ ...before, list: before.list.filter((s) => s.id !== id) });
  return () => saveSchedules(before);
}

const record = async (id: string, result: string, at = new Date()) => {
  const s = await loadSchedules();
  await saveSchedules({
    ...s,
    list: s.list.map((x) =>
      x.id === id ? { ...x, lastRun: at.toISOString(), lastResult: result } : x
    ),
  });
};

/**
 * Run one schedule now. Resolves with what happened, in words; a busy chat
 * leaves it due, to run on the next tick.
 */
export async function runSchedule(s: Schedule, state: ScheduleState): Promise<string> {
  const info = ACTION_INFO[s.action];
  if (info.ai) {
    if (!state.allowAI) {
      const why = 'Skipped: schedules may not call the AI on their own (turn it on in Schedules).';
      await record(s.id, why);
      return why;
    }
    const ap = await activeProvider();
    if (!ap.ok) {
      const why = `Skipped: ${ap.reason}`;
      await record(s.id, why);
      return why;
    }
  }
  const ok = await new Promise<boolean>((resolve) =>
    askChat({
      question: s.action === 'reminder' ? (s.note ?? s.name) : info.question,
      label: s.name,
      note: s.action === 'reminder',
      standing: info.ai && state.allowAI,
      accepted: resolve,
    })
  );
  if (!ok) return 'Waiting: the chat is busy; it runs when the chat is free.';
  const done = s.action === 'reminder' ? 'Reminded you in the chat.' : 'Ran in the chat.';
  await record(s.id, done);
  if (
    state.notify &&
    document.hidden &&
    'Notification' in window &&
    Notification.permission === 'granted'
  )
    new Notification(`Crux · ${s.name}`, {
      body: s.action === 'reminder' ? (s.note ?? '') : `${info.label}: open Crux to see it.`,
    });
  return done;
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/** One check: the first due schedule runs (the chat answers one thing at a time). */
export async function tick(now = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const state = await loadSchedules();
    const due = state.list.filter((s) => isDue(s, now));
    if (due[0]) await runSchedule(due[0], state);
  } catch {
    // Locked or still loading: try again next minute.
  } finally {
    ticking = false;
  }
}

/** Start checking: soon after the app opens (to catch up), then every minute. */
export function startScheduler(): void {
  if (timer) return;
  setTimeout(() => void tick(), 5000);
  timer = setInterval(() => void tick(), 60_000);
}
