/**
 * Encryption at rest (NFR-STO-002) and for exports (NFR-STO-003), on
 * WebCrypto only.
 *
 * A random 256-bit data key (DEK) encrypts every record with AES-GCM; the
 * record's store and key are bound in as additional data, so a ciphertext
 * cannot be moved to another record. The DEK is wrapped by a key derived
 * from the passphrase with PBKDF2-SHA-256 (600 000 iterations), so changing
 * the passphrase re-wraps one key instead of re-encrypting everything. The
 * unwrapped DEK is non-extractable.
 */
import { decode, encode, fromBase64, toBase64 } from './codec.ts';

export const KDF_ITERATIONS = 600_000;

export interface KeyringMeta {
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  wrapIv: string;
  /** The DEK, AES-GCM encrypted under the passphrase key. */
  wrapped: string;
  createdAt: string;
}

/** A sealed (encrypted) record as stored. */
export interface Sealed {
  $sealed: 1;
  iv: string;
  ct: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase');
    this.name = 'WrongPassphraseError';
  }
}

export class LockedError extends Error {
  constructor() {
    super('Your data is encrypted and locked. Unlock it with your passphrase.');
    this.name = 'LockedError';
  }
}

export const isSealed = (v: unknown): v is Sealed =>
  !!v && typeof v === 'object' && (v as Sealed).$sealed === 1;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** WebCrypto wants ArrayBuffer-backed views. */
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

export async function passphraseKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const importDek = (raw: Uint8Array) =>
  subtle().importKey('raw', buf(raw), { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

async function wrap(raw: Uint8Array, passphrase: string, iterations: number) {
  const salt = random(16);
  const iv = random(12);
  const kek = await passphraseKey(passphrase, salt, iterations);
  const wrapped = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv) }, kek, buf(raw))
  );
  return { salt: toBase64(salt), wrapIv: toBase64(iv), wrapped: toBase64(wrapped) };
}

async function unwrapRaw(meta: KeyringMeta, passphrase: string): Promise<Uint8Array> {
  const kek = await passphraseKey(passphrase, fromBase64(meta.salt), meta.iterations);
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: buf(fromBase64(meta.wrapIv)) },
        kek,
        buf(fromBase64(meta.wrapped))
      )
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

/** A new keyring for `passphrase`: its stored metadata and the usable data key. */
export async function createKeyring(
  passphrase: string,
  iterations = KDF_ITERATIONS
): Promise<{ meta: KeyringMeta; key: CryptoKey }> {
  const raw = random(32);
  const w = await wrap(raw, passphrase, iterations);
  const key = await importDek(raw);
  raw.fill(0);
  return {
    meta: { v: 1, kdf: 'PBKDF2-SHA-256', iterations, ...w, createdAt: new Date().toISOString() },
    key,
  };
}

export async function unlockKeyring(meta: KeyringMeta, passphrase: string): Promise<CryptoKey> {
  const raw = await unwrapRaw(meta, passphrase);
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

/** Re-wrap the same data key under a new passphrase; records are untouched. */
export async function rewrapKeyring(
  meta: KeyringMeta,
  oldPassphrase: string,
  newPassphrase: string
): Promise<KeyringMeta> {
  const raw = await unwrapRaw(meta, oldPassphrase);
  try {
    return { ...meta, ...(await wrap(raw, newPassphrase, meta.iterations)) };
  } finally {
    raw.fill(0);
  }
}

export async function seal(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const iv = random(12);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: enc.encode(aad) },
    key,
    enc.encode(encode(value))
  );
  return { $sealed: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function unseal<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: buf(fromBase64(sealed.iv)), additionalData: enc.encode(aad) },
    key,
    buf(fromBase64(sealed.ct))
  );
  return decode<T>(dec.decode(pt));
}
