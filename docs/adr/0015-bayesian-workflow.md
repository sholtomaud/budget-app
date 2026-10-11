# ADR 0015 — Bayesian workflow for forecasting and return assumptions

- Status: proposed (milestone M9, after the advisor milestone M8)
- Date: 2026-10-11
- SPEC: §10.4 (FR-BAY-001…008), §16.2, §19 (M9)
- Reference: A. Gelman, A. Vehtari et al., _Bayesian Workflow_
  (<https://avehtari.github.io/Bayesian-Workflow/>)

## Context

The forecasts feed every simulated future, so their honesty bounds the honesty of pSuccess.
Today's forecasting falls short in four ways:

- Each category is fitted once by least squares (ETS or Croston, ADR 0011). Its bands come from a
  residual bootstrap. That ignores parameter uncertainty, which matters with 24–60 months of
  history.
- Categories are treated as independent, so total spending is under-dispersed. The Forecast screen
  says so.
- Return assumptions are point values (μ, σ). Over a 40-year horizon, estimation risk in μ is often
  the dominant risk.
- The backtests check accuracy (MASE) and interval coverage, but not calibration of the whole
  predictive distribution.

## Decision

Adopt the Bayesian workflow (build, check, compare, iterate), where it improves calibration:

1. **Bayesian structural time series per category** (FR-BAY-001): local level, optional damped
   trend, and seasonality as random walks, with observation noise on log spending. Intermittent
   categories use a hurdle model: a zero/non-zero process times amount.
2. **Partial pooling** (FR-BAY-002):
   - Hyper-priors shared across a household's categories, and weakly informative priors set from
     the synthetic personas' population.
   - Short series borrow strength instead of falling back to the budget line.
3. **A shared spending factor** (FR-BAY-003): one latent "household spending level" series loads on
   every category. Categories then move together (lifestyle creep, a tight month), and the total's
   spread is honest.
   - This is the useful part of structural equation modelling for one household.
   - A full SEM with several latent constructs is **not** adopted: 24–60 months from one household
     cannot identify it, so the priors would decide the answer. Revisit only with pooled data
     across many consenting households, which the privacy rules currently exclude.
4. **Return-parameter uncertainty** (FR-BAY-004): conjugate Normal–Inverse-Gamma posteriors for
   monthly log-return mean and variance, from the bootstrap history or user-imported history.
   Each Monte-Carlo run draws (μ, σ) first, so estimation risk widens the long-horizon tails.
5. **Inference in ml-core** (ADR 0007: no Stan, no third-party runtime):
   - Gibbs sampling with forward-filtering backward-sampling for the linear-Gaussian state-space
     parts, slice or Metropolis steps for the hyper-parameters, and conjugate updates for returns.
   - Each kernel has a TypeScript twin and a parity test, and is seeded (NFR-DET-001).
   - A small NUTS sampler is a later option if a model needs it.
6. **Checks as product features and CI gates** (FR-BAY-005…008):
   - Prior predictive checks: does simulated spending look like a household's before seeing the
     data? Shown on `/eval` and in the model panel.
   - Posterior predictive checks and LOO-PIT calibration on held-out months. CI gates PIT
     uniformity and the P10–P90 coverage of the pooled synthetic series.
   - Simulation-based calibration of every sampler in CI: recover known parameters from synthetic
     data.
   - Convergence diagnostics (split-R̂, effective sample size) per fit. A fit that fails them falls
     back to the ADR 0011 forecaster, and the label says so.
   - Prior sensitivity of pSuccess (power-scaling the priors) reported as a shortfall driver
     ("model assumptions").
7. **Selection:** the Bayesian model joins the forecast candidates. Choice is by backtest score
   **and** calibration. A Bayesian forecast is labelled `forecast`, and its run records its seed,
   prior set and diagnostics.

## Value

- Better-calibrated spending bands: usually wider for short histories, and correlated across
  categories.
- Honest return uncertainty.
- A way to _check_ the models, not only to fit them.

pSuccess will usually fall a little, and become trustworthy.

The optimiser and scenario comparisons (ADR 0013) gain nothing directly from Bayesian inference:
they already compare plans with common random numbers. They inherit the better inputs.

## Consequences

- Compute: a few seconds per household for 1 000 posterior draws across about 15 categories, in
  ml-core, in the forecast worker.
- Monte-Carlo runs sample a posterior draw per run instead of a fixed fit.
