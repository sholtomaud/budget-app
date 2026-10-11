/**
 * modelgen (FR-SIM-001, SPEC §11.1): a pure function from a scenario to a
 * GSSK model JSON. Time unit months, dt = 1, t = 0 at `scenario.asOf`.
 *
 * The model is closed (ADR 0012): the external pools (`income`, `market`)
 * are storages opened with a large balance, and the sinks (OPEX, CAPEX, tax,
 * market losses) are storages opened at zero. Every edge is `constant`, its
 * k (dollars per month) set by the controller each month, so a month's flow
 * is exactly k. OPEX is one sink, not one per category group: GSSK 5.3.0
 * scans the graph for motifs after every step, at a cost that grows with
 * the bank's degree (KR-7), and the per-group split is not a simulation
 * output.
 */
import type { Scenario } from './model.ts';

/** Opening balance of each external pool, dollars. Far above any 40-year flow. */
export const POOL = 1e10;

export const POOLS = ['income', 'market'] as const;
export const SINKS = ['opex', 'capex', 'tax', 'market_loss'] as const;

export interface ModelLayout {
  months: number;
  holdingNodes: string[];
  /** Edge ids per holding, index-aligned with scenario.holdings. */
  gain: string[];
  loss: string[];
  contrib: string[];
  draw: string[];
}

export const nodeIdOf = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');

/** Months from asOf (YYYY-MM) to date (YYYY-MM[-DD]). */
export function monthsBetween(asOf: string, date: string): number {
  const [y0, m0] = asOf.split('-').map(Number) as [number, number];
  const [y1, m1] = date.split('-').map(Number) as [number, number];
  return (y1 - y0) * 12 + (m1 - m0);
}

/** Simulated months: from asOf to the goal's start plus its horizon. */
export function horizonMonths(s: Scenario): number {
  return Math.max(1, monthsBetween(s.asOf, s.goal.start) + Math.round(s.goal.horizonYears * 12));
}

export function layout(s: Scenario): ModelLayout {
  const holdingNodes = s.holdings.map((h) => `h_${nodeIdOf(h.id)}`);
  return {
    months: horizonMonths(s),
    holdingNodes,
    gain: holdingNodes.map((n) => `gain_${n}`),
    loss: holdingNodes.map((n) => `loss_${n}`),
    contrib: holdingNodes.map((n) => `contrib_${n}`),
    draw: holdingNodes.map((n) => `draw_${n}`),
  };
}

const dollars = (minor: bigint) => Number(minor) / 100;

export function modelgen(
  s: Scenario,
  opts: { holdingScale?: number } = {}
): { json: string; layout: ModelLayout } {
  const L = layout(s);
  const scale = opts.holdingScale ?? 1;
  const node = (id: string, value: number) => ({
    id,
    type: 'storage',
    carrier: 'money',
    value,
  });
  const edge = (id: string, origin: string, target: string) => ({
    id,
    origin,
    target,
    carrier: 'money',
    logic: 'constant',
    params: { k: 0 },
  });
  const nodes = [
    ...POOLS.map((p) => node(p, POOL)),
    node('bank', dollars(s.decisions.bankBuffer)),
    ...s.holdings.map((h, i) => node(L.holdingNodes[i]!, dollars(h.value) * scale)),
    ...SINKS.map((k) => node(k, 0)),
  ];
  const edges = [
    edge('pay', 'income', 'bank'),
    edge('project_pay', 'income', 'bank'),
    edge('opex_spend', 'bank', 'opex'),
    edge('capex_spend', 'bank', 'capex'),
    edge('tax_paid', 'bank', 'tax'),
    ...L.holdingNodes.flatMap((n, i) => [
      edge(L.gain[i]!, 'market', n),
      edge(L.loss[i]!, n, 'market_loss'),
      edge(L.contrib[i]!, 'bank', n),
      edge(L.draw[i]!, n, 'bank'),
    ]),
  ];
  const model = {
    metadata: { schema_version: 4, name: `freedom:${nodeIdOf(s.id)}` },
    carriers: [{ id: 'money', unit: 'AUD', conserved: true }],
    nodes,
    edges,
    config: { t_start: 0, t_end: L.months, dt: 1, method: 'rk4' },
  };
  return { json: JSON.stringify(model), layout: L };
}
