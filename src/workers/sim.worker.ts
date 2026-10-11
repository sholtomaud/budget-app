/**
 * The `sim` worker (SPEC §4). M0 scope: verify and load the pinned kernel,
 * and run a model end to end. Monte-Carlo and the policy controller arrive in M5.
 */
import wasmUrl from '../../vendor/gssk/gssk.wasm?url';
import pinJson from '../../vendor/gssk/GSSK_PIN.json' with { type: 'json' };
import { GsskKernel, type GsskPin, type KernelInfo } from '../sim/gssk.ts';
import { runModel, type RunOptions, type RunTrace } from '../sim/run.ts';
import householdModel from '../sim/examples/household_model.json?raw';
import { expose, type Endpoint } from './rpc.ts';

const pin = pinJson as GsskPin;
let kernel: Promise<GsskKernel> | null = null;

function getKernel(): Promise<GsskKernel> {
  kernel ??= (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`gssk.wasm: HTTP ${res.status}`);
    return GsskKernel.load(await res.arrayBuffer(), pin);
  })();
  // A failed load is not cached, so a retry fetches again.
  kernel.catch(() => (kernel = null));
  return kernel;
}

const api = {
  async kernelInfo(): Promise<KernelInfo> {
    return (await getKernel()).info;
  },
  async runModel(modelJson: string, opts?: RunOptions): Promise<RunTrace> {
    return runModel(await getKernel(), modelJson, opts);
  },
  async runHouseholdExample(opts?: RunOptions): Promise<RunTrace> {
    return runModel(await getKernel(), householdModel, opts);
  },
};

export type SimApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
