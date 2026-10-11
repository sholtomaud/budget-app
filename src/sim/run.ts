/**
 * Run a GSSK model start to end and collect a trace. Used by the sim worker
 * for the M0 kernel check and by the kernel tests.
 */
import type { GsskKernel } from './gssk.ts';

export interface RunOptions {
  /** Node IDs to record. Default: every storage the model reports. */
  track?: string[];
  /** Record every nth step (the first and last steps are always recorded). */
  every?: number;
}

export interface CarrierCheck {
  id: string;
  conserved: boolean;
  /** Largest |GSSK_GetCarrierConservationError| seen over the run. */
  maxAbsError: number;
}

export interface RunTrace {
  modelName: string;
  steps: number;
  times: number[];
  series: Record<string, number[]>;
  carriers: CarrierCheck[];
  mutationCount: number;
  ms: number;
}

export function runModel(kernel: GsskKernel, modelJson: string, opts: RunOptions = {}): RunTrace {
  const t0 = performance.now();
  const model = JSON.parse(modelJson) as { metadata?: { name?: string } };
  const inst = kernel.init(modelJson);
  try {
    const track = opts.track ?? [...inst.nodeIds];
    const idx = track.map((id) => inst.nodeIndex(id));
    const every = Math.max(1, Math.floor(opts.every ?? 1));
    const series: Record<string, number[]> = Object.fromEntries(track.map((id) => [id, []]));
    const times: number[] = [];
    const carriers: CarrierCheck[] = inst.carrierIds.map((id) => ({
      id,
      conserved: inst.carrierConserved(id),
      maxAbsError: 0,
    }));

    const record = () => {
      const s = inst.state();
      times.push(inst.time);
      track.forEach((id, j) => series[id]!.push(s[idx[j]!]!));
    };

    const dt = inst.dt;
    const nSteps = Math.round((inst.tEnd - inst.tStart) / dt);
    record();
    for (let n = 1; n <= nSteps; n++) {
      inst.step(dt);
      for (const c of carriers) {
        const e = Math.abs(inst.carrierConservationError(c.id));
        if (e > c.maxAbsError) c.maxAbsError = e;
      }
      if (n % every === 0 || n === nSteps) record();
    }

    return {
      modelName: model.metadata?.name ?? '(unnamed)',
      steps: nSteps,
      times,
      series,
      carriers,
      mutationCount: inst.mutationCount(),
      ms: performance.now() - t0,
    };
  } finally {
    inst.free();
  }
}
