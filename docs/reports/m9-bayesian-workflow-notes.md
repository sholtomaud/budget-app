# M9 lab notes: building the Bayesian spending model

- Milestone: M9 Bayesian workflow (SPEC §10.4, FR-BAY-001…008; ADRs 0015 and 0022)
- Status: **complete.** Sections 1–5 were written mid-milestone; sections 4.6–4.8 and 6–8 at
  the end.
- Written: 2026-10-12

This is the working record: what was tried, what failed, why, and what was changed. The Bayesian
workflow is iterative by design (build, check, find the problem, revise), and most of what was
learned came from things that did not work.

## 1. Starting point

**How spending reaches the simulation.** The simulator does not read each category's forecast. It
reads one thing: the **total** monthly spending forecast, as a band of multipliers around the
median (P5…P95 per month), sampled once per simulated future. So the job of the Bayesian model, as
far as pSuccess is concerned, is to make that total honest.

**What was wrong with the M4 total.** Each category was forecast on its own (ETS or Croston, with a
residual bootstrap), and the paths were added as if independent. Independent errors cancel when
summed, so the total's band is too narrow. The Forecast screen already said "categories are
assumed independent".

**The data.** The synthetic personas have 24 months of history, with 8–11 modelled categories
each. They are stationary: seasonality and noise, no drift, and **no shared household factor**.
That matters for what can be checked (§7).

## 2. The model as first written

For category _c_ in month _t_, on months with spending:

```
log y_ct = μ_ct + s_c[month] + λ_c f_t + ε_ct      ε ~ N(0, σ²_c)
μ_ct     = μ_c,t−1 + η_ct                           η ~ N(0, τ²_c)       local level (drift)
f_t      = φ f_t−1 + √(1−φ²) ν_t                    ν ~ N(0, 1)          household factor
```

- Zero months come from a hurdle, π_c ~ Beta(1 + n₊, 1 + n₀), used only in categories that have
  zero months.
- **Partial pooling:**
  - σ²_c ~ IG(3, b_σ) and τ²_c ~ IG(3, b_τ), with shared Gamma hyper-priors on b_σ and b_τ;
  - seasonal effects ~ N(0, ω²), with ω² shared.
- **Sampler:** plain Gibbs.
  - Forward-filtering backward-sampling (FFBS) for the level paths and the factor.
  - Conjugate draws for everything else.
  - Random-walk Metropolis for φ.
  - 4 chains, 500 warmup and 250 kept draws each.
- **New kernel:** FFBS, written in TypeScript and in Rust (ml-core ABI 3), with unit tests in Rust.

## 3. Experiment log

Each fit: three personas, seed 42, 24 training months, 12 held out. Coverage is the share of
held-out category-months inside the 80 % (P10–P90) interval; **target 0.80**. Thresholds for using
a fit: split-R̂ ≤ 1.05 and effective sample size (ESS) ≥ 100 on every tracked parameter.

| #   | Change                                                                 | Worst R̂ (renter / default / crypto) | Min ESS             | Coverage           | Time per fit |
| --- | ---------------------------------------------------------------------- | ----------------------------------- | ------------------- | ------------------ | ------------ |
| 1   | Plain Gibbs (as above)                                                 | 8.31 / 5.61 / 1.52                  | 4 / 4 / 7           | 0.80 / 0.83 / 0.89 | ~0.9 s       |
| 2   | Variances by Metropolis on the Kalman likelihood (collapsed)           | 2.44 / 13.5 / 2.50                  | 5 / 4 / 5           | 0.80 / 0.88 / 0.89 | ~1.0 s       |
| 3   | + pooled scales b_σ, b_τ integrated out; variance floors; 3 MH repeats | 6.04 / 1.88 / 5.46                  | 4 / 6 / 4           | n/a                | ~1.1 s       |
| 4   | + **one common loading λ** instead of λ_c per category                 | 1.19 / 1.14 / 1.22                  | 15 / 25 / 15        | n/a                | ~1.0 s       |
| 5   | + joint scaling moves for all σ² and all τ²                            | 1.42 / **1.03** / 1.04              | 10 / 123 / 77       | n/a                | ~1.1 s       |
| 6   | + λ and φ by Metropolis with the factor integrated out                 | 1.05 / 1.02 / 1.05                  | 46 / 110 / 74       | n/a                | ~1.1 s       |
| 7   | Same, 1 000 warmup + 500 draws per chain                               | 1.06 / 1.02 / 1.03                  | 56 / 244 / 173      | n/a                | ~1.5–2.6 s   |
| 8   | Same, 2 000 warmup + 1 000 draws per chain                             | **1.008 / 1.009 / 1.014**           | **176 / 397 / 342** | n/a                | ~3.6–4.8 s   |

Times are the TypeScript kernels under Vitest; ml-core is not yet timed (§8).

**Takeaway:** coverage was about right from the start: the bands were calibrated even while the
sampler was not converged. That is the trap the diagnostics exist to catch. A badly mixed sampler
can produce plausible-looking bands by luck, and they would not be reproducible or trustworthy.
Coverage was not re-measured after run 2 because the model changed (run 4); it is re-measured by
the calibration gate (§6).

## 4. Problems found, and what fixed them

### 4.1 Drift variances stuck (run 1): latent path and its variance

**Symptom.** Every τ_c had ESS ≈ 5, and R̂ was far above 1 on several σ_c.

**Cause.** The classic stickiness of Gibbs on a local-level model. Given the level path, τ² is
tightly determined; given τ², the path is tightly determined; so each step moves both very little.

**Fix (run 2).** Update σ²_c and τ²_c by Metropolis on the **Kalman-filter likelihood**, with the
level integrated out (a collapsed sampler), then draw the level path by FFBS. This needed a second
kernel, the Kalman log-likelihood, in TypeScript and Rust. It helped less than expected on its own,
because a second problem was hiding behind the first.

### 4.2 All variances drifting together (runs 2–3): the hierarchical funnel

**Symptom.** After 4.1, the τ_c across categories moved up and down together, all with ESS ≈ 5–6.

**Cause.** The shared scale b_τ and the variances form a funnel. When the data say little about
drift (these synthetic series have none), every τ_c follows b_τ, and b_τ follows them, so they
crawl together.

**Fix.**

- **Integrate b_σ and b_τ out analytically.** Gamma–inverse-gamma is conjugate, and the variances'
  joint prior is Π x_c^−(a+1) · (h + Σ 1/x_c)^−(C·a + g), used directly in the Metropolis ratio.
- **Variance floors:** σ² ≥ 10⁻⁴ (1 % month-to-month noise) and τ² ≥ 10⁻⁶ (0.1 % drift a month).
  Bills that never change (internet $30 every month) otherwise drove their variances towards zero
  without limit, and chains disagreed by orders of magnitude.
- **Joint scaling moves (run 5):** propose multiplying every σ² (then every τ²) by one common
  factor. This moves the group as a whole, which one-at-a-time updates cannot do quickly.

### 4.3 A model problem, not a sampler problem (run 3): the Heywood case

**Symptom.** With per-category loadings λ_c, groceries, rideshare and electricity showed R̂ of 2–6
on σ_c and λ_c together.

**Cause.** The household factor could absorb **one noisy category's own noise**: λ_c grows, f_t
copies that category's residuals, and σ_c drops to the floor. The data cannot tell this apart from
"noisy category, no factor", so chains split between the two modes. In factor analysis this is
called a Heywood case. With 24–60 months from one household, per-category loadings are not
identifiable.

**Fix (run 4).** **One common loading λ:** a tight or loose household month moves every category
by the same percentage. This is the Bayesian workflow working as intended: a computational failure
pointed at a model that asked more of the data than the data can answer. It matches what
FR-BAY-003 asks for (a shared household spending level) and what ADR 0015 already said about full
SEM: not identifiable from one household.

### 4.4 The factor's loading and persistence (runs 5–6)

**Symptom.** λ and φ mixed slowly (R̂ up to 1.42). On the synthetic data λ is near zero, so the
factor path is barely identified, and λ, φ and the path are strongly coupled.

**Fix.** Per month, the categories' residuals combine into one precision-weighted average
ē_t = λ f_t + noise. That average is sufficient for λ, φ and f. So λ and φ are updated by Metropolis
on the Kalman likelihood of ē, with the factor integrated out, and the factor path is drawn after.
The same Kalman kernel serves both.

### 4.5 Seasonal effects and the level

**Problem (caught in review, before any run).** The first version centred the seasonal effects
after each draw and pushed their mean into the level. That move does not leave the posterior
invariant: it changes the prior density of both blocks. Results would be subtly wrong, in a way no
diagnostic flags.

**Fix.** Draw the seasonal effects exactly under the sum-to-zero constraint: an unconstrained
Gaussian draw, then conditioned on the constraint
(s_k −= v_k · Σs / Σv, exact for Gaussians). The ω² update counts 11 free effects per category.

### 4.6 The priors were too loose: the prior predictive check (after the model panel)

**Symptom.** The new model panel's sense check went red on the first sample household. Its
total moves about 15 % from month to month; before seeing the data, the model expected 17–75 %.

**Measured.** Across nine households (three personas × three seeds), the priors' median was
32–36 %; the observed values were 13–22 %, several below the priors' 5th percentile.

**What drives it.** Varying one prior at a time:

| Noise σ prior (mean) | Factor loading prior (sd) | Drift τ prior (mean) | Prior predictive median |
| -------------------- | ------------------------- | -------------------- | ----------------------- |
| 0.30 (original)      | 0.20                      | 0.04                 | 32–36 %                 |
| 0.20                 | 0.20                      | 0.04                 | 26–29 %                 |
| 0.11                 | 0.20                      | 0.04                 | 21–23 %                 |
| 0.20                 | 0.08                      | 0.04                 | 21–25 %                 |
| 0.20                 | 0.08                      | 0.02                 | 21–25 %                 |

Noise and the household factor both matter; drift hardly does at this horizon.

**Fix.** σ ≈ 0.2 and loading ≈ 0.1. The fitted noise levels seen so far (rent 0.09, café 0.13,
groceries 0.36, fuel 0.63) sit comfortably around 0.2. The prior predictive median is now 22–25 %,
and the observed 13–23 % is inside the 5–95 % range on all twelve households checked.

The check also now holds each category at its observed size, because jittering sizes (the level
prior) let small, volatile categories dominate the imagined totals. It is a check of the priors on
how spending moves, not on how big each category is.

### 4.7 Holdout coverage: a measurement error, then two real causes

**Symptom.** Holdout coverage was 83–96 % against a nominal 80 %.

**Measurement error.** In a category with zero months, the forecast's P10 is $0, so every actual
$0 month counted as "inside". The check now uses the **randomised PIT** (ties spread uniformly)
and counts PIT ∈ [0.1, 0.9]. The numbers barely moved, so the bands really were wide.

**Diagnosis by category** (default persona, 36 months, 6 held out):

| Category              | Fitted σ | Data sd | Held-out PITs | Reading                                                             |
| --------------------- | -------- | ------- | ------------- | ------------------------------------------------------------------- |
| comms.mobile          | 0.031    | 0.000   | 0.47–0.53     | A fixed bill: always dead centre                                    |
| health.insurance      | 0.031    | 0.000   | 0.47–0.52     | A fixed bill: always dead centre                                    |
| fees.bank             | 0.978    | 1.069   | 0.34–0.38     | $4 a month plus $133 once a year: noise inflated to cover the spike |
| food.groceries        | 0.363    | 0.402   | 0.39–0.66     | Fine                                                                |
| utilities.electricity | 0.224    | 0.302   | 0.10–0.92     | Fine                                                                |

**Fixes.**

- **Fixed bills** (every month within 1 %) leave the model; their flat forecast is added to the
  total.
- **Once-a-year charges** are a known limitation. Heavy-tailed (Student-t) noise is the planned
  fix.
- **Short training windows:** with 24 months, holdout fits train on 18, so they have no
  seasonality. With 36 months coverage still came out at 81–96 %, so this is a smaller cause.

**Result.** Pooled coverage is 91.4 % over 360 held-out category-months. The bands are
conservative; the CI gate requires 70–95 %.

### 4.8 Speed

| Stage                                                            | Main fit (10 categories)      | Forecast e2e | Freedom e2e |
| ---------------------------------------------------------------- | ----------------------------- | ------------ | ----------- |
| Before M9                                                        | n/a                           | ~2 s         | ~6 s        |
| First M9 build                                                   | 2.45 s (TS), 2.37 s (ml-core) | 12 s         | 12 s        |
| SplitMix64 on 32-bit halves, no BigInt                           | 1.7–1.9 s                     | n/a          | n/a         |
| No allocation in the mix; both Box–Muller outputs in the sampler | 2.0 s under the profiler      | n/a          | n/a         |
| Fit cached in the worker; checks after the forecast is drawn     | n/a                           | 6 s          | 8 s         |

- **WebAssembly was not the bottleneck.** 600 000 Kalman calls cost 156 ms; the random-number
  generator, which used BigInt per draw, was.
- **The generator rewrite is bit-identical.** The synthetic-data snapshots, the ml-core parity
  tests and the golden simulation all pass unchanged. It also speeds up every simulation: the
  Scenarios e2e went from 11 s to 9 s.
- **Using both Box–Muller outputs** changes only the Bayesian sampler's own stream, which was new
  in this milestone.

## 5. Decisions

| Decision                                                                                                                                    | Why                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One household factor with **one common loading**                                                                                            | Per-category loadings are not identifiable from one household (Heywood cases, §4.3).                                            |
| Variances and λ, φ updated **collapsed** (Kalman likelihood), paths by FFBS                                                                 | Plain Gibbs did not mix (§4.1, 4.4).                                                                                            |
| Pooled scales **integrated out**, plus joint scaling moves                                                                                  | The funnel (§4.2).                                                                                                              |
| Variance **floors** (1 % noise, 0.1 % drift a month)                                                                                        | Fixed bills otherwise collapse the variances. The prior draws for checks are truncated the same way.                            |
| Fit at 1 000 + 500 draws; if diagnostics fail, refit once at 2 000 + 1 000; if it still fails, **fall back** to the M4 forecasts and say so | Run 7 passed on two of three personas; run 8 on all three. Bounded compute, honest fallback.                                    |
| Thresholds R̂ ≤ 1.05, ESS ≥ 100                                                                                                              | Practical for an interactive app. Vehtari et al. recommend R̂ < 1.01 and ESS > 400 for final inference; run 8 nearly meets that. |
| The Bayesian model supplies the **total** (what pSuccess uses); category charts keep their backtest-chosen method                           | The total is where correlation matters. Choosing per category by backtest would need an MCMC fit per backtest origin.           |
| Seasonal effects only with ≥ 24 months                                                                                                      | Fewer gives one observation per calendar month.                                                                                 |
| Holdout check (fit without the last 6 months), not LOO-PIT                                                                                  | Leave-future-out is the right check for time series; PSIS-LOO is not.                                                           |

## 6. Checks in CI (final numbers)

- **Kernel parity:** FFBS and the Kalman log-likelihood, TypeScript vs ml-core, within 1e-9 on
  60 random cases with missing months.
- **Correctness:** the Kalman log-likelihood equals the brute-force multivariate Gaussian density
  (10 decimal places).
- **Diagnostics:**
  - R̂ < 1.01 and ESS ≈ N on independent chains;
  - ESS within 20 % of N(1−ρ)/(1+ρ) on AR(1) chains;
  - R̂ > 1.1 when one chain is shifted.
- **Simulation-based calibration** (100 replications, ranks in 10 bins, χ² limit 27.88 at
  α = 0.001):

  | Parameter | χ²   |
  | --------- | ---- |
  | λ         | 16.6 |
  | φ         | 10.4 |
  | σ         | 9.0  |
  | τ         | 10.6 |

- **Personas** (9 households):
  - every fit converges (worst R̂ 1.007–1.027);
  - every prior predictive check passes;
  - pooled holdout coverage 91.4 % (gate 70–95 %).
- **Return-parameter uncertainty:**
  - the posterior draw's spread matches theory (sd of the mean ≈ s/√n; E[σ²] = s²(n−1)/(n−3));
  - over 30 years the spread of outcomes grows by 1.3–1.6× (theory: about √2);
  - bootstrap months are preserved exactly.
- **Browser:** the Forecast e2e test checks the model panel and saves a screenshot of it.

## 7. Limits of what the synthetic data can show

- The personas have **no shared factor and no drift**. They can show the model does not invent co-movement
  (λ stays near 0: posterior medians 0.02–0.08) and stays calibrated. They cannot show that it finds
  co-movement when it exists. SBC covers that, because its data come from the model. A persona with a
  real household factor (e.g. a "tight year") would make a better test and should be added to the
  generator.
- 24 months is the bottom of the range ADR 0015 assumed (24–60).

## 8. Open items

- **Once-a-year charges inflate a category's noise** (§4.7). Planned fix: Student-t observation
  noise (a scale mixture, which the Kalman machinery supports with per-month variances).
- **A persona with a real household factor and drift**, so CI can show the model finds
  co-movement, not only that it doesn't invent it.
- **Prior sensitivity of pSuccess:** the panel shows it for next year's spending; re-running the
  simulation per prior setting is deferred.
- **Exact parity risk:** Metropolis decisions use logarithms, whose last bits may differ between
  JavaScript and Rust. A decision could, very rarely, flip between the two kernels and send a
  chain elsewhere. Parity is tested per kernel, not per whole fit; the TypeScript and ml-core fits
  agreed on every run measured.
