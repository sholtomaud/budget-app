/** Setup flows as state machines (FR-SETUP-001…003, ADR 0027). */
import { describe, expect, test } from 'vitest';
import {
  answerSchema,
  awaitsAnswer,
  checkFlow,
  interpret,
  nextState,
  resumeAt,
  type Flow,
} from '../../src/assistant/flows/engine.ts';
import { SETUP } from '../../src/assistant/flows/setup.ts';
import { validate } from '../../src/lib/jsonschema.ts';

const s = (id: string) => SETUP.states[id]!;

describe('the setup flow', () => {
  test('is wired soundly: every target exists and every state is reachable', () => {
    expect(checkFlow(SETUP)).toEqual([]);
  });

  test('every step can be finished with buttons alone (FR-SETUP-002)', () => {
    // From every state that waits for an answer, some button leads on, and
    // following buttons and effect outcomes reaches the end.
    const end = 'plan.done';
    const reaches = new Map<string, boolean>();
    const can = (id: string, seen = new Set<string>()): boolean => {
      if (id === end) return true;
      if (reaches.has(id)) return reaches.get(id)!;
      if (seen.has(id)) return false;
      seen.add(id);
      const st = s(id);
      const outs = [
        ...(st.choices ?? []).map((c) => st.next[c.value]),
        ...(st.dynamic ? [st.next['*']] : []),
        ...(st.effect ? Object.values(st.next) : []),
      ].filter((x): x is string => !!x);
      const ok = outs.some((to) => can(to, seen));
      reaches.set(id, ok);
      return ok;
    };
    for (const id of Object.keys(SETUP.states)) expect(can(id), id).toBe(true);
  });

  test('a sample household, no budget, then the plan', () => {
    let id = SETUP.start;
    id = nextState(SETUP, id, 'sample')!;
    expect(id).toBe('data.sample');
    expect(nextState(SETUP, id, 'not-a-persona')).toBeNull();
    id = nextState(SETUP, id, 'default', [{ value: 'default', label: 'Renting' }])!;
    expect(id).toBe('data.sample-load');
    id = nextState(SETUP, id, 'done')!;
    id = nextState(SETUP, id, 'skip')!;
    expect(id).toBe('plan.run');
    expect(nextState(SETUP, id, 'done')).toBe('plan.done');
  });

  test('FR-SETUP-004: bank and accounting CSVs are mapped, previewed, then imported', () => {
    expect(nextState(SETUP, SETUP.start, 'bank-csv')).toBe('data.bank-csv');
    expect(nextState(SETUP, SETUP.start, 'accounting')).toBe('data.accounting');
    expect(nextState(SETUP, 'data.csvs', 'bank')).toBe('data.bank-csv');
    expect(nextState(SETUP, 'data.csvs', 'budget')).toBe('budget.file');
    for (const id of ['data.bank-csv', 'data.accounting']) {
      expect(s(id).effect).toBe('preview-bank-csv');
      expect(s(id).files?.accept).toContain('.csv');
      expect(nextState(SETUP, id, 'ready')).toBe('data.bank-confirm');
      expect(nextState(SETUP, id, 'failed')).toBe('data.bank-failed');
    }
    expect(nextState(SETUP, 'data.bank-confirm', 'import')).toBe('data.bank-commit');
    expect(nextState(SETUP, 'data.bank-confirm', 'check')).toBe('data.bank-check');
    expect(s('data.bank-confirm').resume).toBe('data.bank-csv');
    expect(nextState(SETUP, 'data.bank-commit', 'done')).toBe('budget.start');
    expect(s('data.bank-failed').choices!.map((c) => c.value)).toContain('sample');
  });
});

describe('typed answers, without AI', () => {
  const start = s('data.start');

  test('a button’s words, typed', () => {
    expect(interpret(start, 'try a sample household')).toBe('sample');
    expect(interpret(start, '  Nothing yet! ')).toBe('none');
  });

  test('known phrases, in order', () => {
    expect(interpret(start, 'I have a MYOB export')).toBe('accounting');
    expect(interpret(start, 'my Xero file as CSV')).toBe('accounting');
    expect(interpret(start, 'a few CSVs')).toBe('csvs');
    expect(interpret(start, 'a csv from my bank')).toBe('bank-csv');
    expect(interpret(start, 'my Excel spreadsheet')).toBe('spreadsheet');
    expect(interpret(start, 'show me a demo')).toBe('sample');
    expect(interpret(start, 'no')).toBe('none');
  });

  test('anything else is left for the AI or a question', () => {
    expect(interpret(start, 'what is a freedom number?')).toBeNull();
    expect(interpret(start, '')).toBeNull();
  });

  test('dynamic choices by label', () => {
    const personas = [{ value: 'frugal-renter', label: 'Frugal renter' }];
    expect(interpret(s('data.sample'), 'frugal renter', personas)).toBe('frugal-renter');
  });
});

describe('the AI’s reading is a structured output (FR-SETUP-003)', () => {
  test('the schema allows only this step’s choices, or other', () => {
    const schema = answerSchema(s('data.csvs'));
    expect(validate(schema, { choice: 'bank' })).toBeNull();
    expect(validate(schema, { choice: 'other' })).toBeNull();
    expect(validate(schema, { choice: 'sample' })).not.toBeNull();
    expect(validate(schema, { choice: 'bank', extra: 1 })).not.toBeNull();
    expect(validate(schema, {})).not.toBeNull();
  });
});

describe('resuming after a reload (FR-SETUP-005)', () => {
  test('a question is asked again; an effect is not rerun unasked', () => {
    expect(resumeAt(SETUP, 'budget.start')).toBe('budget.start');
    expect(resumeAt(SETUP, 'budget.file')).toBe('budget.file');
    // Previewed files were in memory only.
    expect(resumeAt(SETUP, 'budget.confirm')).toBe('budget.start');
    expect(resumeAt(SETUP, 'data.sample')).toBe('data.start');
    expect(resumeAt(SETUP, 'data.sample-load')).toBe('data.start');
    expect(resumeAt(SETUP, 'no-such-state')).toBe(SETUP.start);
    expect(resumeAt(SETUP, null)).toBe(SETUP.start);
  });

  test('only states that wait for an answer are saved', () => {
    expect(awaitsAnswer(s('data.start'))).toBe(true);
    expect(awaitsAnswer(s('data.cdr'))).toBe(true);
    expect(awaitsAnswer(s('plan.run'))).toBe(false);
    expect(awaitsAnswer(s('plan.done'))).toBe(true);
  });
});

describe('checkFlow finds wiring mistakes', () => {
  test('unknown targets, missing next states, unreachable states', () => {
    const bad: Flow = {
      start: 'a',
      states: {
        a: {
          section: 'data',
          choices: [
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ],
          phrases: [['z', /z/]],
          next: { x: 'b', w: 'nowhere' },
        },
        b: { section: 'data', next: {} },
        c: { section: 'plan', dynamic: 'personas', next: {} },
      },
    };
    expect(checkFlow(bad)).toEqual([
      'a: w → unknown nowhere',
      'a: choice y has no next state',
      'a: phrase for z, which is not a choice',
      'c: dynamic choices have no * state',
      'c is unreachable',
    ]);
  });
});
