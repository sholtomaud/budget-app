/**
 * The vault: each worker's view of encryption at rest (NFR-STO-002).
 *
 * The keyring's metadata lives unencrypted in `kv:keyring`. When it exists
 * the database is encrypted: every record is written sealed with the data
 * key, and reading a sealed record needs that key. The UI unlocks with the
 * passphrase and hands the non-extractable key to each worker (`setKey`).
 * Locking terminates the workers, so no decrypted state outlives the lock.
 */
import { isSealed, LockedError, seal, unseal, type KeyringMeta } from './crypto.ts';
import { openDb, request } from './idb.ts';

export const KEYRING_KEY = 'keyring';

let key: CryptoKey | null = null;
let encrypted: Promise<boolean> | null = null;
let dbName: string | undefined;

export const vault = {
  /** Use another database (tests). */
  useDatabase(name: string | undefined): void {
    dbName = name;
    encrypted = null;
  },
  setKey(k: CryptoKey | null): void {
    key = k;
  },
  hasKey(): boolean {
    return key !== null;
  },
  /** Forget the cached mode, after encryption is turned on or off. */
  refresh(): void {
    encrypted = null;
  },
  async keyring(): Promise<KeyringMeta | null> {
    const db = await openDb(dbName);
    try {
      const v = await request(db.transaction('kv').objectStore('kv').get(KEYRING_KEY));
      return (v as KeyringMeta | undefined) ?? null;
    } finally {
      db.close();
    }
  },
  isEncrypted(): Promise<boolean> {
    encrypted ??= this.keyring().then((k) => k !== null);
    return encrypted;
  },
  /** The value as it should be stored: sealed when the database is encrypted. */
  async toStored(value: unknown, aad: string): Promise<unknown> {
    if (!(await this.isEncrypted())) return value;
    if (!key) throw new LockedError();
    return seal(key, value, aad);
  },
  async fromStored<T>(stored: unknown, aad: string): Promise<T> {
    if (!isSealed(stored)) return stored as T;
    if (!key) throw new LockedError();
    return unseal<T>(key, stored, aad);
  },
};

export const kvAad = (k: string) => `kv:${k}`;
export const importAad = (id: string) => `imports:${id}`;
