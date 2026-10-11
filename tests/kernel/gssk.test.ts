import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
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
      assert.equal(actual, expected);
    });
  }

  test('pin names a full commit SHA', () => {
    assert.match(pin.commit, /^[0-9a-f]{40}$/);
  });

  test('load refuses a wasm whose hash does not match', async () => {
    const bytes = new Uint8Array(wasmBytes());
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
    await assert.rejects(GsskKernel.load(bytes.buffer, pin), PinMismatchError);
  });

  test('load refuses when the pin is altered', async () => {
    const bad = { ...pin, sha256: { ...pin.sha256, 'gssk.wasm': '0'.repeat(64) } };
    await assert.rejects(GsskKernel.load(wasmBytes(), bad), PinMismatchError);
  });

  test('loaded kernel reports the pinned version', async () => {
    const k = await loadKernel();
    assert.equal(k.info.version, pin.version);
    assert.equal(k.info.sha256, pin.sha256['gssk.wasm']);
  });
});

describe('GSSK wrapper', () => {
  test('init rejects invalid JSON with a named status', async () => {
    const k = await loadKernel();
    assert.throws(
      () => k.init('{not json'),
      (e: unknown) => {
        assert.ok(e instanceof GsskError);
        assert.match(e.message, /GSSK_INVALID_JSON|GSSK_ERR_INVALID_JSON/);
        return true;
      }
    );
  });

  test('init exposes node, edge and carrier IDs', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      assert.deepEqual(inst.carrierIds, ['money']);
      assert.ok(inst.nodeIds.includes('bank'));
      assert.ok(inst.edgeIds.includes('etf_gain'));
      assert.equal(inst.tEnd, 24);
      assert.equal(inst.dt, 1);
    } finally {
      inst.free();
    }
  });

  test('step advances time; constant flows move money month by month', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      const bank = inst.nodeIndex('bank');
      assert.equal(inst.state()[bank], 12000);
      inst.step();
      assert.equal(inst.time, 1);
      // 8200 in, 6100 + 1500 out.
      assert.ok(Math.abs(inst.state()[bank]! - 12600) < 1e-9);
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
        assert.ok(err <= 1e-9, `conservation error ${err} at t=${inst.time}`);
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
      assert.ok(Math.abs(inst.carrierConservationError('money') - expected) < 1e-12);
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
      assert.equal(inst.state()[opex], 0);
      for (let n = 0; n < 3; n++) inst.step();
      assert.ok(Math.abs(inst.state()[opex]! - 3 * 6100) < 1e-9);
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
      assert.equal(inst.time, 0);
      assert.deepEqual(inst.state(), s0);
    } finally {
      inst.free();
    }
  });

  test('setEdgeK records its cause in the mutation log', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    try {
      inst.step();
      inst.setEdgeK('etf_loss', 0.02, 'policy:test-drawdown');
      assert.equal(inst.getEdgeK('etf_loss'), 0.02);
      assert.equal(inst.mutationCount(), 1);
      const log = JSON.parse(inst.exportMutationLog()) as Array<Record<string, unknown>>;
      assert.equal(log.length, 1);
      assert.equal(log[0]!.op, 'set_edge_k');
      assert.equal(log[0]!.target_id, 'etf_loss');
      assert.equal(log[0]!.cause, 'policy:test-drawdown');
      assert.equal(log[0]!.t, 1);
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
      assert.equal(replayed.time, inst.time);
      assert.deepEqual(replayed.state(), inst.state());
    } finally {
      inst.free();
      replayed?.free();
    }
  });

  test('an instance cannot be used after free()', async () => {
    const inst = (await loadKernel()).init(moneyModel);
    inst.free();
    assert.throws(() => inst.step(), /after free/);
  });
});

describe('household example model (M0 acceptance)', () => {
  test('runs to t_end and reports every carrier', async () => {
    const trace = runModel(await loadKernel(), householdModel, {
      track: ['bank_account', 'super_fund'],
    });
    assert.equal(trace.modelName, 'Household Ecological-Economy');
    assert.equal(trace.steps, 240);
    assert.equal(trace.times.length, 241);
    assert.ok(Math.abs(trace.times.at(-1)! - 24) < 1e-9);
    assert.equal(trace.series.bank_account!.length, 241);
    assert.deepEqual(
      trace.carriers.map((c) => c.id),
      ['money', 'energy', 'material', 'information']
    );
    for (const v of trace.series.bank_account!) assert.ok(Number.isFinite(v));
  });

  test('is deterministic (NFR-DET-001)', async () => {
    const k = await loadKernel();
    const a = runModel(k, householdModel);
    const b = runModel(k, householdModel);
    assert.deepEqual(a.series, b.series);
    assert.deepEqual(a.carriers, b.carriers);
  });
});
