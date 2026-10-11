/**
 * The getting-started guide: the screens in the order a new user needs
 * them, each with one plain sentence. A step is done once there is data
 * and the user has opened its screen. Progress is a convenience kept in
 * localStorage (not financial data); delete-all clears it.
 */
import { Store } from './core/store.ts';

export interface GuideStep {
  id: string;
  title: string;
  path: string;
  text: string;
}

export const GUIDE: GuideStep[] = [
  {
    id: 'data',
    title: 'Add your data',
    path: '/',
    text: 'Load a sample household to look around, or add your own bank data.',
  },
  {
    id: 'transactions',
    title: 'Check your transactions',
    path: '/ledger',
    text: "Crux has sorted your spending into categories. Fix any that look wrong; the review queue lists the ones it wasn't sure about.",
  },
  {
    id: 'budget',
    title: 'Compare with your budget',
    path: '/budget',
    text: 'See what you actually spend against what you planned, category by category. Add a budget if you have one.',
  },
  {
    id: 'capex',
    title: 'Plan for big purchases',
    path: '/capex',
    text: 'Laptops, cars, holidays: Crux estimates when each is due and how much to set aside each week.',
  },
  {
    id: 'forecast',
    title: "See what's coming",
    path: '/forecast',
    text: 'Your spending for the next few years, with a range for how it could turn out.',
  },
  {
    id: 'freedom',
    title: 'Find your freedom number',
    path: '/freedom',
    text: 'Set when you would like to stop working for money, then simulate thousands of possible futures to see how likely your plan is to work.',
  },
  {
    id: 'scenarios',
    title: 'Compare plans',
    path: '/scenarios',
    text: 'Save a few versions of your plan, compare them side by side, and ask what it would take to reach your target.',
  },
];

interface GuideState {
  visited: string[];
  hidden: boolean;
}

const KEY = 'budget-app:guide';

function read(): GuideState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GuideState | null;
    if (v && Array.isArray(v.visited)) return v;
  } catch {
    // Unavailable or corrupt: start fresh.
  }
  return { visited: [], hidden: false };
}

export const guideStore = new Store<GuideState>(read());

guideStore.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: progress lasts for the session.
  }
});

/** Mark a screen visited (only counts once there is data to look at). */
export function visit(path: string, hasData: boolean): void {
  const s = guideStore.getState();
  const step = GUIDE.find((g) => g.path === path && g.id !== 'data');
  if (!step || !hasData || s.visited.includes(step.id)) return;
  guideStore.setState({ visited: [...s.visited, step.id] });
}

export function isDone(step: GuideStep, hasData: boolean, visited: readonly string[]): boolean {
  return step.id === 'data' ? hasData : hasData && visited.includes(step.id);
}

/** The first step not yet done, or null when the guide is complete. */
export function nextStep(hasData: boolean, visited: readonly string[]): GuideStep | null {
  return GUIDE.find((g) => !isDone(g, hasData, visited)) ?? null;
}

export const showGuide = () => guideStore.setState({ hidden: false });
export const hideGuide = () => guideStore.setState({ hidden: true });
export const restartGuide = () => guideStore.setState({ visited: [], hidden: false });
