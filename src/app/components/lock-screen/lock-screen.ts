import { BaseComponent, define } from '../../core/base-component.ts';
import { deleteAllData } from '../../delete-all.ts';
import { unlock, vaultStore } from '../../vault.ts';
import template from './lock-screen.html?raw';
import style from './lock-screen.css?raw';

/** Covers the app while encrypted data is locked (NFR-STO-002). */
export class LockScreen extends BaseComponent {
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    const form = this.$<HTMLFormElement>('.dialog');
    const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = this.$<HTMLButtonElement>('.unlock');
      button.disabled = true;
      this.$('.error').textContent = '';
      try {
        await unlock(field('passphrase').value);
        field('passphrase').value = '';
      } catch (err) {
        this.$('.error').textContent =
          err instanceof Error && err.name === 'WrongPassphraseError'
            ? 'That passphrase is not right.'
            : `Could not unlock: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        button.disabled = false;
      }
    };
    this.$<HTMLButtonElement>('.wipe').onclick = async () => {
      if (field('confirm').value.trim() !== 'DELETE') {
        this.$('.error').textContent = 'Type DELETE to confirm.';
        return;
      }
      await deleteAllData();
      location.href = import.meta.env.BASE_URL;
    };
    const show = () => {
      const locked = vaultStore.getState().state === 'locked';
      this.$('.backdrop').hidden = !locked;
      if (locked) field('passphrase').focus();
    };
    this.unsubscribe = vaultStore.subscribe(show);
    show();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }
}

define('lock-screen', LockScreen);
