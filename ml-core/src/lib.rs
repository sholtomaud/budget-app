//! ml-core: numeric kernels for budget-app (SPEC §15.2).
//!
//! Exposed to JavaScript as plain `extern "C"` functions over `f64` buffers in
//! linear memory: no wasm-bindgen, no strings, no third-party crates (ADR 0007).
//! Each kernel mirrors a TypeScript reference in `src/forecast/ref/` and
//! `src/lib/prng.ts`; parity tests hold them within 1e-9 relative.

#![allow(clippy::missing_safety_doc, clippy::too_many_arguments)]

pub mod bayes;
pub mod cmaes;
pub mod kernels;
pub mod rng;

use std::alloc::{alloc, dealloc, Layout};
use std::slice;

/// Allocate `n` f64s (8-byte aligned). Returns 0 on failure.
#[no_mangle]
pub extern "C" fn mc_alloc(n: usize) -> *mut f64 {
    if n == 0 {
        return std::ptr::null_mut();
    }
    match Layout::array::<f64>(n) {
        Ok(layout) => unsafe { alloc(layout) as *mut f64 },
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn mc_free(ptr: *mut f64, n: usize) {
    if ptr.is_null() || n == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<f64>(n) {
        dealloc(ptr as *mut u8, layout);
    }
}

unsafe fn sl<'a>(p: *const f64, n: usize) -> &'a [f64] {
    if n == 0 {
        &[]
    } else {
        slice::from_raw_parts(p, n)
    }
}

unsafe fn sl_mut<'a>(p: *mut f64, n: usize) -> &'a mut [f64] {
    if n == 0 {
        &mut []
    } else {
        slice::from_raw_parts_mut(p, n)
    }
}

/// Kernel ABI version; bump when any signature changes.
#[no_mangle]
pub extern "C" fn mc_version() -> u32 {
    3
}

#[no_mangle]
pub unsafe extern "C" fn mc_quantile_sorted(p: *const f64, n: usize, q: f64) -> f64 {
    kernels::quantile_sorted(sl(p, n), q)
}

#[no_mangle]
pub unsafe extern "C" fn mc_mase(
    actual: *const f64,
    forecast: *const f64,
    n: usize,
    train: *const f64,
    tn: usize,
    m: usize,
) -> f64 {
    kernels::mase(sl(actual, n), sl(forecast, n), sl(train, tn), m)
}

#[no_mangle]
pub extern "C" fn mc_pinball(actual: f64, predicted: f64, q: f64) -> f64 {
    kernels::pinball(actual, predicted, q)
}

/// Holt–Winters run; writes `h` forecasts and `n` residuals, returns the SSE.
#[no_mangle]
pub unsafe extern "C" fn mc_ets_run(
    y: *const f64,
    n: usize,
    h: usize,
    m: usize,
    alpha: f64,
    beta: f64,
    gamma: f64,
    phi: f64,
    seasonal: u32,
    out_forecast: *mut f64,
    out_resid: *mut f64,
) -> f64 {
    kernels::ets_run(
        sl(y, n),
        h,
        m,
        alpha,
        beta,
        gamma,
        phi,
        seasonal != 0,
        sl_mut(out_forecast, h),
        sl_mut(out_resid, n),
    )
}

/// Croston-family run (variant 0 croston, 1 sba, 2 tsb); returns the SSE.
#[no_mangle]
pub unsafe extern "C" fn mc_croston_run(
    y: *const f64,
    n: usize,
    h: usize,
    alpha: f64,
    beta: f64,
    variant: u32,
    out_forecast: *mut f64,
    out_resid: *mut f64,
) -> f64 {
    kernels::croston_run(
        sl(y, n),
        h,
        alpha,
        beta,
        variant,
        sl_mut(out_forecast, h),
        sl_mut(out_resid, n),
    )
}

/// Residual bootstrap paths, run-major (`n_paths` × `h`), from a fresh SplitMix64 stream.
#[no_mangle]
pub unsafe extern "C" fn mc_bootstrap_paths(
    forecast: *const f64,
    h: usize,
    resid: *const f64,
    r: usize,
    n_paths: usize,
    seed: u64,
    out: *mut f64,
) {
    let mut rng = rng::SplitMix64::new(seed);
    kernels::bootstrap_paths(
        sl(forecast, h),
        sl(resid, r),
        n_paths,
        &mut rng,
        sl_mut(out, n_paths * h),
    );
}

/// Quantiles P5…P95 per step of run-major paths; writes 7 × h values (quantile-major).
#[no_mangle]
pub unsafe extern "C" fn mc_path_quantiles(
    paths: *const f64,
    n_paths: usize,
    h: usize,
    out: *mut f64,
) {
    kernels::path_quantiles(sl(paths, n_paths * h), n_paths, h, sl_mut(out, 7 * h));
}

/// `n` uniform floats in [0, 1) from SplitMix64.
#[no_mangle]
pub unsafe extern "C" fn mc_uniform(seed: u64, n: usize, out: *mut f64) {
    let mut rng = rng::SplitMix64::new(seed);
    for v in sl_mut(out, n) {
        *v = rng.float();
    }
}

/// `n` Weibull(k, scale) lifetimes conditional on survival to `age`.
#[no_mangle]
pub unsafe extern "C" fn mc_weibull_given(
    seed: u64,
    k: f64,
    scale: f64,
    age: f64,
    n: usize,
    out: *mut f64,
) {
    let mut rng = rng::SplitMix64::new(seed);
    for v in sl_mut(out, n) {
        *v = rng.weibull_given(k, scale, age);
    }
}

/// Length of a CMA-ES state vector for dimension `n` and population `lambda`.
#[no_mangle]
pub extern "C" fn mc_cmaes_state_size(n: usize, lambda: usize) -> usize {
    cmaes::state_size(n, lambda)
}

#[no_mangle]
pub unsafe extern "C" fn mc_cmaes_init(
    x0: *const f64,
    n: usize,
    sigma0: f64,
    lambda: usize,
    state: *mut f64,
) {
    cmaes::init(
        sl(x0, n),
        sigma0,
        lambda,
        sl_mut(state, cmaes::state_size(n, lambda)),
    );
}

#[no_mangle]
pub unsafe extern "C" fn mc_cmaes_ask(
    state: *const f64,
    n: usize,
    lambda: usize,
    z: *const f64,
    out: *mut f64,
) {
    cmaes::ask(
        sl(state, cmaes::state_size(n, lambda)),
        sl(z, lambda * n),
        sl_mut(out, lambda * n),
    );
}

#[no_mangle]
pub unsafe extern "C" fn mc_cmaes_tell(
    state: *mut f64,
    n: usize,
    lambda: usize,
    x: *const f64,
    f: *const f64,
) {
    cmaes::tell(
        sl_mut(state, cmaes::state_size(n, lambda)),
        sl(x, lambda * n),
        sl(f, lambda),
    );
}

/// One forward-filtering backward-sampling draw of a scalar state path (ADR 0022).
#[no_mangle]
pub unsafe extern "C" fn mc_ffbs(
    y: *const f64,
    v: *const f64,
    n: usize,
    phi: f64,
    w: f64,
    m0: f64,
    c0: f64,
    z: *const f64,
    out: *mut f64,
) {
    bayes::ffbs(sl(y, n), sl(v, n), phi, w, m0, c0, sl(z, n), sl_mut(out, n));
}

/// Kalman-filter log-likelihood of the same model, states integrated out (ADR 0022).
#[no_mangle]
pub unsafe extern "C" fn mc_kf_loglik(
    y: *const f64,
    v: *const f64,
    n: usize,
    phi: f64,
    w: f64,
    m0: f64,
    c0: f64,
) -> f64 {
    bayes::kf_loglik(sl(y, n), sl(v, n), phi, w, m0, c0)
}
