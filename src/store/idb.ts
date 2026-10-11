/**
 * A thin promise wrapper over IndexedDB (ADR 0007: no `idb` dependency).
 * Schema versions are declared once; each upgrade step runs in order
 * (NFR-STO-001).
 */
export const DB_NAME = 'budget-app';

type Upgrade = (db: IDBDatabase, tx: IDBTransaction) => void;

/** Upgrade steps, index i takes the database from version i to i + 1. Append only. */
export const MIGRATIONS: Upgrade[] = [
  (db) => {
    db.createObjectStore('imports', { keyPath: 'record.id' });
    db.createObjectStore('kv');
  },
];

export function openDb(name = DB_NAME, migrations = MIGRATIONS): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, migrations.length);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction!;
      for (let v = e.oldVersion; v < migrations.length; v++) migrations[v]!(db, tx);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('The database is open in another tab with an older version'));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function deleteDb(name = DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
