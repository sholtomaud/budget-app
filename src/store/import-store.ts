import type { ImportStore, StoredImport } from '../ingest/service.ts';
import { isSealed } from './crypto.ts';
import { done, openDb, request } from './idb.ts';
import { importAad, vault } from './vault.ts';

/**
 * Imports persisted in IndexedDB, one record per import (NFR-PRIV-001). When
 * encryption is on, a record is stored as `{ record: { id }, ...sealed }`: the
 * store's key path stays readable, everything else is ciphertext.
 */
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
    const rows = await request(
      db.transaction('imports').objectStore('imports').getAll() as IDBRequest<unknown[]>
    );
    return Promise.all(rows.map((r) => fromRow(r)));
  }

  async put(i: StoredImport): Promise<void> {
    const row = await toRow(i);
    const db = await this.open();
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').put(row);
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

export async function toRow(i: StoredImport): Promise<unknown> {
  const id = i.record.id;
  const stored = await vault.toStored(i, importAad(id));
  return isSealed(stored) ? { record: { id }, ...stored } : stored;
}

export async function fromRow(row: unknown): Promise<StoredImport> {
  if (!isSealed(row)) return row as StoredImport;
  const id = (row as unknown as { record: { id: string } }).record.id;
  return vault.fromStored<StoredImport>(row, importAad(id));
}
