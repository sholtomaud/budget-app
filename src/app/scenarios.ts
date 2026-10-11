/** Saved scenarios, kept by the sim worker in IndexedDB (`kv:scenarios`). */
import type { FreedomSetup } from '../sim/inputs.ts';
import type { SavedScenario } from '../optimise/scenarios.ts';
import { sim } from './workers.ts';

export const loadScenarios = () => sim().loadScenarios();
export const saveScenarios = (list: SavedScenario[]) => sim().saveScenarios(list);

export async function addScenario(
  name: string,
  setup: FreedomSetup,
  source: SavedScenario['source'],
  runId?: string
): Promise<SavedScenario> {
  const list = await loadScenarios();
  const s: SavedScenario = {
    id: `sc-${Date.now().toString(36)}-${list.length}`,
    name: name.trim() || `Scenario ${list.length + 1}`,
    createdAt: new Date().toISOString(),
    source,
    setup: structuredClone(setup),
    ...(runId ? { runId } : {}),
  };
  await saveScenarios([...list, s]);
  return s;
}

/** Make a scenario the Freedom screen's current setup. */
export const openInFreedom = (s: SavedScenario) => sim().saveSetup(structuredClone(s.setup));
