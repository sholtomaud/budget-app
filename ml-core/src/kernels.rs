//! The kernels, mirroring the TypeScript reference implementations line for line.

use crate::rng::SplitMix64;

pub const QUANTILES: [f64; 7] = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

pub fn quantile_sorted(sorted: &[f64], q: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return f64::NAN;
    }
    let h = (n - 1) as f64 * q;
    let lo = h.floor() as usize;
    let hi = (lo + 1).min(n - 1);
    sorted[lo] + (h - lo as f64) * (sorted[hi] - sorted[lo])
}

pub fn mase(actual: &[f64], forecast: &[f64], train: &[f64], m: usize) -> f64 {
    let mut num = 0.0;
    for i in 0..actual.len() {
        num += (actual[i] - forecast[i]).abs();
    }
    num /= actual.len() as f64;
    let lag = if train.len() > m { m } else { 1 };
    let mut den = 0.0;
    let mut k = 0usize;
    for i in lag..train.len() {
        den += (train[i] - train[i - lag]).abs();
        k += 1;
    }
    den = if k > 0 { den / k as f64 } else { 0.0 };
    if den == 0.0 {
        return if num == 0.0 { 0.0 } else { f64::INFINITY };
    }
    num / den
}

pub fn pinball(actual: f64, predicted: f64, q: f64) -> f64 {
    let d = actual - predicted;
    if d >= 0.0 {
        q * d
    } else {
        (q - 1.0) * d
    }
}

pub fn ets_run(
    y: &[f64],
    h: usize,
    m: usize,
    alpha: f64,
    beta: f64,
    gamma: f64,
    phi: f64,
    seasonal: bool,
    forecast: &mut [f64],
    residuals: &mut [f64],
) -> f64 {
    let n = y.len();
    let mut level: f64;
    let mut trend: f64;
    let mut season = vec![0.0f64; if seasonal { m } else { 1 }];
    if seasonal {
        let mut a = 0.0;
        let mut b = 0.0;
        for i in 0..m {
            a += y[i];
            b += y[i + m];
        }
        a /= m as f64;
        b /= m as f64;
        trend = (b - a) / m as f64;
        let centre = (m as f64 - 1.0) / 2.0;
        let line = |t: f64| a + trend * (t - centre);
        for i in 0..m {
            season[i] = (y[i] - line(i as f64) + (y[i + m] - line((i + m) as f64))) / 2.0;
        }
        level = line(-1.0);
    } else {
        level = y[0];
        trend = if n > 1 { y[1] - y[0] } else { 0.0 };
    }
    let mut sse = 0.0;
    for t in 0..n {
        let s = if seasonal { season[t % m] } else { 0.0 };
        let fitted = level + phi * trend + s;
        let e = y[t] - fitted;
        residuals[t] = e;
        sse += e * e;
        let prev = level;
        level = prev + phi * trend + alpha * e;
        trend = phi * trend + beta * e;
        if seasonal {
            season[t % m] = s + gamma * e;
        }
    }
    let mut damp = 0.0;
    for i in 0..h {
        damp += phi.powi(i as i32 + 1);
        forecast[i] = level + damp * trend + if seasonal { season[(n + i) % m] } else { 0.0 };
    }
    sse
}

/// variant: 0 croston, 1 sba, 2 tsb.
pub fn croston_run(
    y: &[f64],
    _h: usize,
    alpha: f64,
    beta: f64,
    variant: u32,
    forecast: &mut [f64],
    residuals: &mut [f64],
) -> f64 {
    let n = y.len();
    let first = y.iter().position(|&v| v != 0.0);
    let Some(first) = first else {
        for v in forecast.iter_mut() {
            *v = 0.0;
        }
        for v in residuals.iter_mut() {
            *v = 0.0;
        }
        return 0.0;
    };
    let tsb = variant == 2;
    let mut z = y[first];
    let mut p = if tsb {
        1.0 / (first as f64 + 1.0)
    } else {
        first as f64 + 1.0
    };
    let mut q = 1.0;
    let pred = |z: f64, p: f64| -> f64 {
        if tsb {
            p * z
        } else {
            (if variant == 1 { 1.0 - alpha / 2.0 } else { 1.0 }) * (z / p)
        }
    };
    let mut sse = 0.0;
    for t in 0..n {
        let f = if t <= first { 0.0 } else { pred(z, p) };
        let e = y[t] - f;
        residuals[t] = e;
        if t > first {
            sse += e * e;
        }
        if t <= first {
            continue;
        }
        if tsb {
            if y[t] != 0.0 {
                z += alpha * (y[t] - z);
                p += beta * (1.0 - p);
            } else {
                p += beta * (0.0 - p);
            }
        } else if y[t] != 0.0 {
            z += alpha * (y[t] - z);
            p += alpha * (q - p);
            q = 1.0;
        } else {
            q += 1.0;
        }
    }
    let f = pred(z, p);
    for v in forecast.iter_mut() {
        *v = f;
    }
    sse
}

pub fn bootstrap_paths(
    forecast: &[f64],
    resid: &[f64],
    n_paths: usize,
    rng: &mut SplitMix64,
    out: &mut [f64],
) {
    let h = forecast.len();
    let r = resid.len();
    for p in 0..n_paths {
        let mut drift = 0.0;
        for i in 0..h {
            let e = if r > 0 { resid[rng.int(r)] } else { 0.0 };
            drift = 0.5 * drift + e;
            let v = forecast[i] + drift;
            out[p * h + i] = if v > 0.0 { v } else { 0.0 };
        }
    }
}

pub fn path_quantiles(paths: &[f64], n_paths: usize, h: usize, out: &mut [f64]) {
    let mut col = vec![0.0f64; n_paths];
    for i in 0..h {
        for p in 0..n_paths {
            col[p] = paths[p * h + i];
        }
        col.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        for (k, q) in QUANTILES.iter().enumerate() {
            out[k * h + i] = quantile_sorted(&col, *q);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantiles_and_scores() {
        assert_eq!(quantile_sorted(&[1.0, 2.0, 3.0, 4.0], 0.5), 2.5);
        assert!((pinball(10.0, 8.0, 0.9) - 1.8).abs() < 1e-12);
        assert_eq!(mase(&[2.0, 4.0], &[2.0, 4.0], &[1.0, 2.0, 3.0], 12), 0.0);
    }

    #[test]
    fn flat_ets_keeps_its_level() {
        let y = vec![50.0; 30];
        let mut f = vec![0.0; 3];
        let mut r = vec![0.0; 30];
        ets_run(&y, 3, 12, 0.0, 0.0, 0.0, 0.9, true, &mut f, &mut r);
        assert_eq!(f, vec![50.0, 50.0, 50.0]);
    }

    #[test]
    fn croston_on_zeros_is_zero() {
        let mut f = vec![1.0; 2];
        let mut r = vec![1.0; 6];
        croston_run(&[0.0; 6], 2, 0.1, 0.1, 0, &mut f, &mut r);
        assert_eq!(f, vec![0.0, 0.0]);
    }
}
