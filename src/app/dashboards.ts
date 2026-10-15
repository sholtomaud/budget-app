/**
 * Dashboards in the vault (ADR 0036): kept with the household, encrypted with
 * it, in exports, and removed by delete-all. Which one is open is remembered.
 */
import { starterDashboard, type Dashboard } from '../viz/dashboard.ts';
import { sim } from './workers.ts';

interface Stored {
  list: Dashboard[];
  open: string | null;
}

async function load(): Promise<Stored> {
  return ((await sim().loadKv('dashboards')) as Stored | null) ?? { list: [], open: null };
}

/** The dashboards, with a starter one the first time. */
export async function loadDashboards(): Promise<Stored> {
  const s = await load();
  if (s.list.length) return s;
  const first = starterDashboard();
  const stored = { list: [first], open: first.id };
  await sim().saveKv('dashboards', stored);
  return stored;
}

export async function saveDashboards(list: Dashboard[], open: string | null): Promise<void> {
  await sim().saveKv('dashboards', { list, open });
}

/** Fired when a dashboard changes outside the Dashboards screen (from the chat). */
export const DASHBOARDS_CHANGED = 'app:dashboards-changed';

/** Add a dashboard or replace one with the same id, and open it; returns how to undo it. */
export async function putDashboard(d: Dashboard): Promise<() => Promise<void>> {
  const before = await loadDashboards();
  const has = before.list.some((x) => x.id === d.id);
  const list = has ? before.list.map((x) => (x.id === d.id ? d : x)) : [...before.list, d];
  await saveDashboards(list, d.id);
  window.dispatchEvent(new CustomEvent(DASHBOARDS_CHANGED));
  return async () => {
    await saveDashboards(before.list, before.open);
    window.dispatchEvent(new CustomEvent(DASHBOARDS_CHANGED));
  };
}
