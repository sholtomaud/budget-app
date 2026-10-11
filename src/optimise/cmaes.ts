/**
 * The CMA-ES kernel interface (SPEC §11.4): the TypeScript reference here,
 * ml-core's `mc_cmaes_*` in the forecast worker. Both are ask/tell over a
 * flat state and agree within 1e-9 (parity test). States are immutable from
 * the caller's side: tell returns the next state.
 */
import { cmaesAsk, cmaesInit, cmaesTell } from './ref/cmaes.ts';

export interface CmaKernel {
  name: 'ts' | 'ml-core';
  init(x0: Float64Array, sigma0: number, lambda: number): Float64Array;
  /** λ candidates (λ × n, row-major) from λ × n standard-normal draws. */
  ask(state: Float64Array, z: Float64Array): Float64Array;
  tell(state: Float64Array, x: Float64Array, f: Float64Array): Float64Array;
}

export const tsCma: CmaKernel = {
  name: 'ts',
  init: cmaesInit,
  ask: cmaesAsk,
  tell(state, x, f) {
    const next = state.slice();
    cmaesTell(next, x, f);
    return next;
  },
};
