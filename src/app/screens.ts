import type { RouteDef } from './core/routes.ts';

/** Screens from SPEC §12, in nav order. */
export interface Screen extends RouteDef {
  nav: string;
  /** Reachable by URL and from other screens, but not listed in the nav. */
  hidden?: boolean;
}

export const screens: Screen[] = [
  { path: '/', nav: 'Start', title: 'Start', component: 'start-page' },
  // The chat screen sits beside Start until it proves itself (ADR 0027).
  { path: '/chat', nav: 'Set up', title: 'Set up Crux', component: 'chat-page' },
  { path: '/import', nav: 'Import', title: 'Import', component: 'import-page' },
  { path: '/ledger', nav: 'Transactions', title: 'Transactions', component: 'ledger-page' },
  { path: '/budget', nav: 'Budget', title: 'Budget', component: 'budget-page' },
  { path: '/capex', nav: 'Big purchases', title: 'Big purchases', component: 'capex-page' },
  { path: '/forecast', nav: 'Forecast', title: 'Forecast', component: 'forecast-page' },
  { path: '/freedom', nav: 'Freedom', title: 'Freedom', component: 'freedom-page' },
  { path: '/scenarios', nav: 'Scenarios', title: 'Scenarios', component: 'scenarios-page' },
  { path: '/dashboards', nav: 'Dashboards', title: 'Dashboards', component: 'dashboards-page' },
  { path: '/charts', nav: 'Saved charts', title: 'Saved charts', component: 'charts-page' },
  // The advisor lives in the chat panel (ADR 0023); this route opens it.
  { path: '/advisor', nav: 'Advisor', title: 'Advisor', component: 'advisor-page', hidden: true },
  { path: '/schedules', nav: 'Schedules', title: 'Schedules', component: 'schedules-page' },
  { path: '/profile', nav: 'Profile', title: 'Profile', component: 'profile-page' },
  { path: '/settings', nav: 'Settings', title: 'Settings', component: 'settings-page' },
  {
    path: '/kernel',
    nav: 'Engine check',
    title: 'Engine check',
    component: 'kernel-page',
    hidden: true,
  },
];
