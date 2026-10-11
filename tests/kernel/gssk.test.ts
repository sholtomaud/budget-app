import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { GsskError, GsskKernel, PinMismatchError } from '../../src/sim/gssk.ts';
import { runModel } from '../../src/sim/run.ts';
import {
  closedMoneyModel,
  householdModel,
  loadKernel,
  moneyModel,
  pin,
  root,
  wasmBytes,
} from './helpers.ts';

describe('GSSK pin (NFR-KER-001)', () => {
  for (const [file, expected] of Object.entries(pin.sha256)) {
    test(`vendor/gssk/${file} matches GSSK_PIN.json`, () => {
      const actual = createHash('sha256')
        .update(readFileSync(new URL(`vendor/gssk/${file}`, root)))
        .digest('hex');
      expect(actual).toBe(expected);
    });
  }

  test('pin names a full commit SHA', () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('load refuses a wasm whose hash does not match', async () => {
    const bytes = new Uint8Array(wasmBytes());
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
    await expect(GsskKernel.load(bytes.buffer, pin)).rejects.toThrow(PinMismatchError);
  });

  test('load refuses when the pin is altered', async () => {
    const bad = { ...pin, sha256: { ...pin.sha256, 'gssk.wasm': '0'.repeat(64) } };
    await expect(GsskKernel.load(wasmBytes(), bad)).rejects.toThrow(PinMismatchError);
  });

  test('loaded kernel reports the pinned version', async () => {
    const k = await loadKernel();
    expect(k.info.version).toBe(pin.version);
    expect(k.info.sha256).toBe(pin.sha256['gssk.wasm']);
  });
});

describe('GSSK wrapper', () => {
  test('init rejects invalid JSON with a named status', async () => {
    const k = await loadKernel();
    expect(() => k.init('{not json')).toThrow(GsskError);
    expect(() => k.init('{not json')).toThrow(/GSSK_ERR_INVALID_JSON/);
  });

  test('init exposes node, edge and carrier IDs', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      expect(inst.carrierIds).toEqual(['money']);
      expect(inst.nodeIds).toContain('bank');
      expect(inst.edgeIds).toContain('etf_gain');
      expect(inst.tEnd).toBe(24);
      expect(inst.dt).toBe(1);
    } finally {
      inst.free();
    }
  });

  test('step advances time; constant flows move money month by month', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      const bank = inst.nodeIndex('bank');
      expect(inst.state()[bank]).toBe(12000);
      inst.step();
      expect(inst.time).toBe(1);
      // 8200 in, 6100 + 1500 out.
      expect(inst.state()[bank]).toBeCloseTo(12600, 9);
    } finally {
      inst.free();
    }
  });

  test('closed money model: conservation error <= 1e-9 at every step (FR-SIM-003)', async () => {
    const inst = (await loadKernel()).init(closedMoneyModel);
    try {
      for (let n = 0; n < 120; n++) {
        inst.step();
        const err = Math.abs(inst.carrierConservationError('money'));
        expect(err, `conservation error at t=${inst.time}`).toBeLessThanOrEqual(1e-9);
      }
    } finally {
      inst.free();
    }
  });

  test('open model: the carrier "conservation error" is the relative net boundary flow', async () => {
    // gssk.h: for an open system the value is the relative change in total
    // storage, i.e. net inflow/outflow, not a numerical leak (see ADR 0005).
    const inst = (await loadKernel()).init(moneyModel);
    try {
      inst.setEdgeK('etf_gain', 0, 'test:freeze-returns');
      inst.step();
      // Storage total 262000; net boundary flow over one month: +8200 pay − 6100 spend.
      const expected = (8200 - 6100) / 262000;
      expect(inst.carrierConservationError('money')).toBeCloseTo(expected, 12);
    } finally {
      inst.free();
    }
  });

  test('a sink accumulates its cumulative offtake from its opening value', async () => {
    // gssk.h comments sinks as "dQ/dt = 0", but in 5.3.0 a sink's Q integrates its
    // inflow. So `value` is the opening accumulator: 0 at scenario start (ADR 0005).
    const inst = (await loadKernel()).init(moneyModel);
    try {
      const opex = inst.nodeIndex('opex');
      expect(inst.state()[opex]).toBe(0);
      for (let n = 0; n < 3; n++) inst.step();
      expect(inst.state()[opex]).toBeCloseTo(3 * 6100, 9);
    } finally {
      inst.free();
    }
  });

  test('reset returns to t_start and initial state', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      const s0 = inst.state();
      for (let n = 0; n < 5; n++) inst.step();
      inst.reset();
      expect(inst.time).toBe(0);
      expect(inst.state()).toEqual(s0);
    } finally {
      inst.free();
    }
  });

  test('setEdgeK records its cause in the mutation log', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      inst.step();
      inst.setEdgeK('etf_loss', 0.02, 'policy:test-drawdown');
      expect(inst.getEdgeK('etf_loss')).toBe(0.02);
      expect(inst.mutationCount()).toBe(1);
      const log = JSON.parse(inst.exportMutationLog()) as Array<Record<string, unknown>>;
      expect(log.length).toBe(1);
      expect(log[0]!.op).toBe('set_edge_k');
      expect(log[0]!.target_id).toBe('etf_loss');
      expect(log[0]!.cause).toBe('policy:test-drawdown');
      expect(log[0]!.t).toBe(1);
    } finally {
      inst.free();
    }
  });

  test('replay from the mutation log reproduces the run exactly (FR-SIM-004)', async () => {
    const k = await loadKernel();
    const inst = k.init(moneyModel);
    let replayed;
    try {
      const policy: Record<number, [string, number]> = {
        3: ['etf_loss', 0.03],
        6: ['etf_gain', 0],
        9: ['etf_loss', 0],
        12: ['etf_gain', 0.006],
      };
      for (let month = 0; month < 24; month++) {
        const change = policy[month];
        if (change) inst.setEdgeK(change[0], change[1], `policy:month-${month}`);
        inst.step();
      }
      replayed = k.replay(moneyModel, inst.exportMutationLog(), inst.tEnd);
      expect(replayed.time).toBe(inst.time);
      expect(replayed.state()).toEqual(inst.state());
    } finally {
      inst.free();
      replayed?.free();
    }
  });

  test('an instance cannot be used after free()', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    inst.free();
    expect(() => inst.step()).toThrow(/after free/);
  });
});

describe('household example model (M0 acceptance)', () => {
  test('runs to t_end and reports every carrier', async () => {
    const trace = runModel(await loadKernel(), householdModel, {
      track: ['bank_account', 'super_fund'],
    });
    expect(trace.modelName).toBe('Household Ecological-Economy');
    expect(trace.steps).toBe(240);
    expect(trace.times.length).toBe(241);
    expect(trace.times.at(-1)).toBeCloseTo(24, 9);
    expect(trace.series.bank_account!.length).toBe(241);
    expect(trace.carriers.map((c) => c.id)).toEqual(['money', 'energy', 'material', 'information']);
    expect(trace.series.bank_account!.every(Number.isFinite)).toBe(true);
  });

  test('is deterministic (NFR-DET-001)', async () => {
    const k = await loadKernel();
    const a = runModel(k, householdModel);
    const b = runModel(k, householdModel);
    expect(a.series).toEqual(b.series);
    expect(a.carriers).toEqual(b.carriers);
  });
});
