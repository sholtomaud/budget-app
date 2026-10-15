/** Schedules: when they fall due, catching up once, and checks in words (ADR 0041). */
import { describe, expect, test } from 'vitest';
import {
  checkSchedule,
  isDue,
  nextRun,
  PRESETS,
  whenText,
  type Schedule,
} from '../../src/sched/schedule.ts';

const make = (s: Partial<Schedule>): Schedule => ({
  id: 's1',
  name: 'Test',
  action: 'budget-review',
  every: 'day',
  at: '08:00',
  enabled: true,
  createdBy: 'you',
  createdAt: new Date(2026, 9, 12, 12, 0).toISOString(), // Mon 12 Oct 2026, noon
  ...s,
});
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe('when a schedule is next due (local time)', () => {
  test('every day: later today, or tomorrow', () => {
    const s = make({});
    expect(nextRun(s, local(14, 7, 59))).toEqual(local(14, 8));
    expect(nextRun(s, local(14, 8))).toEqual(local(15, 8));
  });

  test('every week on a weekday', () => {
    const s = make({ every: 'week', weekday: 0, at: '18:00' }); // Sundays
    expect(nextRun(s, local(14, 9))).toEqual(local(18, 18)); // Wed 14 → Sun 18
    expect(nextRun(s, local(18, 18))).toEqual(local(25, 18));
  });

  test('every month on a day', () => {
    const s = make({ every: 'month', monthday: 1, at: '09:00' });
    expect(nextRun(s, local(14, 9))).toEqual(new Date(2026, 10, 1, 9));
    expect(nextRun(s, new Date(2026, 11, 31, 23))).toEqual(new Date(2027, 0, 1, 9));
  });
});

describe('due now, and catching up', () => {
  test('due once it has passed since it last ran; paused never', () => {
    const s = make({ lastRun: local(14, 8, 1).toISOString() });
    expect(isDue(s, local(15, 7))).toBe(false);
    expect(isDue(s, local(15, 8))).toBe(true);
    expect(isDue({ ...s, enabled: false }, local(20, 8))).toBe(false);
  });

  test('days missed while closed run once: after it runs, it waits for the next time', () => {
    const s = make({ lastRun: local(10, 8).toISOString() });
    const now = local(14, 12);
    expect(isDue(s, now)).toBe(true);
    expect(isDue({ ...s, lastRun: now.toISOString() }, now)).toBe(false);
  });

  test('a new schedule waits for its first time', () => {
    expect(isDue(make({}), local(12, 13))).toBe(false); // made at noon, due at 8 tomorrow
    expect(isDue(make({}), local(13, 8))).toBe(true);
  });
});

describe('checked and said in words', () => {
  test('problems, in words', () => {
    expect(checkSchedule(make({ name: ' ' }))).toBe('Give it a name.');
    expect(checkSchedule(make({ at: '8am' }))).toBe('Give a time like 08:00.');
    expect(checkSchedule(make({ every: 'week', weekday: 9 }))).toBe('Choose a day of the week.');
    expect(checkSchedule(make({ every: 'month', monthday: 31 }))).toContain('1 to 28');
    expect(checkSchedule(make({ action: 'reminder' }))).toBe('Say what to remind you of.');
    expect(checkSchedule(make({}))).toBeNull();
  });

  test('when, in words; presets are all valid', () => {
    expect(whenText(make({}))).toBe('Every day at 08:00');
    expect(whenText(make({ every: 'week', weekday: 1 }))).toBe('Every Monday at 08:00');
    expect(whenText(make({ every: 'month', monthday: 2 }))).toBe('Every month on the 2nd at 08:00');
    for (const p of PRESETS) expect(checkSchedule(p), p.name).toBeNull();
  });
});

describe('the AI can schedule, but not allow itself the AI', () => {
  test('tools to list and propose; the switch is the person’s', async () => {
    const { ADVISOR_TOOLS, ADVISOR_SYSTEM } = await import('../../src/advisor/tools.ts');
    const names = ADVISOR_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_schedules', 'propose_schedule']));
    const p = ADVISOR_TOOLS.find((t) => t.name === 'propose_schedule')!;
    expect(p.description).toContain('You cannot turn on the AI switch');
    expect(JSON.stringify(p.input_schema)).not.toContain('allowAI');
    expect(ADVISOR_SYSTEM).toContain('propose_schedule');
  });
});
