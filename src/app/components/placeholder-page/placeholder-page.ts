import { BaseComponent, define } from '../../core/base-component.ts';
import template from './placeholder-page.html?raw';
import style from './placeholder-page.css?raw';

/** A screen from SPEC §12 that a later milestone fills in. */
export class PlaceholderPage extends BaseComponent {
  heading = '';
  section = '';
  milestone = '';
  summary = '';

  constructor() {
    super(template, style);
  }

  override init(): void {
    this.$('.heading').textContent = this.heading;
    this.$('.summary').textContent = this.summary;
    this.$('.section').textContent = this.section;
    this.$('.milestone').textContent = this.milestone;
  }
}

define('placeholder-page', PlaceholderPage);
