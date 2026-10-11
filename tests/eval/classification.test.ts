/**
 * The §16.2 evaluation thresholds, run in CI (FR-CLS-005, FR-CLS-002).
 */
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../src/classify/eval.ts';
import { cdrInputs, ingest, PERSONAS, synth } from '../helpers/synth.ts';

async function run(persona: string, corrections: number) {
  const out = await synth(persona);
  const svc = await ingest(cdrInputs(out));
  return evaluate([...svc.current.txns.values()], out.truth.transactions, corrections);
}

describe('classification evaluation (§16.2)', () => {
  test('FR-CLS-005: default persona after 50 corrections: ≥ 95 % category, ≥ 98 % kind', async () => {
    const r = await run('default', 50);
    expect(r.categoryAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(r.kindAccuracy).toBeGreaterThanOrEqual(0.98);
  });

  test('CAPEX detection on high-capex-crypto after 50 corrections: precision and recall ≥ 0.9', async () => {
    const r = await run('high-capex-crypto', 50);
    expect(r.capex.tp).toBeGreaterThan(0);
    expect(r.capex.precision).toBeGreaterThanOrEqual(0.9);
    expect(r.capex.recall).toBeGreaterThanOrEqual(0.9);
  });

  test.each(PERSONAS)('%s: corrections only ever help, and stay within budget', async (persona) => {
    const before = await run(persona, 0);
    const after = await run(persona, 50);
    expect(after.corrections).toBeLessThanOrEqual(50);
    expect(after.categoryAccuracy).toBeGreaterThanOrEqual(before.categoryAccuracy);
    expect(after.kindAccuracy).toBeGreaterThanOrEqual(before.kindAccuracy);
  });
});
