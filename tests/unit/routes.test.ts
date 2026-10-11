import { describe, expect, test } from 'vitest';
import { appPath, compileRoute, matchRoute, publicPath } from '../../src/app/core/routes.ts';

describe('routes', () => {
  const routes = [
    { path: '/', component: 'start-page', title: 'Start' },
    { path: '/ledger', component: 'ledger-page', title: 'Ledger' },
    { path: '/scenario/:id', component: 'scenario-page', title: 'Scenario' },
  ].map(compileRoute);

  test('matches static paths, with or without a trailing slash', () => {
    expect(matchRoute(routes, '/')?.route.component).toBe('start-page');
    expect(matchRoute(routes, '/ledger')?.route.component).toBe('ledger-page');
    expect(matchRoute(routes, '/ledger/')?.route.component).toBe('ledger-page');
  });

  test('extracts and decodes params', () => {
    const m = matchRoute(routes, '/scenario/rent%20vs%20buy');
    expect(m?.route.component).toBe('scenario-page');
    expect(m?.params).toEqual({ id: 'rent vs buy' });
  });

  test('returns null for unknown paths', () => {
    expect(matchRoute(routes, '/nope')).toBe(null);
    expect(matchRoute(routes, '/ledgerx')).toBe(null);
  });

  test('escapes regex characters in static segments', () => {
    const [r] = [compileRoute({ path: '/a.b', component: 'x', title: 'x' })];
    expect(matchRoute([r!], '/axb')).toBe(null);
    expect(matchRoute([r!], '/a.b')?.route.component).toBe('x');
  });

  test('maps between public paths and app paths under a base', () => {
    expect(appPath('/budget-app/ledger', '/budget-app/')).toBe('/ledger');
    expect(appPath('/budget-app/', '/budget-app/')).toBe('/');
    expect(appPath('/budget-app', '/budget-app/')).toBe('/');
    expect(appPath('/ledger', '/')).toBe('/ledger');
    expect(publicPath('/ledger', '/budget-app/')).toBe('/budget-app/ledger');
    expect(publicPath('/', '/')).toBe('/');
  });
});
