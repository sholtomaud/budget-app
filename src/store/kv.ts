import type { ClassifyState, StateStore } from '../classify/service.ts';
import type { BudgetState } from '../budget/state.ts';
import type { BudgetStore, MapperStore } from '../data/service.ts';
import type { MapperState } from '../ingest/csv/mapper.ts';
import { done, openDb, request } from './idb.ts';
import { kvAad, vault } from './vault.ts';

/** One value under one key in the `kv` object store, sealed when encryption is on. */
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
    return v === undefined ? null : vault.fromStored<T>(v, kvAad(this.key));
  }

  async set(value: T): Promise<void> {
    const stored = await vault.toStored(value, kvAad(this.key));
    const db = await this.open();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(stored, this.key);
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

export class IdbBudgetStore implements BudgetStore {
  private readonly v = new IdbValue<BudgetState>('budget');
  load() {
    return this.v.get();
  }
  save(s: BudgetState) {
    return this.v.set(s);
  }
}

export class IdbMapperStore implements MapperStore {
  private readonly v = new IdbValue<MapperState>('csv-mapper');
  load() {
    return this.v.get();
  }
  save(s: MapperState) {
    return this.v.set(s);
  }
}
