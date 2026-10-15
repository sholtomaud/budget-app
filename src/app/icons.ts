/**
 * The menu's icons: simple 24 × 24 line drawings, drawn in the text colour.
 * In-house (ADR 0007); each is one SVG path.
 */
const PATHS: Record<string, string> = {
  '/': 'M3 11l9-8 9 8M5 9v12h14V9',
  '/chat': 'M4 5h16v11H9l-5 4z',
  '/import': 'M12 3v12M7 10l5 5 5-5M4 20h16',
  '/ledger': 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  '/budget': 'M3 7h18v13H3zM3 7l3-3h12l3 3M16 14h2',
  '/capex': 'M3 8l9-5 9 5v9l-9 5-9-5zM3 8l9 5 9-5M12 13v9',
  '/forecast': 'M3 17l6-6 4 4 8-8M15 7h6v6',
  '/freedom': 'M5 21V4M5 4h12l-2 4 2 4H5',
  '/scenarios': 'M6 3v18M18 3v18M6 9l12 6M6 15l12-6',
  '/dashboards': 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  '/charts': 'M4 20V12M10 20V5M16 20v-9M22 20H2',
  '/schedules': 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  '/settings':
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  theme: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  pin: 'M15 4l5 5-4 1-4 4 1 5-2 1-3-4-4 4M9 11l4 4',
  menu: 'M4 6h16M4 12h16M4 18h16',
};

const SVG = 'http://www.w3.org/2000/svg';

/** The icon for a screen path or a control, as an SVG element (decorative). */
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', PATHS[name] ?? 'M12 12h.01');
  svg.append(p);
  return svg;
}
