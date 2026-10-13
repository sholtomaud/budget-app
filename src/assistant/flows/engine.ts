/**
 * Setup flows as small state machines (FR-SETUP-001, ADR 0027). A flow is
 * data: each state says something, offers buttons (or a file picker), or runs
 * an effect, and names the next state for each answer or outcome. Everything
 * here is pure: the app's runner (src/app/setup-runner.ts) shows the states
 * and carries out the effects through the same functions as the screens.
 */
import type { Schema } from '../../lib/jsonschema.ts';

export interface Choice {
  value: string;
  label: string;
}

/** Choices only known at run time (the sample households). */
export type DynamicChoices = 'personas';

/** What the runner does on entering a state; its outcome picks the next state. */
export type EffectId =
  | 'import-transactions'
  | 'preview-bank-csv'
  | 'commit-bank-csv'
  | 'load-sample'
  | 'preview-budget'
  | 'commit-budget'
  | 'plan-chance';

export type Section = 'data' | 'budget' | 'plan';

export interface FlowState {
  section: Section;
  /** Markdown, said on entering the state (before any effect runs). */
  say?: string;
  choices?: Choice[];
  dynamic?: DynamicChoices;
  /** Typed answers recognised without AI, tried in order. */
  phrases?: [value: string, pattern: RegExp][];
  /** A file picker; its outcome is `effect`'s. */
  files?: { label: string; accept: string; multiple: boolean };
  effect?: EffectId;
  /** Answer or outcome → next state. `*` matches any dynamic choice. */
  next: Record<string, string>;
  /** Screens offered as buttons. */
  links?: { label: string; path: string }[];
  /** Resume here instead after a reload (the state needs data held in memory). */
  resume?: string;
}

export interface Flow {
  start: string;
  states: Record<string, FlowState>;
}

/** A state needs an answer from the person (buttons, typing or files). */
export const awaitsAnswer = (s: FlowState) =>
  !s.effect || !!s.files || !!s.choices?.length || !!s.dynamic;

/** The state a value or outcome leads to, or null if the state doesn't accept it. */
export function nextState(flow: Flow, id: string, value: string, dynamic: readonly Choice[] = []) {
  const s = flow.states[id];
  if (!s) return null;
  const to = s.next[value] ?? (dynamic.some((c) => c.value === value) ? s.next['*'] : undefined);
  return to && flow.states[to] ? to : null;
}

/** The state to show after a reload. */
export function resumeAt(flow: Flow, id: string | null | undefined): string {
  const s = id ? flow.states[id] : undefined;
  if (!s) return flow.start;
  if (s.resume) return s.resume;
  // An effect without a question would run again unasked: go back to its section's start.
  if (!awaitsAnswer(s)) return sectionStart(flow, s.section);
  return id!;
}

export function sectionStart(flow: Flow, section: Section): string {
  return Object.keys(flow.states).find((k) => flow.states[k]!.section === section) ?? flow.start;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A typed answer, without AI: a button's label (or its value) typed out, or
 * one of the state's phrases. Null when nothing matches.
 */
export function interpret(s: FlowState, text: string, dynamic: readonly Choice[] = []) {
  const t = norm(text);
  if (!t) return null;
  const choices = [...(s.choices ?? []), ...dynamic];
  const exact = choices.find((c) => norm(c.label) === t || norm(c.value) === t);
  if (exact) return exact.value;
  for (const [value, re] of s.phrases ?? []) if (re.test(text)) return value;
  return null;
}

/** The structured-output schema for the AI's reading of a typed answer (FR-SETUP-003). */
export function answerSchema(s: FlowState, dynamic: readonly Choice[] = []): Schema {
  const values = [...(s.choices ?? []), ...dynamic].map((c) => c.value);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['choice'],
    properties: { choice: { type: 'string', enum: [...values, 'other'] } },
  };
}

/** Problems with a flow's wiring: unknown targets, unreachable states. Empty when sound. */
export function checkFlow(flow: Flow): string[] {
  const problems: string[] = [];
  if (!flow.states[flow.start]) problems.push(`start ${flow.start} is not a state`);
  for (const [id, s] of Object.entries(flow.states)) {
    for (const [k, to] of Object.entries(s.next))
      if (!flow.states[to]) problems.push(`${id}: ${k} → unknown ${to}`);
    if (s.resume && !flow.states[s.resume]) problems.push(`${id}: resume → unknown ${s.resume}`);
    for (const c of s.choices ?? [])
      if (!(c.value in s.next)) problems.push(`${id}: choice ${c.value} has no next state`);
    for (const [v] of s.phrases ?? [])
      if (!(s.choices ?? []).some((c) => c.value === v))
        problems.push(`${id}: phrase for ${v}, which is not a choice`);
    if (s.dynamic && !s.next['*']) problems.push(`${id}: dynamic choices have no * state`);
    if (s.effect && !Object.keys(s.next).length) problems.push(`${id}: effect with no outcomes`);
  }
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id) || !flow.states[id]) return;
    seen.add(id);
    const s = flow.states[id]!;
    for (const to of Object.values(s.next)) walk(to);
    if (s.resume) walk(s.resume);
  };
  walk(flow.start);
  for (const id of Object.keys(flow.states))
    if (!seen.has(id)) problems.push(`${id} is unreachable`);
  return problems;
}
