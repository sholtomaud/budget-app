/**
 * Whole-database operations (NFR-STO-002, NFR-STO-003): turning encryption
 * on and off, changing the passphrase, and the `.budgetapp` export.
 *
 * They work on a `RawDb` (rows exactly as stored, sealed or not), so they
 * run against IndexedDB in the app and against memory in tests.
 *
 * `.budgetapp` is a ZIP of two entries:
 *   - `manifest.json`: format, version, time, KDF parameters, IV (plain);
 *   - `payload.bin`: AES-GCM(gzip(encoded data)) under a key derived from
 *     the export passphrase, independent of the at-rest key.
 */
import type { StoredImport } from '../ingest/service.ts';
import { readZip, writeZip } from '../lib/zip.ts';
import { decode, encode, fromBase64, toBase64 } from './codec.ts';
import {
  createKeyring,
  isSealed,
  KDF_ITERATIONS,
  LockedError,
  passphraseKey,
  rewrapKeyring,
  seal,
  unlockKeyring,
  unseal,
  WrongPassphraseError,
  type KeyringMeta,
} from './crypto.ts';
import { importAad, KEYRING_KEY, kvAad } from './vault.ts';

export interface RawData {
  /** Rows of the `imports` store. */
  imports: unknown[];
  /** Entries of the `kv` store. */
  kv: [string, unknown][];
}

export interface RawDb {
  read(): Promise<RawData>;
  /** Replace both stores' contents in one transaction. */
  replace(data: RawData): Promise<void>;
  putKv(key: string, value: unknown): Promise<void>;
}

/** Everything the user has, decrypted. The keyring is not part of it. */
export interface PlainData {
  imports: StoredImport[];
  kv: Record<string, unknown>;
}

export const BUNDLE_FORMAT = 'budgetapp';
export const BUNDLE_VERSION = 1;
const BUNDLE_AAD = 'budgetapp:v1';

export function keyringOf(raw: RawData): KeyringMeta | null {
  return (raw.kv.find(([k]) => k === KEYRING_KEY)?.[1] as KeyringMeta | undefined) ?? null;
}

export async function openAll(raw: RawData, key: CryptoKey | null): Promise<PlainData> {
  const need = () => {
    if (!key) throw new LockedError();
    return key;
  };
  const imports = await Promise.all(
    raw.imports.map(async (row) => {
      if (!isSealed(row)) return row as StoredImport;
      const id = (row as unknown as { record: { id: string } }).record.id;
      return unseal<StoredImport>(need(), row, importAad(id));
    })
  );
  const kv: Record<string, unknown> = {};
  for (const [k, v] of raw.kv) {
    if (k === KEYRING_KEY) continue;
    kv[k] = isSealed(v) ? await unseal(need(), v, kvAad(k)) : v;
  }
  return { imports, kv };
}

export async function sealAll(
  plain: PlainData,
  key: CryptoKey | null,
  keyring: KeyringMeta | null
): Promise<RawData> {
  const imports = await Promise.all(
    plain.imports.map(async (i) =>
      key ? { record: { id: i.record.id }, ...(await seal(key, i, importAad(i.record.id))) } : i
    )
  );
  const kv: [string, unknown][] = await Promise.all(
    Object.entries(plain.kv).map(async ([k, v]): Promise<[string, unknown]> => [
      k,
      key ? await seal(key, v, kvAad(k)) : v,
    ])
  );
  if (keyring) kv.push([KEYRING_KEY, keyring]);
  return { imports, kv };
}

/** Encrypt everything under a new passphrase. Returns the data key for this session. */
export async function enableEncryption(
  db: RawDb,
  passphrase: string,
  iterations = KDF_ITERATIONS
): Promise<CryptoKey> {
  const raw = await db.read();
  if (keyringOf(raw)) throw new Error('Encryption is already on');
  const plain = await openAll(raw, null);
  const { meta, key } = await createKeyring(passphrase, iterations);
  await db.replace(await sealAll(plain, key, meta));
  return key;
}

export async function changePassphrase(db: RawDb, oldPass: string, newPass: string): Promise<void> {
  const meta = keyringOf(await db.read());
  if (!meta) throw new Error('Encryption is off');
  await db.putKv(KEYRING_KEY, await rewrapKeyring(meta, oldPass, newPass));
}

/** Decrypt everything and remove the keyring. Needs the passphrase, not just an open session. */
export async function disableEncryption(db: RawDb, passphrase: string): Promise<void> {
  const raw = await db.read();
  const meta = keyringOf(raw);
  if (!meta) return;
  const key = await unlockKeyring(meta, passphrase);
  await db.replace(await sealAll(await openAll(raw, key), null, null));
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

interface Manifest {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  kdf: { name: 'PBKDF2-SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  compression: 'gzip';
  counts: { imports: number; kv: number };
}

/** Export everything as a `.budgetapp` file, encrypted with `passphrase`. */
export async function exportBundle(
  db: RawDb,
  key: CryptoKey | null,
  passphrase: string,
  iterations = KDF_ITERATIONS
): Promise<Uint8Array> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters');
  const plain = await openAll(await db.read(), key);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await passphraseKey(passphrase, salt, iterations);
  const packed = await gzip(new TextEncoder().encode(encode(plain)));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(BUNDLE_AAD) },
      k,
      packed as Uint8Array<ArrayBuffer>
    )
  );
  const manifest: Manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2-SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    compression: 'gzip',
    counts: { imports: plain.imports.length, kv: Object.keys(plain.kv).length },
  };
  return writeZip([
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { name: 'payload.bin', data: ct },
  ]);
}

/** Read a `.budgetapp` file. Throws WrongPassphraseError on a wrong passphrase or a damaged file. */
export async function readBundle(bytes: Uint8Array, passphrase: string): Promise<PlainData> {
  const entries = await readZip(bytes);
  const m = entries.find((e) => e.name === 'manifest.json');
  const p = entries.find((e) => e.name === 'payload.bin');
  if (!m || !p) throw new Error('Not a .budgetapp file');
  const manifest = JSON.parse(new TextDecoder().decode(m.data)) as Manifest;
  if (manifest.format !== BUNDLE_FORMAT) throw new Error('Not a .budgetapp file');
  if (manifest.version > BUNDLE_VERSION)
    throw new Error(`This file is from a newer version of the app (format ${manifest.version})`);
  const k = await passphraseKey(passphrase, fromBase64(manifest.kdf.salt), manifest.kdf.iterations);
  let packed: Uint8Array;
  try {
    packed = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(manifest.cipher.iv) as Uint8Array<ArrayBuffer>,
          additionalData: new TextEncoder().encode(BUNDLE_AAD),
        },
        k,
        p.data as Uint8Array<ArrayBuffer>
      )
    );
  } catch {
    throw new WrongPassphraseError();
  }
  const plain = decode<PlainData>(new TextDecoder().decode(await gunzip(packed)));
  if (!Array.isArray(plain.imports) || typeof plain.kv !== 'object')
    throw new Error('The file is damaged');
  return plain;
}

/**
 * Replace everything with a bundle's contents. The database keeps its own
 * encryption state: if it is encrypted, the imported records are sealed
 * with the current key.
 */
export async function importBundle(
  db: RawDb,
  bytes: Uint8Array,
  passphrase: string,
  key: CryptoKey | null
): Promise<PlainData> {
  const plain = await readBundle(bytes, passphrase);
  const keyring = keyringOf(await db.read());
  if (keyring && !key) throw new LockedError();
  await db.replace(await sealAll(plain, keyring ? key : null, keyring));
  return plain;
}

export class MemoryRawDb implements RawDb {
  data: RawData = { imports: [], kv: [] };
  async read(): Promise<RawData> {
    return structuredClone(this.data);
  }
  async replace(d: RawData): Promise<void> {
    this.data = structuredClone(d);
  }
  async putKv(k: string, v: unknown): Promise<void> {
    this.data.kv = [...this.data.kv.filter(([x]) => x !== k), [k, structuredClone(v)]];
  }
}
