//! CMA-ES ask/tell over a flat state vector (SPEC §11.4). The twin of
//! `src/optimise/ref/cmaes.ts`: same layout, same loop order, so the two agree
//! to rounding. The caller supplies the standard-normal draws.

pub const HEADER: usize = 12;

pub fn state_size(n: usize, lambda: usize) -> usize {
    HEADER + lambda + 4 * n + 3 * n * n
}

struct Views {
    n: usize,
    lambda: usize,
    mu: usize,
    w: usize,
    mean: usize,
    pc: usize,
    ps: usize,
    d: usize,
    c: usize,
    b: usize,
    inv: usize,
}

fn views(s: &[f64]) -> Views {
    let n = s[0] as usize;
    let lambda = s[1] as usize;
    let w = HEADER;
    let mean = w + lambda;
    let pc = mean + n;
    let ps = pc + n;
    let d = ps + n;
    let c = d + n;
    let b = c + n * n;
    let inv = b + n * n;
    Views {
        n,
        lambda,
        mu: s[2] as usize,
        w,
        mean,
        pc,
        ps,
        d,
        c,
        b,
        inv,
    }
}

pub fn init(x0: &[f64], sigma0: f64, lambda: usize, s: &mut [f64]) {
    let n = x0.len();
    for v in s.iter_mut() {
        *v = 0.0;
    }
    let mu = lambda / 2;
    let nf = n as f64;
    s[0] = nf;
    s[1] = lambda as f64;
    s[2] = mu as f64;
    s[3] = sigma0;
    s[4] = 0.0;
    let mut sum = 0.0;
    for i in 0..mu {
        let wi = (mu as f64 + 0.5).ln() - ((i + 1) as f64).ln();
        s[HEADER + i] = wi;
        sum += wi;
    }
    let mut sq = 0.0;
    for i in 0..mu {
        s[HEADER + i] /= sum;
        sq += s[HEADER + i] * s[HEADER + i];
    }
    let mueff = 1.0 / sq;
    s[5] = mueff;
    s[6] = (4.0 + mueff / nf) / (nf + 4.0 + (2.0 * mueff) / nf);
    s[7] = (mueff + 2.0) / (nf + mueff + 5.0);
    s[8] = 2.0 / ((nf + 1.3) * (nf + 1.3) + mueff);
    s[9] =
        (1.0 - s[8]).min((2.0 * (mueff - 2.0 + 1.0 / mueff)) / ((nf + 2.0) * (nf + 2.0) + mueff));
    s[10] = 1.0 + 2.0 * (((mueff - 1.0) / (nf + 1.0)).sqrt() - 1.0).max(0.0) + s[7];
    s[11] = nf.sqrt() * (1.0 - 1.0 / (4.0 * nf) + 1.0 / (21.0 * nf * nf));
    let v = views(s);
    for i in 0..n {
        s[v.mean + i] = x0[i];
        s[v.d + i] = 1.0;
        s[v.c + i * n + i] = 1.0;
        s[v.b + i * n + i] = 1.0;
        s[v.inv + i * n + i] = 1.0;
    }
}

pub fn ask(s: &[f64], z: &[f64], out: &mut [f64]) {
    let v = views(s);
    let n = v.n;
    let sigma = s[3];
    for k in 0..v.lambda {
        for i in 0..n {
            let mut acc = 0.0;
            for j in 0..n {
                acc += s[v.b + i * n + j] * s[v.d + j] * z[k * n + j];
            }
            out[k * n + i] = s[v.mean + i] + sigma * acc;
        }
    }
}

pub fn tell(s: &mut [f64], x: &[f64], f: &[f64]) {
    let v = views(s);
    let n = v.n;
    let lambda = v.lambda;
    let mu = v.mu;
    let sigma = s[3];
    let mueff = s[5];
    let cc = s[6];
    let cs = s[7];
    let c1 = s[8];
    let cmu = s[9];
    let damps = s[10];
    let chi_n = s[11];
    s[4] += 1.0;
    let gen = s[4];

    let mut idx: Vec<usize> = (0..lambda).collect();
    for a in 1..lambda {
        let cur = idx[a];
        let mut b = a;
        while b > 0 && f[idx[b - 1]] > f[cur] {
            idx[b] = idx[b - 1];
            b -= 1;
        }
        idx[b] = cur;
    }

    let xold: Vec<f64> = (0..n).map(|i| s[v.mean + i]).collect();
    for i in 0..n {
        let mut acc = 0.0;
        for r in 0..mu {
            acc += s[v.w + r] * x[idx[r] * n + i];
        }
        s[v.mean + i] = acc;
    }
    let y: Vec<f64> = (0..n).map(|i| (s[v.mean + i] - xold[i]) / sigma).collect();

    let kps = (cs * (2.0 - cs) * mueff).sqrt();
    let mut ps_norm2 = 0.0;
    for i in 0..n {
        let mut acc = 0.0;
        for j in 0..n {
            acc += s[v.inv + i * n + j] * y[j];
        }
        let p = (1.0 - cs) * s[v.ps + i] + kps * acc;
        s[v.ps + i] = p;
        ps_norm2 += p * p;
    }
    let ps_norm = ps_norm2.sqrt();
    let hsig = if ps_norm / (1.0 - (1.0 - cs).powf(2.0 * gen)).sqrt() / chi_n
        < 1.4 + 2.0 / (n as f64 + 1.0)
    {
        1.0
    } else {
        0.0
    };
    let kpc = hsig * (cc * (2.0 - cc) * mueff).sqrt();
    for i in 0..n {
        s[v.pc + i] = (1.0 - cc) * s[v.pc + i] + kpc * y[i];
    }

    let keep = 1.0 - c1 - cmu;
    let delta = (1.0 - hsig) * cc * (2.0 - cc);
    for i in 0..n {
        for j in 0..=i {
            let mut rank_mu = 0.0;
            for r in 0..mu {
                let k = idx[r];
                rank_mu += s[v.w + r]
                    * ((x[k * n + i] - xold[i]) / sigma)
                    * ((x[k * n + j] - xold[j]) / sigma);
            }
            let cij = keep * s[v.c + i * n + j]
                + c1 * (s[v.pc + i] * s[v.pc + j] + delta * s[v.c + i * n + j])
                + cmu * rank_mu;
            s[v.c + i * n + j] = cij;
            s[v.c + j * n + i] = cij;
        }
    }

    s[3] = sigma * ((cs / damps) * (ps_norm / chi_n - 1.0)).exp();
    eigen(s, &v);
}

fn eigen(s: &mut [f64], v: &Views) {
    let n = v.n;
    let mut a: Vec<f64> = s[v.c..v.c + n * n].to_vec();
    let mut q = vec![0.0; n * n];
    for i in 0..n {
        q[i * n + i] = 1.0;
    }
    for _sweep in 0..64 {
        let mut off = 0.0;
        for i in 0..n {
            for j in i + 1..n {
                off += a[i * n + j] * a[i * n + j];
            }
        }
        if off < 1e-30 {
            break;
        }
        for p in 0..n {
            for r in p + 1..n {
                let apr = a[p * n + r];
                if apr == 0.0 {
                    continue;
                }
                let theta = (a[r * n + r] - a[p * n + p]) / (2.0 * apr);
                let sign = if theta >= 0.0 { 1.0 } else { -1.0 };
                let t = sign / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let sn = t * c;
                for k in 0..n {
                    let akp = a[k * n + p];
                    let akr = a[k * n + r];
                    a[k * n + p] = c * akp - sn * akr;
                    a[k * n + r] = sn * akp + c * akr;
                }
                for k in 0..n {
                    let apk = a[p * n + k];
                    let ark = a[r * n + k];
                    a[p * n + k] = c * apk - sn * ark;
                    a[r * n + k] = sn * apk + c * ark;
                }
                for k in 0..n {
                    let qkp = q[k * n + p];
                    let qkr = q[k * n + r];
                    q[k * n + p] = c * qkp - sn * qkr;
                    q[k * n + r] = sn * qkp + c * qkr;
                }
            }
        }
    }
    for i in 0..n {
        s[v.d + i] = a[i * n + i].max(1e-20).sqrt();
    }
    s[v.b..v.b + n * n].copy_from_slice(&q);
    for i in 0..n {
        for j in 0..n {
            let mut acc = 0.0;
            for k in 0..n {
                acc += (q[i * n + k] * q[j * n + k]) / s[v.d + k];
            }
            s[v.inv + i * n + j] = acc;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimises a shifted sphere from the origin.
    #[test]
    fn converges_on_a_sphere() {
        let n = 4;
        let lambda = 8;
        let mut s = vec![0.0; state_size(n, lambda)];
        init(&[0.0; 4], 0.5, lambda, &mut s);
        let mut rng = crate::rng::SplitMix64::new(7);
        let target = [0.3, -0.2, 0.5, 0.1];
        let mut x = vec![0.0; lambda * n];
        let mut f = vec![0.0; lambda];
        for _ in 0..120 {
            let z: Vec<f64> = (0..lambda * n).map(|_| rng.normal()).collect();
            ask(&s, &z, &mut x);
            for k in 0..lambda {
                f[k] = (0..n).map(|i| (x[k * n + i] - target[i]).powi(2)).sum();
            }
            tell(&mut s, &x, &f);
        }
        let mean = &s[HEADER + lambda..HEADER + lambda + n];
        for i in 0..n {
            assert!((mean[i] - target[i]).abs() < 1e-4, "{mean:?}");
        }
    }
}
