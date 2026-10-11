import type { RouteDef } from './core/routes.ts';

/** Screens from SPEC §12, in nav order. Placeholders name the milestone that fills them. */
export interface Screen extends RouteDef {
  nav: string;
}

function planned(
  path: string,
  nav: string,
  title: string,
  section: string,
  milestone: string,
  summary: string
): Screen {
  return {
    path,
    nav,
    title,
    component: 'placeholder-page',
    props: { heading: title, section, milestone, summary },
  };
}

export const screens: Screen[] = [
  { path: '/', nav: 'Start', title: 'Start', component: 'start-page' },
  { path: '/import', nav: 'Import', title: 'Import', component: 'import-page' },
  { path: '/ledger', nav: 'Ledger', title: 'Ledger', component: 'ledger-page' },
  { path: '/budget', nav: 'Budget', title: 'Budget', component: 'budget-page' },
  { path: '/capex', nav: 'CAPEX', title: 'CAPEX register', component: 'capex-page' },
  { path: '/forecast', nav: 'Forecast', title: 'Forecast', component: 'forecast-page' },
  { path: '/freedom', nav: 'Freedom', title: 'Freedom', component: 'freedom-page' },
  planned(
    '/scenarios',
    'Scenarios',
    'Scenarios',
    '§11.4',
    'M6',
    'Side-by-side comparison of up to four scenarios, the optimiser and a decision diff.'
  ),
  planned(
    '/advisor',
    'Advisor',
    'Advisor',
    '§13',
    'M8',
    'Optional chat, off by default. Every figure it shows links to a simulation run.'
  ),
  planned(
    '/settings',
    'Settings',
    'Settings',
    '§12, §14',
    'M7',
    'Timezone, currency, CPI, period table, categories, rules, tax tables, return models, encryption, export and delete-all.'
  ),
  { path: '/kernel', nav: 'Kernel', title: 'Kernel check', component: 'kernel-page' },
];
