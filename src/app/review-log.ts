/**
 * The budget review's log (ADR 0038): every applied change, so the next
 * reviews hold a category just changed. Kept in the vault.
 */
import type { BudgetLine } from '../budget/model.ts';
import type { ReviewLogEntry } from '../budget/review.ts';
import { deleteLine, upsertLine } from './data.ts';
import { sim } from './workers.ts';

export async function loadReviewLog(): Promise<ReviewLogEntry[]> {
  return ((await sim().loadKv('budget-review')) as ReviewLogEntry[] | null) ?? [];
}

const saveReviewLog = (log: ReviewLogEntry[]) => sim().saveKv('budget-review', log.slice(-200));

/** One change to a category's lines, logged; undo puts the lines and the log back. */
export async function applyBudgetChange(
  after: readonly BudgetLine[],
  before: readonly BudgetLine[],
  entries: readonly ReviewLogEntry[]
): Promise<() => Promise<void>> {
  for (const l of after) await upsertLine(l);
  const log = await loadReviewLog();
  await saveReviewLog([...log, ...entries]);
  return async () => {
    const ids = new Set(before.map((l) => l.id));
    for (const l of after) if (!ids.has(l.id)) await deleteLine(l.id);
    for (const l of before) await upsertLine(l);
    await saveReviewLog(log);
  };
}
