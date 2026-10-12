/**
 * Forward-filtering backward-sampling for a scalar linear-Gaussian state
 * space model (ADR 0022). The TypeScript reference for ml-core's `mc_ffbs`.
 *
 *   state:       a_1 ~ N(m0, c0),  a_t = φ a_{t−1} + η_t,  η_t ~ N(0, w)
 *   observation: y_t = a_t + ε_t,  ε_t ~ N(0, v_t)
 *
 * A month is missing when y_t is NaN or v_t is not finite. The standard
 * normals `z` (one per step) make the draw reproducible and let the two
 * implementations agree exactly.
 */
export function ffbs(
  y: Float64Array,
  v: Float64Array,
  phi: number,
  w: number,
  m0: number,
  c0: number,
  z: Float64Array
): Float64Array {
  const n = y.length;
  const m = new Float64Array(n);
  const c = new Float64Array(n);
  const a = new Float64Array(n);
  const r = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const at = t === 0 ? m0 : phi * m[t - 1]!;
    const rt = t === 0 ? c0 : phi * phi * c[t - 1]! + w;
    a[t] = at;
    r[t] = rt;
    const yt = y[t]!;
    const vt = v[t]!;
    if (Number.isNaN(yt) || !Number.isFinite(vt)) {
      m[t] = at;
      c[t] = rt;
    } else {
      const k = rt / (rt + vt);
      m[t] = at + k * (yt - at);
      c[t] = (1 - k) * rt;
    }
  }
  const out = new Float64Array(n);
  if (n === 0) return out;
  out[n - 1] = m[n - 1]! + Math.sqrt(Math.max(c[n - 1]!, 0)) * z[n - 1]!;
  for (let t = n - 2; t >= 0; t--) {
    const b = (c[t]! * phi) / r[t + 1]!;
    const h = m[t]! + b * (out[t + 1]! - a[t + 1]!);
    const hv = c[t]! - b * b * r[t + 1]!;
    out[t] = h + Math.sqrt(Math.max(hv, 0)) * z[t]!;
  }
  return out;
}

const LOG_2PI = Math.log(2 * Math.PI);

/**
 * The log-likelihood of y under the same model with the states integrated
 * out (Kalman filter prediction errors). Missing steps add nothing.
 */
export function kfLoglik(
  y: Float64Array,
  v: Float64Array,
  phi: number,
  w: number,
  m0: number,
  c0: number
): number {
  let m = m0;
  let c = c0;
  let ll = 0;
  for (let t = 0; t < y.length; t++) {
    const a = t === 0 ? m0 : phi * m;
    const r = t === 0 ? c0 : phi * phi * c + w;
    const yt = y[t]!;
    const vt = v[t]!;
    if (Number.isNaN(yt) || !Number.isFinite(vt)) {
      m = a;
      c = r;
      continue;
    }
    const q = r + vt;
    const e = yt - a;
    ll += -0.5 * (LOG_2PI + Math.log(q) + (e * e) / q);
    const k = r / q;
    m = a + k * e;
    c = (1 - k) * r;
  }
  return ll;
}
