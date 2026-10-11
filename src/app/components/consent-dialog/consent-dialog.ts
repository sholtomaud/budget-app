import { BaseComponent, define } from '../../core/base-component.ts';
import template from './consent-dialog.html?raw';
import style from './consent-dialog.css?raw';

export interface ConsentRequest {
  provider: string;
  purpose: string;
  url: string;
  /** The exact request body; null for a GET (the URL is the whole request). */
  payload: unknown;
  note?: string;
}

/**
 * Per-call consent (FR-API-002): shows the exact payload before anything
 * leaves the device. One instance lives in the document (main.ts).
 */
export class ConsentDialog extends BaseComponent {
  constructor() {
    super(template, style);
  }

  ask(req: ConsentRequest): Promise<{ ok: boolean; remember: boolean }> {
    const dialog = this.$<HTMLDialogElement>('dialog');
    this.$('.provider').textContent = req.provider;
    this.$('.purpose').textContent = req.purpose;
    this.$('.url').textContent = req.url;
    this.$('.note').textContent = req.note ?? '';
    this.$('.payload').textContent =
      req.payload === null ? `GET ${req.url}` : JSON.stringify(req.payload, null, 2);
    const remember = this.$<HTMLInputElement>('input[name="remember"]');
    remember.checked = false;
    return new Promise((resolve) => {
      dialog.onclose = () =>
        resolve({ ok: dialog.returnValue === 'send', remember: remember.checked });
      dialog.returnValue = '';
      dialog.showModal();
      this.$<HTMLButtonElement>('.cancel').focus();
    });
  }
}

define('consent-dialog', ConsentDialog);

export function askConsent(req: ConsentRequest): Promise<{ ok: boolean; remember: boolean }> {
  let el = document.querySelector<ConsentDialog>('consent-dialog');
  if (!el) {
    el = document.createElement('consent-dialog') as ConsentDialog;
    document.body.append(el);
  }
  return el.ask(req);
}
