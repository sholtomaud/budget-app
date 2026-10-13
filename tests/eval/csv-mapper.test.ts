/**
 * The FR-ING-016 gate for transaction CSVs (ADR 0030): ≥ 95 % column accuracy
 * on held-out synthetic layouts, half of whose headers training never saw.
 */
import { describe, expect, test } from 'vitest';
import { DIM, tableFeatures } from '../../src/ingest/csv/features.ts';
import { synthLayouts } from '../../src/ingest/csv/layouts.ts';
import { assignFields, baseMapperModel, TRAIN_SEED } from '../../src/ingest/csv/mapper.ts';
import { predict, train } from '../../src/ingest/csv/model.ts';
import { FIELDS } from '../../src/ingest/csv/read.ts';

function accuracy(seed: string, count: number, heldOut: boolean) {
  const model = baseMapperModel();
  let right = 0;
  let total = 0;
  for (const l of synthLayouts(seed, count, heldOut)) {
    const got = assignFields(tableFeatures(l.rows, l.headerRow).map((x) => predict(model, x)));
    l.truth.forEach((f, j) => {
      total++;
      if (got[j]!.field === f) right++;
    });
  }
  return right / total;
}

describe('CSV column mapper evaluation (FR-ING-016)', () => {
  test('≥ 95 % column accuracy on held-out layouts', () => {
    expect(accuracy('csv-mapper-eval-v1', 300, true)).toBeGreaterThanOrEqual(0.95);
  });

  test('≥ 95 % on fresh layouts with familiar headers', () => {
    expect(accuracy('csv-mapper-fresh-v1', 200, false)).toBeGreaterThanOrEqual(0.95);
  });

  test('training is deterministic (NFR-DET-001)', () => {
    const samples = synthLayouts(TRAIN_SEED, 20).flatMap((l) => {
      const xs = tableFeatures(l.rows, l.headerRow);
      return l.truth.map((f, j) => ({ x: xs[j]!, y: FIELDS.indexOf(f) }));
    });
    const o = { epochs: 3, rate: 0.3, l2: 1e-5, seed: 'det' };
    expect(train(samples, FIELDS.length, DIM, o).w).toEqual(
      train(samples, FIELDS.length, DIM, o).w
    );
  });
});
