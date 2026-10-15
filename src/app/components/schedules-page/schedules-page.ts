/**
 * Schedules (ADR 0041): add, change, pause, run now and remove the things
 * Crux does on its own; whether they may call the AI; notifications.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { dateTime, el } from '../../format.ts';
import {
  loadSchedules,
  removeSchedule,
  runSchedule,
  saveSchedules,
  SCHEDULES_CHANGED,
  type ScheduleState,
} from '../../schedules.ts';
import {
  ACTION_INFO,
  ACTIONS,
  checkSchedule,
  nextRun,
  PRESETS,
  WEEKDAYS,
  whenText,
  type Action,
  type Every,
  type Schedule,
} from '../../../sched/schedule.ts';
import template from './schedules-page.html?raw';
import style from './schedules-page.css?raw';

export class SchedulesPage extends BaseComponent {
  private state: ScheduleState = { list: [], allowAI: false, notify: false };
  private readonly onChanged = () => void this.load();

  constructor() {
    super(template, style);
  }

  override init(): void {
    const form = this.$<HTMLFormElement>('.add');
    const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement & HTMLSelectElement;
    f('action').replaceChildren(...ACTIONS.map((a) => new Option(ACTION_INFO[a].label, a)));
    f('weekday').replaceChildren(
      ...WEEKDAYS.map((d, i) => new Option(d, String(i), false, i === 1))
    );
    const shape = () => {
      this.$('.weekday').hidden = f('every').value !== 'week';
      this.$('.monthday').hidden = f('every').value !== 'month';
      this.$('.note').hidden = f('action').value !== 'reminder';
    };
    form.onchange = shape;
    shape();
    form.onsubmit = (e) => {
      e.preventDefault();
      void this.save(form);
    };
    this.$<HTMLButtonElement>('.cancel').onclick = () => this.resetForm();
    this.$('.presets').replaceChildren(
      'Ready-made: ',
      ...PRESETS.map((p) => {
        const b = el('button', { type: 'button', class: 'secondary small' }, p.name);
        b.onclick = () => void this.add({ ...p });
        return b;
      })
    );
    this.$<HTMLInputElement>('.allow-ai').onchange = (e) =>
      void this.saveState({ ...this.state, allowAI: (e.target as HTMLInputElement).checked });
    this.$<HTMLInputElement>('.notify').onchange = async (e) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on && 'Notification' in window && Notification.permission === 'default')
        await Notification.requestPermission();
      await this.saveState({ ...this.state, notify: on });
    };
    window.addEventListener(SCHEDULES_CHANGED, this.onChanged);
    void this.load();
  }

  override destroy(): void {
    window.removeEventListener(SCHEDULES_CHANGED, this.onChanged);
  }

  private async load(): Promise<void> {
    this.state = await loadSchedules();
    this.render();
  }

  private async saveState(s: ScheduleState): Promise<void> {
    this.state = s;
    await saveSchedules(s);
  }

  private render(): void {
    const s = this.state;
    this.$<HTMLInputElement>('.allow-ai').checked = s.allowAI;
    this.$<HTMLInputElement>('.notify').checked = s.notify;
    this.$('.notify-status').textContent = !('Notification' in window)
      ? 'This browser has no notifications.'
      : s.notify && Notification.permission === 'denied'
        ? 'Notifications are blocked for this site in the browser settings.'
        : '';
    this.$('.empty').hidden = s.list.length > 0;
    this.$('.list').replaceChildren(...s.list.map((x) => this.item(x)));
  }

  private item(x: Schedule): HTMLElement {
    const info = ACTION_INFO[x.action];
    const toggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
    toggle.checked = x.enabled;
    toggle.onchange = () =>
      void this.saveState({
        ...this.state,
        list: this.state.list.map((s) => (s.id === x.id ? { ...s, enabled: toggle.checked } : s)),
      });
    const button = (text: string, label: string, on: () => void) => {
      const b = el('button', { type: 'button', class: 'secondary small' }, text);
      b.setAttribute('aria-label', `${label} “${x.name}”`);
      b.onclick = on;
      return b;
    };
    const status = el('span', { class: 'meta', role: 'status' });
    return el(
      'li',
      { class: x.enabled ? '' : 'off', 'data-id': x.id },
      el(
        'div',
        { class: 'head' },
        el('span', { class: 'name' }, x.name),
        el('span', { class: 'meta' }, whenText(x)),
        info.ai ? el('span', { class: 'tag' }, 'uses the AI') : null,
        x.createdBy === 'ai' ? el('span', { class: 'tag' }, 'set up by the AI') : null
      ),
      el(
        'p',
        { class: 'meta' },
        x.action === 'reminder'
          ? `Reminds you: ${x.note ?? ''}`
          : `Asks the chat: “${info.question}”`
      ),
      el(
        'p',
        { class: 'meta' },
        x.enabled
          ? `Next: ${dateTime(nextRun(x, new Date(Math.max(Date.now(), Date.parse(x.lastRun ?? x.createdAt)))).toISOString())}.`
          : 'Paused.',
        x.lastRun ? ` Last: ${dateTime(x.lastRun)}, ${x.lastResult ?? ''}` : ' Not run yet.'
      ),
      el(
        'div',
        { class: 'controls' },
        el('label', { class: 'check' }, toggle, ' On'),
        button('Run now', 'Run now:', () => {
          status.textContent = 'Running…';
          void runSchedule(x, this.state).then((r) => (status.textContent = r));
        }),
        button('Edit', 'Edit', () => this.edit(x)),
        button('Delete', 'Delete', () => void removeSchedule(x.id)),
        status
      )
    );
  }

  private formValues(form: HTMLFormElement): Partial<Schedule> {
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
    const every = v('every') as Every;
    const action = v('action') as Action;
    return {
      name: v('name').trim(),
      action,
      every,
      at: v('at'),
      ...(every === 'week' ? { weekday: Number(v('weekday')) } : {}),
      ...(every === 'month' ? { monthday: Number(v('monthday')) } : {}),
      ...(action === 'reminder' ? { note: v('note').trim() } : {}),
    };
  }

  private async save(form: HTMLFormElement): Promise<void> {
    const id = (form.elements.namedItem('id') as HTMLInputElement).value;
    const values = this.formValues(form);
    const out = this.$('.form-status');
    const bad = checkSchedule(values);
    if (bad) {
      out.textContent = bad;
      return;
    }
    if (id) {
      await this.saveState({
        ...this.state,
        list: this.state.list.map((s) => {
          if (s.id !== id) return s;
          const { weekday: _w, monthday: _m, note: _n, ...rest } = s;
          return { ...rest, ...values } as Schedule;
        }),
      });
      out.textContent = 'Saved.';
    } else await this.add(values);
    this.resetForm();
  }

  private async add(values: Partial<Schedule>): Promise<void> {
    const s: Schedule = {
      ...(values as Omit<Schedule, 'id' | 'createdAt' | 'createdBy' | 'enabled'>),
      enabled: values.enabled ?? true,
      id: `sched-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      createdBy: 'you',
      createdAt: new Date().toISOString(),
    };
    await this.saveState({ ...this.state, list: [...this.state.list, s] });
    this.$('.form-status').textContent = `Added “${s.name}”.`;
  }

  private edit(x: Schedule): void {
    const form = this.$<HTMLFormElement>('.add');
    const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    f('id').value = x.id;
    f('name').value = x.name;
    f('action').value = x.action;
    f('every').value = x.every;
    f('at').value = x.at;
    f('weekday').value = String(x.weekday ?? 1);
    f('monthday').value = String(x.monthday ?? 1);
    f('note').value = x.note ?? '';
    form.dispatchEvent(new Event('change'));
    this.$('.save').textContent = 'Save changes';
    this.$<HTMLButtonElement>('.cancel').hidden = false;
    f('name').focus();
  }

  private resetForm(): void {
    const form = this.$<HTMLFormElement>('.add');
    form.reset();
    (form.elements.namedItem('id') as HTMLInputElement).value = '';
    form.dispatchEvent(new Event('change'));
    this.$('.save').textContent = 'Add schedule';
    this.$<HTMLButtonElement>('.cancel').hidden = true;
  }
}

define('schedules-page', SchedulesPage);
