import type { ClassifyState, StateStore } from '../classify/service.ts';
import { done, openDb, request } from './idb.ts';

/** One value under one key in the `kv` object store. */
export class IdbValue<T> {
  private db: Promise<IDBDatabase> | null = null;
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  private open() {
    this.db ??= openDb();
    return this.db;
  }

  async get(): Promise<T | null> {
    const db = await this.open();
    const v = await request(db.transaction('kv').objectStore('kv').get(this.key));
    return (v as T | undefined) ?? null;
  }

  async set(value: T): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, this.key);
    await done(tx);
  }
}

export class IdbClassifyStore implements StateStore {
  private readonly v = new IdbValue<ClassifyState>('classify');
  load() {
    return this.v.get();
  }
  save(s: ClassifyState) {
    return this.v.set(s);
  }
}
