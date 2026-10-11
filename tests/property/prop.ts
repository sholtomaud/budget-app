import { fnv1a64, Rng } from '../../src/lib/prng.ts';

/**
 * Minimal property runner on SplitMix64 (ADR 0007). Each run gets its own
 * stream; a failure reports the seed and run so it replays exactly.
 */
/** `label` names the property; its hash is the seed. */
export async function forAll(
  runs: number,
  label: string,
  fn: (rng: Rng, run: number) => void | Promise<void>
): Promise<void> {
  const base = new Rng(fnv1a64(label));
  for (let i = 0; i < runs; i++) {
    try {
      await fn(base.fork('run', i), i);
    } catch (e) {
      throw new Error(
        `Property failed on run ${i} (property "${label}"): ${(e as Error).message}`,
        { cause: e }
      );
    }
  }
}
