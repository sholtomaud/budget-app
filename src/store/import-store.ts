import type { ImportStore, StoredImport } from '../ingest/service.ts';
import { done, openDb, request } from './idb.ts';

/** Imports persisted in IndexedDB, one record per import (NFR-PRIV-001). */
export class IdbImportStore implements ImportStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly name: string | undefined;

  constructor(name?: string) {
    this.name = name;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= openDb(this.name);
    return this.db;
  }

  async all(): Promise<StoredImport[]> {
    const db = await this.open();
    return request(
      db.transaction('imports').objectStore('imports').getAll() as IDBRequest<StoredImport[]>
    );
  }

  async put(i: StoredImport): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').put(i);
    await done(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').delete(id);
    await done(tx);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').clear();
    await done(tx);
  }
}
