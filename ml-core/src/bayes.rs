//! Bayesian kernels (ADR 0022). Mirrors `src/forecast/ref/ffbs.ts`.

/// Forward-filtering backward-sampling for a scalar state space model:
/// `a_1 ~ N(m0, c0)`, `a_t = phi a_{t-1} + N(0, w)`, `y_t = a_t + N(0, v_t)`.
/// A step is missing when `y_t` is NaN or `v_t` is not finite. `z` holds one
/// standard normal per step; `out` receives the sampled path.
pub fn ffbs(y: &[f64], v: &[f64], phi: f64, w: f64, m0: f64, c0: f64, z: &[f64], out: &mut [f64]) {
    let n = y.len();
    if n == 0 {
        return;
    }
    let mut m = vec![0.0; n];
    let mut c = vec![0.0; n];
    let mut a = vec![0.0; n];
    let mut r = vec![0.0; n];
    for t in 0..n {
        let at = if t == 0 { m0 } else { phi * m[t - 1] };
        let rt = if t == 0 { c0 } else { phi * phi * c[t - 1] + w };
        a[t] = at;
        r[t] = rt;
        if y[t].is_nan() || !v[t].is_finite() {
            m[t] = at;
            c[t] = rt;
        } else {
            let k = rt / (rt + v[t]);
            m[t] = at + k * (y[t] - at);
            c[t] = (1.0 - k) * rt;
        }
    }
    out[n - 1] = m[n - 1] + c[n - 1].max(0.0).sqrt() * z[n - 1];
    for t in (0..n - 1).rev() {
        let b = (c[t] * phi) / r[t + 1];
        let h = m[t] + b * (out[t + 1] - a[t + 1]);
        let hv = c[t] - b * b * r[t + 1];
        out[t] = h + hv.max(0.0).sqrt() * z[t];
    }
}

/// The log-likelihood of `y` with the states integrated out (Kalman filter).
pub fn kf_loglik(y: &[f64], v: &[f64], phi: f64, w: f64, m0: f64, c0: f64) -> f64 {
    let log_2pi = (2.0 * std::f64::consts::PI).ln();
    let mut m = m0;
    let mut c = c0;
    let mut ll = 0.0;
    for t in 0..y.len() {
        let a = if t == 0 { m0 } else { phi * m };
        let r = if t == 0 { c0 } else { phi * phi * c + w };
        if y[t].is_nan() || !v[t].is_finite() {
            m = a;
            c = r;
            continue;
        }
        let q = r + v[t];
        let e = y[t] - a;
        ll += -0.5 * (log_2pi + q.ln() + (e * e) / q);
        let k = r / q;
        m = a + k * e;
        c = (1.0 - k) * r;
    }
    ll
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_observations_are_returned() {
        let y = [1.0, 2.0, 3.0];
        let mut out = [0.0; 3];
        ffbs(&y, &[0.0; 3], 1.0, 1.0, 0.0, 10.0, &[0.5; 3], &mut out);
        for (o, e) in out.iter().zip(y.iter()) {
            assert!((o - e).abs() < 1e-12);
        }
    }

    #[test]
    fn one_observation_is_a_normal_density() {
        let ll = kf_loglik(&[1.0], &[1.0], 1.0, 1.0, 0.0, 1.0);
        let expect = -0.5 * ((2.0 * std::f64::consts::PI).ln() + 2f64.ln() + 0.5);
        assert!((ll - expect).abs() < 1e-12);
    }

    #[test]
    fn missing_steps_follow_the_state_model() {
        let y = [5.0, f64::NAN, 5.0];
        let mut out = [0.0; 3];
        ffbs(
            &y,
            &[0.0, 1.0, 0.0],
            1.0,
            1.0,
            0.0,
            10.0,
            &[0.0; 3],
            &mut out,
        );
        assert!((out[1] - 5.0).abs() < 1e-12);
    }
}
