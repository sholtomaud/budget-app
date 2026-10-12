# ADR 0022 — The Bayesian spending model and return-parameter uncertainty (M9)

- Status: accepted (implements ADR 0015, with the changes below)
- Date: 2026-10-12
- SPEC: §10.4 (FR-BAY-001…008), §10.3 (FR-FC-020), §19 (M9)
- Lab notes: [M9 lab notes](../reports/m9-bayesian-workflow-notes.md), with every experiment and
  its numbers

## Context

ADR 0015 proposed the Bayesian workflow for spending forecasts and return assumptions. The
simulator reads one thing from the spending forecast: the **total**, as a band of multipliers.
Before M9 that total added up independent per-category forecasts, so its band was too narrow.
Return assumptions were fixed points, so long horizons ignored the risk that the average itself is
wrong.

## Decision

### The spending model (`src/bayes/spending.ts`)

For category _c_ in month _t_, on months with spending:

```
log y_ct = μ_ct + s_c[month] + λ f_t + ε_ct      ε ~ N(0, σ²_c)
μ_ct     = μ_c,t−1 + η_ct                         η ~ N(0, τ²_c)     local level (drift)
f_t      = φ f_t−1 + √(1−φ²) ν_t                  ν ~ N(0, 1)        household factor
```

- **Zero months:** a hurdle π_c ~ Beta(1 + n₊, 1 + n₀) handles them, in categories that have any.
- **Seasonal effects:** used with at least 24 months of data. They sum to zero per category.
- **Partial pooling:** σ²_c and τ²_c each share a Gamma-distributed scale, and the seasonal
  effects share ω².
- **Fixed bills** (every month within 1 %) are left out of the model; their own flat forecast is
  added to the total.
- **The total** handed to the simulator is the model's paths for the fitted categories, plus the
  per-category forecasts of the rest.

### Inference, checked

Plain Gibbs did not converge on the synthetic households (worst R̂ 8.3). The sampler that does:

- **Collapsed Metropolis:**
  - σ²_c and τ²_c are updated on the Kalman-filter likelihood, with the level integrated out.
  - The pooled scales are integrated out analytically.
  - Joint moves scale all σ² (and all τ²) at once.
  - λ and φ are updated on the Kalman likelihood of the per-month precision-weighted residual,
    with the factor integrated out.
- **Paths by forward-filtering backward-sampling (FFBS).** Seasonal effects are drawn exactly
  under the sum-to-zero constraint.
- **Kernels:** FFBS and the Kalman log-likelihood live in ml-core (ABI 3), with TypeScript twins
  and parity tests.
- **Runs:** 4 seeded chains of 1 000 warmup and 500 draws. If split-R̂ > 1.05 or the effective
  sample size is below 100, the fit runs once more at twice the length. If it still fails, the
  total falls back to the per-category forecasts, and the Forecast screen says so.

### Return-parameter uncertainty (`src/sim/returns.ts`)

Each simulated future first draws its return models' monthly log-return mean and sd from a
Normal–Inverse-Gamma posterior (reference prior):

- **Assumed (μ, σ)** count as 30 years of monthly evidence.
- **A bootstrap history** uses its own length; its months are kept and re-centred and re-scaled to
  the draw, which preserves volatility clustering.
- **Fixed-rate models** stay fixed.

It is on by default ("Allow for not knowing the true average return" on the Freedom screen), and
draws from a separate random stream so other draws are unchanged. Over 30 years it widens the
spread of outcomes by about √2.

### Checks, in the app and in CI

- **Forecast screen, "How sure is this?":**
  - the sampler checks;
  - how much categories move together;
  - holdout calibration (fit without the last 6 months; share of held-out category-months inside
    P10–P90 by randomised PIT);
  - prior sensitivity (next year's P90 with the priors power-scaled ×0.5 and ×2);
  - a prior predictive sense check (the month-to-month volatility of the total, against what the
    priors alone expect).

  The checks run after the forecast is drawn. The fit is cached in the worker, so the Freedom and
  Scenarios screens reuse it.

- **CI (`tests/eval/bayes.test.ts`):**
  - simulation-based calibration of λ, φ, σ and τ (100 replications, χ² over rank bins);
  - on 9 synthetic households: every fit converges, every prior predictive check passes, and the
    pooled holdout coverage is between 70 % and 95 %.
- **Unit tests:**
  - the Kalman likelihood equals the brute-force Gaussian density;
  - R̂ and ESS behave as expected on chains with known answers;
  - the sampler is deterministic.

## Changes from ADR 0015 and the draft SPEC

| Draft                                  | Built                                                                 | Why                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A loading λ_c per category             | One common loading λ                                                  | Per-category loadings let the factor absorb one noisy category's noise (a Heywood case); chains disagreed (R̂ 2–6). Not identifiable from one household. |
| Optional damped trend                  | Local level only                                                      | Not identifiable in 24–60 months; the level's drift covers slow change.                                                                                 |
| Seasonality as random walks            | Fixed seasonal effects, pooled, summing to zero                       | Two to five observations per calendar month cannot support moving seasonality.                                                                          |
| Gibbs with slice/Metropolis            | Collapsed Metropolis + FFBS (above)                                   | Plain Gibbs did not converge.                                                                                                                           |
| Joins the per-category candidates      | Supplies the total; category charts keep their backtest-chosen method | The total is where correlation matters; per-category backtests would need an MCMC fit per origin.                                                       |
| LOO-PIT                                | Leave-future-out holdout PIT                                          | The right check for time series.                                                                                                                        |
| An `/eval` page                        | The model panel on the Forecast screen, plus CI                       | The panel is where people see the forecast.                                                                                                             |
| Prior sensitivity of pSuccess          | Prior sensitivity of next year's spending (P90)                       | Re-running the simulation per prior setting is deferred.                                                                                                |
| Priors "from the synthetic population" | Weakly informative priors, revised once by the prior predictive check | See below.                                                                                                                                              |

**Prior revision.** The first priors (noise σ ≈ 0.3, factor loading ≈ 0.2) imagined households
whose total moved 32–36 % a month (median). The synthetic households move 13–23 %, at or below the
priors' 5th percentile. The priors are now σ ≈ 0.2 and loading ≈ 0.1. Observed volatility sits
near the prior median (22–25 %), inside its 5–95 % range for all twelve households checked.

## Consequences

- **Calibration:** on the synthetic households the bands are conservative. Pooled holdout
  coverage is 91 % for a nominal 80 %. Causes:
  - **Once-a-year charges.** A $4-a-month fee with a $133 annual charge inflates that category's
    noise. Heavy-tailed noise (Student-t) is the planned fix.
  - **Short training.** Holdout fits on 18 of 24 months have no seasonality.

  Conservative bands lower pSuccess slightly; the opposite error would overstate it.

- **The personas cannot test co-movement.** They have no shared factor and no drift, so they show
  that the model does not invent co-movement, not that it finds it. SBC covers recovery, because
  its data come from the model. A persona with a real household factor should be added to the
  generator.
- **Compute:** about 2 s per fit in the browser, once per data view (cached). The checks take a
  few seconds more, after the forecast appears. The random-number generator now runs on 32-bit
  halves instead of BigInt. It is bit-identical, and makes every simulation faster too.
