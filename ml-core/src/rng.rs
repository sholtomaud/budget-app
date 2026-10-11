//! SplitMix64, identical to `src/lib/prng.ts` and GSSK's instance RNG.

const GOLDEN: u64 = 0x9e37_79b9_7f4a_7c15;

fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(GOLDEN);
        mix(self.state)
    }

    /// Uniform in [0, 1) with 53 bits.
    pub fn float(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / 9_007_199_254_740_992.0
    }

    /// Uniform integer in [0, n).
    pub fn int(&mut self, n: usize) -> usize {
        (self.float() * n as f64).floor() as usize
    }

    pub fn weibull_given(&mut self, k: f64, scale: f64, age: f64) -> f64 {
        let u = 1.0 - self.float();
        scale * ((age / scale).powf(k) - u.ln()).powf(1.0 / k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_sequence_for_seed_zero() {
        let mut r = SplitMix64::new(0);
        assert_eq!(r.next_u64(), 0xe220_a839_7b1d_cdaf);
        assert_eq!(r.next_u64(), 0x6e78_9e6a_a1b9_65f4);
        assert_eq!(r.next_u64(), 0x06c4_5d18_8009_454f);
    }
}
