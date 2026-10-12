/**
 * The chat panel's activity log (ADR 0024): what happens behind a reply, as it
 * happens. Crux's own steps ("Running your plan in 500 simulated futures") and
 * the AI's words stream into the panel as separate bubbles, so a person can
 * always see what ran on their device and what was sent where.
 */
export type Activity =
  /** A step Crux takes on this device, or a request it sends. Same id: an update. */
  | { kind: 'crux'; id: string; text: string; state: 'running' | 'done' | 'error' }
  /** Words from the AI as they arrive. `note`: a progress note between tool calls. */
  | { kind: 'ai'; id: string; provider: string; text: string; note?: boolean }
  /** The AI finished that piece of text (more steps may follow). */
  | { kind: 'ai-end'; id: string }
  /** A simulation ran: its id becomes a footnote when the AI cites it. */
  | { kind: 'run'; runId: string };

export type ActivitySink = (a: Activity) => void;

let next = 0;
export const activityId = (prefix: string) => `${prefix}-${++next}`;

/** Seconds, for "Ran 500 simulated futures · 0.8 s". */
export const elapsed = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)} s`;

/** Size of what was sent, in words: "3.2 kB". */
export const kb = (bytes: number) =>
  bytes < 1000 ? `${bytes} bytes` : `${(bytes / 1000).toFixed(1)} kB`;

/** Run `work` as one Crux step: shown running, then done with how long it took. */
export async function step<T>(
  sink: ActivitySink | undefined,
  running: string,
  done: string | ((r: T) => string),
  work: (update: (text: string) => void) => Promise<T>
): Promise<T> {
  const id = activityId('step');
  const t0 = performance.now();
  sink?.({ kind: 'crux', id, text: running, state: 'running' });
  try {
    const r = await work((text) => sink?.({ kind: 'crux', id, text, state: 'running' }));
    const label = typeof done === 'function' ? done(r) : done;
    sink?.({ kind: 'crux', id, text: `${label} · ${elapsed(t0)}`, state: 'done' });
    return r;
  } catch (err) {
    sink?.({
      kind: 'crux',
      id,
      text: err instanceof Error ? err.message : String(err),
      state: 'error',
    });
    throw err;
  }
}
