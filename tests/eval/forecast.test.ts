/** The §16.2 forecasting thresholds, run in CI. */
import { describe, expect, test } from 'vitest';
import { evaluateOpex, evaluateReplacement, withTruth } from '../../src/forecast/eval.ts';
import { cdrInputs, ingest, loadPersona, PERSONAS, synth } from '../helpers/synth.ts';

describe('forecast evaluation (§16.2)', () => {
  test('OPEX: the chosen method beats or matches seasonal naive out of sample on ≥ 80 % of categories', async () => {
    let ok = 0;
    let n = 0;
    // Pooled over personas and seeds: a single persona has only 8–11 series, too few to judge a share.
    for (const seed of ['42', '1', '2', '3', '4']) {
      for (const p of PERSONAS) {
        const out = await synth(p, seed);
        const svc = await ingest(cdrInputs(out));
        const r = evaluateOpex(withTruth([...svc.current.txns.values()], out.truth.transactions), {
          holdout: 6,
          seed: 42n,
        });
        ok += r.atLeastAsGood;
        n += r.categories;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(ok / n).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  test('replacement dates: the P10–P90 interval covers the true date for 75–90 % of assets', async () => {
    const truths = [];
    for (let s = 1; s <= 30; s++)
      for (const p of PERSONAS)
        truths.push({ truth: (await synth(p, String(s), 24)).truth, start: loadPersona(p).start });
    const r = evaluateReplacement(truths);
    expect(r.assets).toBeGreaterThan(200);
    expect(r.coverage).toBeGreaterThanOrEqual(0.75);
    expect(r.coverage).toBeLessThanOrEqual(0.9);
  }, 60_000);
});
