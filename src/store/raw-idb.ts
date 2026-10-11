/** The IndexedDB implementation of `RawDb`: rows exactly as stored. */
import type { RawData, RawDb } from './bundle.ts';
import { done, openDb, request } from './idb.ts';

export class IdbRawDb implements RawDb {
  private readonly name: string | undefined;
  constructor(name?: string) {
    this.name = name;
  }

  private async withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await openDb(this.name);
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  }

  read(): Promise<RawData> {
    return this.withDb(async (db) => {
      const tx = db.transaction(['imports', 'kv']);
      const kv = tx.objectStore('kv');
      const [imports, keys, values] = await Promise.all([
        request(tx.objectStore('imports').getAll()),
        request(kv.getAllKeys()),
        request(kv.getAll()),
      ]);
      return { imports, kv: keys.map((k, i) => [String(k), values[i]] as [string, unknown]) };
    });
  }

  replace(data: RawData): Promise<void> {
    return this.withDb(async (db) => {
      const tx = db.transaction(['imports', 'kv'], 'readwrite');
      const imports = tx.objectStore('imports');
      const kv = tx.objectStore('kv');
      imports.clear();
      kv.clear();
      for (const row of data.imports) imports.put(row);
      for (const [k, v] of data.kv) kv.put(v, k);
      await done(tx);
    });
  }

  putKv(key: string, value: unknown): Promise<void> {
    return this.withDb(async (db) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      await done(tx);
    });
  }
}
