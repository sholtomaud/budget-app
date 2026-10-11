import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appPath, compileRoute, matchRoute, publicPath } from '../../src/app/core/routes.ts';

describe('routes', () => {
  const routes = [
    { path: '/', component: 'start-page', title: 'Start' },
    { path: '/ledger', component: 'ledger-page', title: 'Ledger' },
    { path: '/scenario/:id', component: 'scenario-page', title: 'Scenario' },
  ].map(compileRoute);

  test('matches static paths, with or without a trailing slash', () => {
    assert.equal(matchRoute(routes, '/')?.route.component, 'start-page');
    assert.equal(matchRoute(routes, '/ledger')?.route.component, 'ledger-page');
    assert.equal(matchRoute(routes, '/ledger/')?.route.component, 'ledger-page');
  });

  test('extracts and decodes params', () => {
    const m = matchRoute(routes, '/scenario/rent%20vs%20buy');
    assert.equal(m?.route.component, 'scenario-page');
    assert.deepEqual(m?.params, { id: 'rent vs buy' });
  });

  test('returns null for unknown paths', () => {
    assert.equal(matchRoute(routes, '/nope'), null);
    assert.equal(matchRoute(routes, '/ledgerx'), null);
  });

  test('escapes regex characters in static segments', () => {
    const [r] = [compileRoute({ path: '/a.b', component: 'x', title: 'x' })];
    assert.equal(matchRoute([r!], '/axb'), null);
    assert.ok(matchRoute([r!], '/a.b'));
  });

  test('maps between public paths and app paths under a base', () => {
    assert.equal(appPath('/budget-app/ledger', '/budget-app/'), '/ledger');
    assert.equal(appPath('/budget-app/', '/budget-app/'), '/');
    assert.equal(appPath('/budget-app', '/budget-app/'), '/');
    assert.equal(appPath('/ledger', '/'), '/ledger');
    assert.equal(publicPath('/ledger', '/budget-app/'), '/budget-app/ledger');
    assert.equal(publicPath('/', '/'), '/');
  });
});
