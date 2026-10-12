import { BaseComponent, define } from '../../core/base-component.ts';
import template from './advisor-page.html?raw';
import style from './advisor-page.css?raw';

/** The old Advisor screen: the advisor is now the chat panel (ADR 0023). This opens it. */
export class AdvisorPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    const open = () => window.dispatchEvent(new CustomEvent('app:chat-toggle', { detail: true }));
    this.$<HTMLButtonElement>('.open').onclick = open;
    open();
  }
}

define('advisor-page', AdvisorPage);
