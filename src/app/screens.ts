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
  { path: '/scenarios', nav: 'Scenarios', title: 'Scenarios', component: 'scenarios-page' },
  planned(
    '/advisor',
    'Advisor',
    'Advisor',
    '§13',
    'M8',
    'Optional chat, off by default. Every figure it shows links to a simulation run.'
  ),
  { path: '/settings', nav: 'Settings', title: 'Settings', component: 'settings-page' },
  { path: '/kernel', nav: 'Kernel', title: 'Kernel check', component: 'kernel-page' },
];
