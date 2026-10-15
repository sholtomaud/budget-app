/**
 * Profile (ADR 0043): a rough age and a country, how long to plan for, and
 * the timeline that follows: years left to work and years to fund.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { el, prov } from '../../format.ts';
import { applyProfile, loadProfile, saveProfile, today } from '../../profile.ts';
import { SETUP_CHANGED } from '../../proposals.ts';
import { sim } from '../../workers.ts';
import {
  COUNTRIES,
  PLAN_FOR,
  ageNow,
  countryFigures,
  planAge,
  yearsOfFreedom,
  type PersonAge,
  type PlanFor,
  type Profile,
  type Sex,
} from '../../../profile/lifespan.ts';
import template from './profile-page.html?raw';
import style from './profile-page.css?raw';

const monthYear = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export class ProfilePage extends BaseComponent {
  private profile: Profile | null = null;
  private readonly onSetup = () => void this.renderTimeline();

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]'))
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    const form = this.$<HTMLFormElement>('.profile');
    form.onsubmit = (e) => e.preventDefault();
    const country = this.f<HTMLSelectElement>('country');
    country.append(
      new Option('Choose…', ''),
      ...COUNTRIES.map((c) => new Option(c.name, c.code)),
      new Option('Somewhere else (enter its figures)', 'other')
    );
    const fs = this.$('.plan-for');
    for (const [id, x] of Object.entries(PLAN_FOR))
      fs.append(
        el(
          'label',
          {},
          el('input', { type: 'radio', name: 'planFor', value: id }),
          ` ${x.label}${id === 'quarter' ? ' (suggested)' : ''}`
        )
      );
    form.onchange = () => void this.read();
    window.addEventListener(SETUP_CHANGED, this.onSetup);
    void this.load();
  }

  override destroy(): void {
    window.removeEventListener(SETUP_CHANGED, this.onSetup);
  }

  private f<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
    return this.$<HTMLFormElement>('.profile').elements.namedItem(name) as T;
  }

  private async load(): Promise<void> {
    this.profile = await loadProfile();
    const p = this.profile;
    this.f('country').value = p.country ?? '';
    this.f('age').value = p.you ? String(ageNow(p.you, today())) : '';
    this.f('sex').value = p.you?.sex ?? 'unspecified';
    this.f('ownMale').value = p.own ? String(p.own.male) : '';
    this.f('ownFemale').value = p.own ? String(p.own.female) : '';
    this.f<HTMLInputElement>('hasPartner').checked = !!p.partner;
    this.f('partnerAge').value = p.partner ? String(ageNow(p.partner, today())) : '';
    this.f('partnerSex').value = p.partner?.sex ?? 'unspecified';
    for (const r of this.querySelectorAll<HTMLInputElement>('input[name="planFor"]'))
      r.checked = r.value === p.planFor;
    this.f<HTMLInputElement>('setsHorizon').checked = p.setsHorizon;
    this.render();
    await this.renderTimeline();
  }

  /** Form → profile, saved; the plan's length follows if the profile sets it. */
  private async read(): Promise<void> {
    const before = this.profile;
    if (!before) return;
    const num = (n: string) => Number(this.f(n).value);
    const age = (n: string, sex: string, was?: PersonAge): PersonAge | undefined => {
      const years = Math.round(num(n));
      if (!this.f(n).value || !(years >= 16 && years <= 110)) return undefined;
      // An unchanged age keeps its date, so it keeps moving on by itself.
      const keep = was && ageNow(was, today()) === years;
      return {
        years: keep ? was.years : years,
        asOf: keep ? was.asOf : today(),
        sex: this.f(sex).value as Sex,
      };
    };
    const country = this.f('country').value || undefined;
    const you = age('age', 'sex', before.you);
    const partner = this.f<HTMLInputElement>('hasPartner').checked
      ? age('partnerAge', 'partnerSex', before.partner)
      : undefined;
    const planFor = (this.querySelector<HTMLInputElement>('input[name="planFor"]:checked')?.value ??
      'quarter') as PlanFor;
    const p: Profile = {
      planFor,
      setsHorizon: this.f<HTMLInputElement>('setsHorizon').checked,
      ...(country ? { country } : {}),
      ...(country
        ? { countryFrom: country === before.country ? (before.countryFrom ?? 'you') : 'you' }
        : {}),
      ...(country === 'other' && num('ownMale') > 0 && num('ownFemale') > 0
        ? { own: { male: num('ownMale'), female: num('ownFemale') } }
        : {}),
      ...(you ? { you } : {}),
      ...(partner ? { partner } : {}),
    };
    this.profile = p;
    this.render();
    await saveProfile(p);
    await applyProfile(p);
    await this.renderTimeline();
  }

  private render(): void {
    const p = this.profile!;
    const c = COUNTRIES.find((x) => x.code === p.country);
    this.$('.own').hidden = p.country !== 'other';
    this.$('.partner').hidden = !this.f<HTMLInputElement>('hasPartner').checked;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.$('.country-note').textContent =
      p.countryFrom === 'device' && c
        ? `Set from this device's time zone and language (${zone}). Nothing was looked up online: your address is never sent anywhere. Change it if it's wrong.`
        : p.country
          ? ''
          : `Your country isn't in Crux's life table yet (this device is set to ${zone}). Choose the nearest, or Somewhere else and enter its figures.`;
    const plan = planAge(p, today());
    const result = this.$('.result');
    const explain = this.$('.explain');
    if (!plan) {
      result.textContent = !p.you
        ? 'Enter your age to see how long to plan for.'
        : 'Choose a country (or enter its figures) to see how long to plan for.';
      explain.replaceChildren();
      return;
    }
    const share = PLAN_FOR[p.planFor].share;
    result.replaceChildren('Plan to age ', el('strong', {}, String(plan.planTo)));
    explain.replaceChildren(
      `${p.partner ? 'For the two of you, the last one' : 'People your age'} typically live${p.partner ? 's' : ''} to about ${plan.typical}. `,
      share < 0.5
        ? p.partner
          ? `About 1 time in ${Math.round(1 / share)}, one of you is still alive at ${plan.planTo}. `
          : `About 1 in ${Math.round(1 / share)} people like you are still alive at ${plan.planTo}. `
        : 'Half live longer than that, so this is the least to plan for. ',
      'From ',
      countryFigures(p)!.source,
      ', with a Gompertz curve for the spread of ages ',
      prov(plan.provenance),
      '.'
    );
  }

  private async renderTimeline(): Promise<void> {
    const p = this.profile;
    const card = this.$('.timeline');
    const setup = await sim().loadSetup();
    const plan = p && planAge(p, today());
    if (!p || !plan) {
      card.hidden = true;
      return;
    }
    const row = (k: string, v: string) => [el('dt', {}, k), el('dd', {}, v)];
    card.hidden = false;
    if (!setup) {
      this.$('.facts').replaceChildren(
        ...row('Age now', String(plan.ageNow)),
        ...row('Plan to age', String(plan.planTo)),
        ...row('Freedom starts', 'not set yet: open Freedom to choose when')
      );
      return;
    }
    const start = setup.goal.start;
    const fund = yearsOfFreedom(plan, today(), start);
    const ageAtStart = plan.planTo - fund;
    const work = Math.max(0, ageAtStart - plan.ageNow);
    this.$('.facts').replaceChildren(
      ...row('Age now', String(plan.ageNow)),
      ...row('Freedom starts', `${monthYear(start)}, at about ${ageAtStart}`),
      ...row('Years left to work', work ? String(work) : 'none: freedom is now'),
      ...row('Years to fund', `${fund}, to age ${plan.planTo}`),
      ...row(
        "Freedom plan's years of freedom",
        p.setsHorizon
          ? `${setup.goal.horizonYears} (set from this profile)`
          : `${setup.goal.horizonYears} (set by hand on Freedom)`
      )
    );
  }
}

define('profile-page', ProfilePage);
