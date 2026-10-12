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
import { restartGuide } from '../../guide.ts';
import {
  forgetKey,
  hasKey,
  loadEgressLog,
  loadProviderSettings,
  saveProviderSettings,
  setKey,
} from '../../egress.ts';
import { originAllowed } from '../../../api/providers.ts';
import { loadHistories, saveHistories } from '../../freedom-inputs.ts';
import { parsePriceHistory } from '../../../sim/history.ts';
import { el } from '../../format.ts';
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
        const name = `crux-${new Date().toISOString().slice(0, 10)}.budgetapp`;
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

    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]'))
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    this.$<HTMLButtonElement>('.show-guide').onclick = () => restartGuide();
    void this.initProviders(msg);
    void this.initHistories(msg);

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

  private async initHistories(
    msg: (card: Element, text: string, kind?: 'ok' | 'bad' | '') => void
  ): Promise<void> {
    const card = this.$('.histories');
    const form = this.$<HTMLFormElement>('.history-form');
    let list = await loadHistories();
    const render = () =>
      this.$('.history-list').replaceChildren(
        ...list.map((h) => {
          const del = el('button', { type: 'button', class: 'secondary small' }, 'Remove');
          del.onclick = async () => {
            list = list.filter((x) => x !== h);
            await saveHistories(list);
            render();
          };
          return el(
            'li',
            {},
            `${h.label}: ${h.logReturns.length} months, ${h.months[0]} to ${h.months.at(-1)} (from ${h.source.file}) `,
            del
          );
        })
      );
    render();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
      const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim();
      if (!file || !label) return;
      try {
        const h = parsePriceHistory(await file.text(), file.name, label);
        list = [...list.filter((x) => x.id !== h.id), h];
        await saveHistories(list);
        render();
        form.reset();
        msg(
          card,
          `Added ${h.label}: ${h.logReturns.length} monthly returns. Choose it on the Freedom screen.`,
          'ok'
        );
      } catch (err) {
        msg(card, err instanceof Error ? err.message : String(err), 'bad');
      }
    };
  }

  private async initProviders(
    msg: (card: Element, text: string, kind?: 'ok' | 'bad' | '') => void
  ): Promise<void> {
    const card = this.$('.providers');
    const form = this.$<HTMLFormElement>('.provider-form');
    const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement & HTMLSelectElement;
    let settings = await loadProviderSettings();
    const active = f('active');
    active.replaceChildren(
      new Option('Off', ''),
      ...settings.providers.map((p) => new Option(p.label, p.id))
    );
    active.value = settings.active ?? '';
    const fill = () => {
      const p = settings.providers.find((x) => x.id === active.value);
      for (const e of this.querySelectorAll<HTMLElement>('.p-detail')) e.hidden = !p;
      if (!p) return;
      f('endpoint').value = p.endpoint;
      f('model').value = p.model;
      f('key').value = '';
      f('key').placeholder = hasKey(p.id) ? 'Key set for this session' : 'Not stored';
    };
    active.onchange = fill;
    fill();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const p = settings.providers.find((x) => x.id === active.value);
      if (p) {
        const endpoint = f('endpoint').value.trim();
        if (!originAllowed(endpoint)) {
          msg(
            card,
            'That endpoint is not allowed. The app may only call api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, or a server on localhost.',
            'bad'
          );
          return;
        }
        p.endpoint = endpoint;
        p.model = f('model').value.trim() || p.model;
        if (f('key').value) setKey(p.id, f('key').value);
      }
      settings = { ...settings, active: active.value || null };
      await saveProviderSettings(settings);
      fill();
      msg(
        card,
        p
          ? `${p.label} is on${hasKey(p.id) ? ', with a key for this session' : '; add a key to use it'}.`
          : 'AI provider is off.',
        'ok'
      );
    };
    this.$<HTMLButtonElement>('.forget-key').onclick = () => {
      forgetKey(active.value);
      fill();
      msg(card, 'Key forgotten.', 'ok');
    };
    const log = this.$<HTMLDetailsElement>('.log');
    log.ontoggle = async () => {
      if (!log.open) return;
      const entries = (await loadEgressLog()).slice(-50).reverse();
      this.$('.egress tbody').replaceChildren(
        ...entries.map((x) =>
          el(
            'tr',
            {},
            el('td', {}, new Date(x.at).toLocaleString('en-AU')),
            el('td', {}, x.provider),
            el('td', {}, x.purpose),
            el('td', { class: 'num' }, x.bytes.toLocaleString('en-AU')),
            el('td', {}, x.status === null ? 'failed' : String(x.status)),
            el('td', { class: 'hash' }, x.sha256.slice(0, 16) + '…')
          )
        )
      );
    };
  }

  override destroy(): void {
    this.unsubscribe?.();
  }
}

define('settings-page', SettingsPage);
