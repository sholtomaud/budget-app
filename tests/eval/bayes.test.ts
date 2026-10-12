/**
 * The Bayesian workflow's CI gates (FR-BAY-006…008, ADR 0022):
 * simulation-based calibration of the sampler, and calibration on the
 * committed synthetic personas.
 */
import { describe, expect, test } from 'vitest';
import { bayesChecks, bayesTotal } from '../../src/bayes/forecast.ts';
import { chiSquareUniform } from '../../src/bayes/diagnostics.ts';
import { drawFromPrior, fitSpending } from '../../src/bayes/spending.ts';
import { withTruth } from '../../src/forecast/eval.ts';
import { monthlySeries } from '../../src/forecast/series.ts';
import { deriveSeed, Rng } from '../../src/lib/prng.ts';
import { cdrInputs, ingest, PERSONAS, synth } from '../helpers/synth.ts';

/** χ² with 9 degrees of freedom at α = 0.001. */
const CHI2_9_999 = 27.88;

describe('simulation-based calibration (FR-BAY-008)', () => {
  test('the sampler recovers λ, φ, σ and τ: ranks of the truth are uniform', () => {
    const reps = 100;
    const levelMean = [7.5, 6.5, 5.5];
    const C = levelMean.length;
    const bins = {
      λ: new Array(10).fill(0),
      φ: new Array(10).fill(0),
      σ: new Array(10).fill(0),
      τ: new Array(10).fill(0),
    };
    for (let r = 0; r < reps; r++) {
      const seed = deriveSeed(2026n, 'sbc', r);
      // Data from the model's own prior...
      const truth = drawFromPrior({ months: 24, firstMonth: 0, levelMean }, new Rng(seed));
      const data = { categories: ['a', 'b', 'c'], firstMonth: 0, values: truth.values };
      // ...fitted with the same prior.
      const post = fitSpending(data, {
        seed: deriveSeed(seed, 'fit'),
        chains: 4,
        warmup: 400,
        draws: 250,
        levelMean,
      });
      // 100 draws spread over the chains, thinned so they are close to independent.
      const kept = Array.from({ length: 100 }, (_, k) => k * 10);
      const rank = (draw: (d: number) => number, t: number) =>
        kept.filter((d) => draw(d) < t).length;
      const bin = (x: number) => Math.min(9, Math.floor((x * 10) / 101));
      bins.λ[bin(rank((d) => post.lambda[d]!, truth.lambda))]++;
      bins.φ[bin(rank((d) => post.phi[d]!, truth.phi))]++;
      bins.σ[bin(rank((d) => post.sigma2[d * C]!, truth.sigma2[0]!))]++;
      bins.τ[bin(rank((d) => post.tau2[d * C]!, truth.tau2[0]!))]++;
    }
    // Printed to the CI log, so each run records the statistics, not just a pass.
    process.stderr.write(
      `\nSBC χ² (9 df, limit ${CHI2_9_999}): ${Object.entries(bins)
        .map(([k, c]) => `${k} ${chiSquareUniform(c).toFixed(1)}`)
        .join(', ')}\n`
    );
    for (const [name, counts] of Object.entries(bins))
      expect(chiSquareUniform(counts), `${name}: ${counts.join(' ')}`).toBeLessThan(CHI2_9_999);
  }, 300_000);
});

describe('calibration on the synthetic personas (FR-BAY-006, 007)', () => {
  test('fits converge, held-out months are covered 70–95 %, the priors pass the sense check', async () => {
    const pits: number[] = [];
    const rows: string[] = [];
    for (const seed of ['42', '1', '2']) {
      for (const p of PERSONAS) {
        const out = await synth(p, seed);
        const svc = await ingest(cdrInputs(out));
        const history = monthlySeries(
          withTruth([...svc.current.txns.values()], out.truth.transactions)
        );
        const { report } = bayesTotal(history, new Map(), { horizon: 12, nPaths: 1000, seed: 42n });
        expect(report.used, `${p}/${seed}: ${report.reason}`).toBe(true);
        const c = bayesChecks(history, 42n)!;
        pits.push(...c.holdout!.pits);
        const pp = c.priorPredictive!;
        rows.push(
          `${p}/${seed}: R̂ ${report.diagnostics!.rhatMax.toFixed(3)}, holdout ${(c.holdout!.coverage * 100).toFixed(0)} %, volatility ${(pp.observed * 100).toFixed(0)} % in prior ${(pp.p5 * 100).toFixed(0)}–${(pp.p95 * 100).toFixed(0)} %`
        );
        expect(pp.observed, `${p}/${seed} prior predictive`).toBeGreaterThanOrEqual(pp.p5);
        expect(pp.observed, `${p}/${seed} prior predictive`).toBeLessThanOrEqual(pp.p95);
      }
    }
    const coverage = pits.filter((u) => u >= 0.1 && u <= 0.9).length / pits.length;
    process.stderr.write(
      `\n${rows.join('\n')}\nPooled P10–P90 coverage ${(coverage * 100).toFixed(1)} % over ${pits.length} held-out category-months\n`
    );
    // Not overconfident (≥ 70 %), and not uselessly wide (≤ 95 %). The model
    // is conservative on these personas (once-a-year fees, 18 training
    // months without seasonality): see the M9 lab notes.
    expect(coverage, rows.join('\n')).toBeGreaterThanOrEqual(0.7);
    expect(coverage, rows.join('\n')).toBeLessThanOrEqual(0.95);
  }, 600_000);
});
