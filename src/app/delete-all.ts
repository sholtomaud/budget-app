/**
 * "Delete all data" (NFR-STO-004): IndexedDB, OPFS, caches, the service
 * worker and this app's local preferences, then a fresh start.
 */
import { deleteDb } from '../store/idb.ts';
import { terminateWorkers } from './workers.ts';

export async function deleteAllData(): Promise<void> {
  // Workers hold open database connections; stop them first.
  terminateWorkers();
  await deleteDb();
  if ('caches' in globalThis) {
    for (const k of await caches.keys()) await caches.delete(k);
  }
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (root) {
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys())
        await root.removeEntry(name, { recursive: true });
    }
  } catch {
    // OPFS unavailable: nothing stored there.
  }
  if ('serviceWorker' in navigator) {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('budget-app:')) localStorage.removeItem(k);
  } catch {
    // Private mode.
  }
}
