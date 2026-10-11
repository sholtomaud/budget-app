import { readFileSync } from 'node:fs';
import { GsskKernel, type GsskPin } from '../../src/sim/gssk.ts';

export const root = new URL('../../', import.meta.url);
export const pin = JSON.parse(
  readFileSync(new URL('vendor/gssk/GSSK_PIN.json', root), 'utf8')
) as GsskPin;

export function wasmBytes(): ArrayBuffer {
  const buf = readFileSync(new URL('vendor/gssk/gssk.wasm', root));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function loadKernel(): Promise<GsskKernel> {
  return GsskKernel.load(wasmBytes(), pin);
}

export const householdModel = readFileSync(
  new URL('src/sim/examples/household_model.json', root),
  'utf8'
);

/**
 * A money-only model: wages → bank → spend, with a holding that gains and
 * loses through paired edges (the SPEC §11.1 pattern). Every flow stays
 * inside the conserved `money` carrier.
 */
export const moneyModel = JSON.stringify({
  metadata: { schema_version: 4, name: 'kernel-test:money' },
  config: { t_start: 0, t_end: 24, dt: 1, method: 'rk4' },
  carriers: [{ id: 'money', unit: 'AUD', conserved: true }],
  nodes: [
    { id: 'wages', type: 'source', carrier: 'money', value: 1 },
    { id: 'market', type: 'source', carrier: 'money', value: 1 },
    { id: 'bank', type: 'storage', carrier: 'money', value: 12000 },
    { id: 'etf', type: 'storage', carrier: 'money', value: 250000 },
    { id: 'opex', type: 'sink', carrier: 'money', value: 0 },
    { id: 'market_loss', type: 'sink', carrier: 'money', value: 0 },
  ],
  edges: [
    {
      id: 'pay',
      origin: 'wages',
      target: 'bank',
      carrier: 'money',
      logic: 'constant',
      params: { k: 8200 },
    },
    {
      id: 'spend',
      origin: 'bank',
      target: 'opex',
      carrier: 'money',
      logic: 'constant',
      params: { k: 6100 },
    },
    {
      id: 'invest',
      origin: 'bank',
      target: 'etf',
      carrier: 'money',
      logic: 'constant',
      params: { k: 1500 },
    },
    {
      id: 'etf_gain',
      origin: 'market',
      target: 'etf',
      carrier: 'money',
      logic: 'interaction',
      params: { k: 0.004, control_node: 'etf' },
    },
    {
      id: 'etf_loss',
      origin: 'etf',
      target: 'market_loss',
      carrier: 'money',
      logic: 'linear',
      params: { k: 0 },
    },
  ],
});

/** A closed money model: no sources or sinks, money only moves between storages. */
export const closedMoneyModel = JSON.stringify({
  metadata: { schema_version: 4, name: 'kernel-test:closed-money' },
  config: { t_start: 0, t_end: 120, dt: 1, method: 'rk4' },
  carriers: [{ id: 'money', unit: 'AUD', conserved: true }],
  nodes: [
    { id: 'bank', type: 'storage', carrier: 'money', value: 12000 },
    { id: 'etf', type: 'storage', carrier: 'money', value: 250000 },
    { id: 'btc', type: 'storage', carrier: 'money', value: 180000 },
  ],
  edges: [
    {
      id: 'invest',
      origin: 'bank',
      target: 'etf',
      carrier: 'money',
      logic: 'linear',
      params: { k: 0.05 },
    },
    {
      id: 'etf_draw',
      origin: 'etf',
      target: 'bank',
      carrier: 'money',
      logic: 'constant',
      params: { k: 900 },
    },
    {
      id: 'rebalance',
      origin: 'btc',
      target: 'etf',
      carrier: 'money',
      logic: 'interaction',
      params: { k: 1e-9, control_node: 'etf' },
    },
  ],
});
