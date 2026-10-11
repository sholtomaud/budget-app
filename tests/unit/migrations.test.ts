import { describe, expect, test } from 'vitest';
import { MIGRATIONS } from '../../src/store/idb.ts';

/** Just enough of IDBDatabase to record what an upgrade step creates. */
function fakeDb() {
  const stores: { name: string; keyPath?: string | string[] | null }[] = [];
  const db = {
    createObjectStore(name: string, opts?: IDBObjectStoreParameters) {
      stores.push({ name, keyPath: opts?.keyPath ?? null });
      return {} as IDBObjectStore;
    },
  } as unknown as IDBDatabase;
  return { db, stores };
}

describe('IndexedDB migrations (NFR-STO-001)', () => {
  test('version 1 creates the imports and kv stores', () => {
    const { db, stores } = fakeDb();
    MIGRATIONS[0]!(db, {} as IDBTransaction);
    expect(stores).toEqual([
      { name: 'imports', keyPath: 'record.id' },
      { name: 'kv', keyPath: null },
    ]);
  });

  test('the database version is the number of steps, and steps are append-only', () => {
    // Appending a step bumps the version; existing steps never change. Pin
    // the count so a reorder or removal fails here, not in a user's browser.
    expect(MIGRATIONS).toHaveLength(1);
  });
});
