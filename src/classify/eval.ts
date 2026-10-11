/**
 * Classification evaluation against synthetic ground truth (SPEC §16.2,
 * FR-CLS-005). A simulated user makes N corrections the way a person would:
 * work through the review queue largest merchant group first, then, once the
 * queue is empty, fix the most common remaining mistake. Each correction is
 * remembered for its merchant ("apply to similar").
 */
import type { ClassificationKind, Txn } from '../domain/types.ts';
import { txnKey } from '../ingest/ids.ts';
import type { TruthLabel } from '../synth/generator.ts';
import { merchantKey } from './normalise.ts';
import { Classifier, MemoryStateStore } from './service.ts';

export interface EvalResult {
  corrections: number;
  n: number;
  kindAccuracy: number;
  categoryAccuracy: number;
  /** truth kind → predicted kind → count */
  confusion: Record<string, Record<string, number>>;
  capex: { tp: number; fp: number; fn: number; precision: number; recall: number };
  byStage: Record<string, number>;
  reviewQueue: number;
}

const truthOf = (truth: Record<string, TruthLabel>, t: Txn) => truth[`${t.accountId}/${t.id}`];

export async function evaluate(
  txns: Txn[],
  truth: Record<string, TruthLabel>,
  corrections = 50
): Promise<EvalResult> {
  const clf = new Classifier(new MemoryStateStore());
  const live = txns.filter((t) => !t.supersededBy);
  let made = 0;
  while (made < corrections) {
    clf.apply(txns);
    const queue = clf.reviewQueue(txns);
    let pick: Txn | undefined;
    if (queue.length) {
      const groups = new Map<string, Txn[]>();
      for (const k of queue) {
        const t = live.find((x) => txnKey(x.accountId, x.id) === k)!;
        const g = `${t.amount < 0n ? '-' : '+'}${merchantKey(t)}`;
        groups.set(g, [...(groups.get(g) ?? []), t]);
      }
      const largest = [...groups.entries()].sort(
        (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)
      )[0]!;
      pick = largest[1][0];
    } else {
      const wrong = new Map<string, Txn[]>();
      for (const t of live) {
        const tr = truthOf(truth, t);
        if (
          !tr ||
          t.classification?.categoryId === tr.categoryId ||
          clf.isUserLabelled(txnKey(t.accountId, t.id))
        )
          continue;
        const g = `${t.amount < 0n ? '-' : '+'}${merchantKey(t)}`;
        wrong.set(g, [...(wrong.get(g) ?? []), t]);
      }
      const largest = [...wrong.entries()].sort(
        (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)
      )[0];
      if (!largest) break;
      pick = largest[1][0];
    }
    if (!pick) break;
    const tr = truthOf(truth, pick);
    if (!tr) break;
    await clf.correct(txns, [txnKey(pick.accountId, pick.id)], tr.categoryId, true);
    made++;
  }
  const result = clf.apply(txns);

  const confusion: Record<string, Record<string, number>> = {};
  const byStage: Record<string, number> = {};
  let kindOk = 0;
  let catOk = 0;
  let n = 0;
  const capex = { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 };
  for (const t of live) {
    const tr = truthOf(truth, t);
    const c = t.classification;
    if (!tr || !c) continue;
    n++;
    const kind: ClassificationKind = c.kind;
    confusion[tr.kind] ??= {};
    confusion[tr.kind]![kind] = (confusion[tr.kind]![kind] ?? 0) + 1;
    byStage[c.by] = (byStage[c.by] ?? 0) + 1;
    if (kind === tr.kind) kindOk++;
    if (c.categoryId === tr.categoryId) catOk++;
    if (t.amount < 0n) {
      const predicted = kind === 'capex';
      const actual = tr.kind === 'capex';
      if (predicted && actual) capex.tp++;
      else if (predicted) capex.fp++;
      else if (actual) capex.fn++;
    }
  }
  capex.precision = capex.tp + capex.fp ? capex.tp / (capex.tp + capex.fp) : 1;
  capex.recall = capex.tp + capex.fn ? capex.tp / (capex.tp + capex.fn) : 1;
  return {
    corrections: made,
    n,
    kindAccuracy: kindOk / n,
    categoryAccuracy: catOk / n,
    confusion,
    capex,
    byStage,
    reviewQueue: clf.reviewQueue(txns).length + 0 * result.capexProposals.length,
  };
}
