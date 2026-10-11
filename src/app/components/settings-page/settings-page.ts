import { BaseComponent, define } from '../../core/base-component.ts';
import { deleteAllData } from '../../delete-all.ts';
import { ensureLoaded } from '../../data.ts';
import {
  autolockMinutes,
  changePassphrase,
  disableEncryption,
  enableEncryption,
  lock,
  setAutolockMinutes,
  vaultStore,
} from '../../vault.ts';
import { ingest } from '../../workers.ts';
import template from './settings-page.html?raw';
import style from './settings-page.css?raw';

const MIN = 8;
const field = (f: HTMLFormElement, n: string) => f.elements.namedItem(n) as HTMLInputElement;
const errText = (err: unknown) =>
  err instanceof Error && err.name === 'WrongPassphraseError'
    ? 'That passphrase is not right.'
    : err instanceof Error
      ? err.message
      : String(err);

export class SettingsPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    const enc = this.$('.encryption');
    const msg = (card: Element, text: string, kind: 'ok' | 'bad' | '' = '') => {
      const m = card.querySelector('.msg')!;
      m.textContent = text;
      m.className = `msg ${kind}`;
    };
    const twice = (f: HTMLFormElement): string | null => {
      const a = field(f, 'p1').value;
      if (a.length < MIN) return null;
      return a === field(f, 'p2').value ? a : null;
    };
    const busy = async (f: HTMLFormElement, fn: () => Promise<void>) => {
      const b = f.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      b.disabled = true;
      try {
        await fn();
        f.reset();
      } finally {
        b.disabled = false;
      }
    };

    const enable = this.$<HTMLFormElement>('.enable');
    enable.onsubmit = (e) => {
      e.preventDefault();
      const p = twice(enable);
      if (!p) return msg(enc, `Passphrases must match and be at least ${MIN} characters.`, 'bad');
      msg(enc, 'Encrypting…');
      void busy(enable, async () => {
        await enableEncryption(p);
        msg(enc, 'Encryption is on. Everything on this device is now encrypted.', 'ok');
      }).catch((err) => msg(enc, errText(err), 'bad'));
    };
    const change = this.$<HTMLFormElement>('.change');
    change.onsubmit = (e) => {
      e.preventDefault();
      const p = twice(change);
      if (!p)
        return msg(enc, `New passphrases must match and be at least ${MIN} characters.`, 'bad');
      void busy(change, async () => {
        await changePassphrase(field(change, 'old').value, p);
        msg(enc, 'Passphrase changed.', 'ok');
      }).catch((err) => msg(enc, errText(err), 'bad'));
    };
    const disable = this.$<HTMLFormElement>('.disable');
    disable.onsubmit = (e) => {
      e.preventDefault();
      void busy(disable, async () => {
        await disableEncryption(field(disable, 'old').value);
        msg(enc, 'Encryption is off. Data on this device is stored unencrypted.', 'ok');
      }).catch((err) => msg(enc, errText(err), 'bad'));
    };
    this.$<HTMLButtonElement>('.lock-now').onclick = () => lock();
    const auto = this.$<HTMLSelectElement>('select[name="autolock"]');
    auto.value = String(autolockMinutes());
    auto.onchange = () => setAutolockMinutes(Number(auto.value));

    const exp = this.$<HTMLFormElement>('.export-form');
    exp.onsubmit = (e) => {
      e.preventDefault();
      const card = this.$('.export');
      const p = twice(exp);
      if (!p) return msg(card, `Passphrases must match and be at least ${MIN} characters.`, 'bad');
      msg(card, 'Exporting…');
      void busy(exp, async () => {
        const bytes = await ingest().exportAll(p);
        const name = `budget-app-${new Date().toISOString().slice(0, 10)}.budgetapp`;
        const url = URL.createObjectURL(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        msg(
          card,
          `Saved ${name} (${(bytes.length / 1024).toFixed(0)} kB). Keep its passphrase safe.`,
          'ok'
        );
      }).catch((err) => msg(card, errText(err), 'bad'));
    };

    const imp = this.$<HTMLFormElement>('.import-form');
    imp.onsubmit = (e) => {
      e.preventDefault();
      const card = this.$('.import');
      const file = field(imp, 'file').files?.[0];
      if (!file) return;
      msg(card, 'Importing…');
      void busy(imp, async () => {
        const r = await ingest().importAll(
          new Uint8Array(await file.arrayBuffer()),
          field(imp, 'p').value
        );
        msg(card, `Restored ${r.imports} imports. Reloading…`, 'ok');
        setTimeout(() => location.reload(), 600);
      }).catch((err) => msg(card, errText(err), 'bad'));
    };

    const del = this.$<HTMLFormElement>('.delete-form');
    del.onsubmit = (e) => {
      e.preventDefault();
      const card = this.$('.danger');
      if (field(del, 'confirm').value.trim() !== 'DELETE')
        return msg(card, 'Type DELETE to confirm.', 'bad');
      msg(card, 'Deleting…');
      void deleteAllData()
        .then(() => (location.href = import.meta.env.BASE_URL))
        .catch((err) => msg(card, errText(err), 'bad'));
    };

    const render = () => {
      const s = vaultStore.getState().state;
      this.$('.status').textContent =
        s === 'plain'
          ? 'Off. Data on this device is stored unencrypted, like most browser data.'
          : s === 'unlocked'
            ? 'On, and unlocked for this session.'
            : s === 'locked'
              ? 'On, and locked.'
              : 'Checking…';
      enable.hidden = s !== 'plain';
      this.$('.manage').hidden = s !== 'unlocked';
    };
    this.unsubscribe = vaultStore.subscribe(render);
    render();
    void ensureLoaded();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }
}

define('settings-page', SettingsPage);
