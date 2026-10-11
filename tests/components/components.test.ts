// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import '../../src/app/components/placeholder-page/placeholder-page.ts';
import '../../src/app/components/line-chart/line-chart.ts';
import type { LineChart } from '../../src/app/components/line-chart/line-chart.ts';
import type { PlaceholderPage } from '../../src/app/components/placeholder-page/placeholder-page.ts';
import { Router } from '../../src/app/core/router.ts';

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
});

describe('<placeholder-page>', () => {
  test('renders its heading, summary, section and milestone as text', () => {
    const el = document.createElement('placeholder-page') as PlaceholderPage;
    Object.assign(el, {
      heading: 'Ledger',
      summary: '<b>not markup</b>',
      section: '§8',
      milestone: 'M2',
    });
    document.body.append(el);
    expect(el.querySelector('h1')?.textContent).toBe('Ledger');
    expect(el.querySelector('.milestone')?.textContent).toBe('M2');
    // Data is rendered as text, never parsed as HTML.
    expect(el.querySelector('.summary b')).toBeNull();
    expect(el.querySelector('.summary')?.textContent).toBe('<b>not markup</b>');
  });

  test(':host styles are scoped to the tag name', () => {
    const el = document.createElement('placeholder-page');
    document.body.append(el);
    expect(el.querySelector('style')?.textContent).toContain('placeholder-page {');
    expect(el.querySelector('style')?.textContent).not.toContain(':host');
  });
});

describe('<line-chart>', () => {
  test('draws one path per series and labels provenance', () => {
    const el = document.createElement('line-chart') as LineChart;
    document.body.append(el);
    el.data = {
      x: [0, 1, 2, 3],
      series: [
        { name: 'bank', values: [10, 20, 15, 30] },
        { name: 'super', values: [50, 52, 55, 60] },
      ],
      xLabel: 'Month',
      yLabel: 'AUD',
      provenance: 'illustrative',
    };
    expect(el.querySelectorAll('.series path')).toHaveLength(2);
    expect(el.querySelector('.prov')?.textContent).toBe('illustrative');
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toContain('(illustrative)');
  });

  test('renders nothing for empty data', () => {
    const el = document.createElement('line-chart') as LineChart;
    document.body.append(el);
    el.data = { x: [], series: [], xLabel: '', yLabel: '', provenance: 'actual' };
    expect(el.querySelector('svg')?.childElementCount).toBe(0);
  });
});

describe('Router', () => {
  function setup() {
    const outlet = document.createElement('main');
    document.body.append(outlet);
    const router = new Router(outlet, '/', 'budget-app').register([
      {
        path: '/ledger',
        component: 'placeholder-page',
        title: 'Ledger',
        props: { heading: 'Ledger', milestone: 'M2' },
      },
    ]);
    return { outlet, router };
  }

  test('navigate() renders the matched screen with its props and sets the title', async () => {
    const { outlet, router } = setup();
    router.navigate('/ledger');
    await new Promise((r) => setTimeout(r, 0));
    expect(location.pathname).toBe('/ledger');
    expect(outlet.querySelector('placeholder-page h1')?.textContent).toBe('Ledger');
    expect(document.title).toBe('Ledger · budget-app');
  });

  test('an unknown path renders Not found', async () => {
    const { outlet, router } = setup();
    router.navigate('/nowhere');
    await new Promise((r) => setTimeout(r, 0));
    expect(outlet.querySelector('h1')?.textContent).toBe('Not found');
  });
});
