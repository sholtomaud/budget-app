/**
 * Encryption at rest, from the UI's side (NFR-STO-002). The ingest worker
 * owns the keyring; this module tracks whether the data is plain, locked or
 * unlocked, hands the data key to the sim worker, and locks after idle.
 * Locking reloads the page: every worker and every rendered screen holding
 * decrypted data is discarded.
 */
import { Store } from './core/store.ts';
import { ingest, sim } from './workers.ts';

export type VaultState = 'checking' | 'plain' | 'locked' | 'unlocked';

export const vaultStore = new Store<{ state: VaultState }>({ state: 'checking' });

const AUTOLOCK_KEY = 'budget-app:autolock-minutes';
export const DEFAULT_AUTOLOCK_MINUTES = 15;

let resolveReady: () => void = () => {};
const ready = new Promise<void>((r) => (resolveReady = r));

/** Resolves once data can be read: at once if encryption is off, after unlock if it is on. */
export function whenReady(): Promise<void> {
  return ready;
}

export async function initVault(): Promise<void> {
  const s = await ingest().vaultStatus();
  if (!s.encrypted) {
    vaultStore.setState({ state: 'plain' });
    resolveReady();
  } else {
    vaultStore.setState({ state: 'locked' });
  }
}

export async function unlock(passphrase: string): Promise<void> {
  const key = await ingest().unlock(passphrase);
  await sim().setKey(key);
  vaultStore.setState({ state: 'unlocked' });
  resolveReady();
  startIdleTimer();
}

export async function enableEncryption(passphrase: string): Promise<void> {
  const key = await ingest().enableEncryption(passphrase);
  await sim().setKey(key);
  vaultStore.setState({ state: 'unlocked' });
  startIdleTimer();
}

export async function disableEncryption(passphrase: string): Promise<void> {
  await ingest().disableEncryption(passphrase);
  await sim().setKey(null);
  vaultStore.setState({ state: 'plain' });
  stopIdleTimer();
}

export const changePassphrase = (oldPassphrase: string, newPassphrase: string) =>
  ingest().changePassphrase(oldPassphrase, newPassphrase);

/** Lock now: forget the key everywhere by reloading the app. */
export function lock(): void {
  location.reload();
}

export function autolockMinutes(): number {
  try {
    const v = Number(localStorage.getItem(AUTOLOCK_KEY));
    return v > 0 ? v : DEFAULT_AUTOLOCK_MINUTES;
  } catch {
    return DEFAULT_AUTOLOCK_MINUTES;
  }
}

export function setAutolockMinutes(m: number): void {
  try {
    localStorage.setItem(AUTOLOCK_KEY, String(m));
  } catch {
    // Private mode: the default applies.
  }
  if (vaultStore.getState().state === 'unlocked') startIdleTimer();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const reset = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(lock, autolockMinutes() * 60_000);
};

function startIdleTimer(): void {
  if (!listening) {
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
      window.addEventListener(ev, reset, { passive: true });
    listening = true;
  }
  reset();
}

function stopIdleTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
