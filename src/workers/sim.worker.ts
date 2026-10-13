/**
 * The `sim` worker (SPEC §4, §11). Verifies and loads the pinned kernel, runs
 * chunks of Monte-Carlo runs for the pool (src/app/sim-pool.ts), and keeps
 * the Freedom screen's setup in IndexedDB.
 */
import wasmUrl from '../../vendor/gssk/gssk.wasm?url';
import pinJson from '../../vendor/gssk/GSSK_PIN.json' with { type: 'json' };
import { GsskKernel, type GsskPin, type KernelInfo } from '../sim/gssk.ts';
import { runModel, type RunOptions, type RunTrace } from '../sim/run.ts';
import { runChunk, type ChunkRequest, type ChunkResult } from '../sim/montecarlo.ts';
import type { FreedomSetup } from '../sim/inputs.ts';
import type { SavedScenario } from '../optimise/scenarios.ts';
import { IdbValue } from '../store/kv.ts';
import { vault } from '../store/vault.ts';
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
  /** The data key from the ingest worker's unlock (NFR-STO-002); null after encryption is off. */
  setKey(key: CryptoKey | null): void {
    vault.setKey(key);
    vault.refresh();
  },
  async kernelInfo(): Promise<KernelInfo> {
    return (await getKernel()).info;
  },
  async runModel(modelJson: string, opts?: RunOptions): Promise<RunTrace> {
    return runModel(await getKernel(), modelJson, opts);
  },
  async runHouseholdExample(opts?: RunOptions): Promise<RunTrace> {
    return runModel(await getKernel(), householdModel, opts);
  },
  /** Runs [from, to) of a scenario (FR-SIM-002). */
  async runChunk(req: ChunkRequest): Promise<ChunkResult> {
    return runChunk(await getKernel(), req);
  },
  loadSetup(): Promise<FreedomSetup | null> {
    return setupStore.get();
  },
  saveSetup(setup: FreedomSetup): Promise<void> {
    return setupStore.set(setup);
  },
  /** Small settings records (provider configuration; never API keys). */
  async loadKv(name: 'providers' | 'histories' | 'setup' | 'charts'): Promise<unknown> {
    return new IdbValue<unknown>(name).get();
  },
  async saveKv(
    name: 'providers' | 'histories' | 'setup' | 'charts',
    value: unknown
  ): Promise<void> {
    await new IdbValue<unknown>(name).set(value);
  },
  /** The local log of every external call (FR-API-004); the last 500 are kept. */
  async loadEgressLog(): Promise<unknown[]> {
    return (await egressStore.get()) ?? [];
  },
  async appendEgressLog(entry: unknown): Promise<void> {
    const log = (await egressStore.get()) ?? [];
    await egressStore.set([...log, entry].slice(-500));
  },
  async loadScenarios(): Promise<SavedScenario[]> {
    return (await scenarioStore.get()) ?? [];
  },
  saveScenarios(list: SavedScenario[]): Promise<void> {
    return scenarioStore.set(list);
  },
};

const setupStore = new IdbValue<FreedomSetup>('freedom');
const scenarioStore = new IdbValue<SavedScenario[]>('scenarios');
const egressStore = new IdbValue<unknown[]>('egress-log');

export type SimApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
