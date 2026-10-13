/** The chat panel's words and formatting (ADR 0023). */
import { describe, expect, test } from 'vitest';
import { parseMarkdown, plainText } from '../../src/assistant/markdown.ts';
import { againstTarget, chanceWords, coverageWords, dollars } from '../../src/assistant/phrases.ts';

describe('numbers to plain words', () => {
  test('chances read as frequencies of futures', () => {
    expect(chanceWords(0)).toBe('in none of the simulated futures');
    expect(chanceWords(0.02)).toBe('in fewer than 1 in 20 simulated futures');
    expect(chanceWords(0.12)).toBe('in about 1 in 10 simulated futures');
    expect(chanceWords(0.9)).toBe('in about 9 in 10 simulated futures');
    expect(chanceWords(0.97)).toBe('in more than 19 in 20 simulated futures');
    expect(chanceWords(1)).toBe('in almost every simulated future');
    expect(againstTarget(0.92, 0.9)).toBe('met');
    expect(againstTarget(0.84, 0.9)).toBe('close');
    expect(againstTarget(0.5, 0.9)).toBe('short');
    expect(againstTarget(0, 0.9)).toBe('far');
  });

  test('dollars are rounded to what is worth saying', () => {
    expect(dollars(1_712_345)).toBe('$1.7 million');
    expect(dollars(653_412)).toBe('$650,000');
    expect(dollars(42_350)).toBe('$42,000');
    expect(dollars(4_350)).toBe('$4,400');
    expect(dollars(42.4)).toBe('$42');
    expect(coverageWords(0.81)).toBe('about right');
  });
});

describe('reply formatting', () => {
  const run = '0abd2d8374b4·seed 42·runs 0–499';
  // A reply as Gemini actually wrote it (from the user's test with the default persona).
  const reply = `Based on your current plan, the simulation shows a **0 %** chance of success *(run: \`${run}\`)*, compared to your target probability of **90 %**.

The simulation projects an assumed freedom number of **~$1,700,000** *(run: \`${run}\`)* to fund 35 years. The capital runs out in the model (projected end capital across P10, P50, and P90 is **$0**, *run: \`${run}\`*).

This just means the current levers are out of balance:
1. **Pushing back the freedom date** (giving savings more years to grow).
2. **Adjusting spending** (either now or during freedom).

*(Note: These figures come from your own assumptions and simulations, not financial advice.)*`;

  test('markdown becomes structure, run references become one footnote, the disclaimer goes', () => {
    const p = parseMarkdown(reply, [run]);
    expect(p.runs).toEqual([run]);
    const text = plainText(p);
    expect(text).not.toContain('**');
    expect(text).not.toContain(run);
    expect(text).not.toMatch(/run:/i);
    expect(text).not.toMatch(/financial advice/i);
    expect(text.match(/\[1\]/g)?.length).toBe(3);
    expect(text).toContain('0 % chance of success [1]');
    expect(p.blocks.map((b) => b.type)).toEqual(['p', 'p', 'p', 'ol']);
    const first = p.blocks[0]!;
    expect(first.type === 'p' && first.inline.some((x) => x.t === 'b')).toBe(true);
  });

  test('nothing becomes HTML: tags stay text', () => {
    const p = parseMarkdown('Hello <img src=x onerror=alert(1)> **world**');
    expect(plainText(p)).toBe('Hello <img src=x onerror=alert(1)> world');
  });

  test('a citation at the end of a paragraph leaves the next paragraph and its bold alone', () => {
    const run = 'abc·seed 42·runs 0–499';
    const p = parseMarkdown(`Costs. Run \`${run}\`\n\n**Worth knowing:** cash earns little.`, [
      run,
    ]);
    expect(p.blocks).toHaveLength(2);
    expect(plainText(p)).not.toContain('**');
    expect(p.blocks[1]).toMatchObject({ inline: [{ t: 'b' }, { t: 'text' }] });
  });
});

describe('built-in intents (no AI)', async () => {
  const { matchIntent, parseDollars } = await import('../../src/assistant/intents.ts');
  test.each([
    ['How likely is my plan to work?', 'chance'],
    ['Will my plan work', 'chance'],
    ['What would make it work?', 'fix'],
    ['what would it take to stop working sooner', 'earliest'],
    ["what's the earliest I can retire?", 'earliest'],
    ['i want the _earliest_ date', 'earliest'],
    ['When can I stop working?', 'earliest'],
    ['how soon can I retire', 'earliest'],
    ['Why is it so low?', 'why'],
    ['How sure is the forecast?', 'sure'],
    ['Where does my money go?', 'spending'],
    ['Explain this screen', 'page'],
    ['help', 'page'],
    ['What does P90 mean?', 'define'],
    ['what is a freedom number', 'define'],
    ['tell me a joke', null],
  ])('%s → %s', (q, id) => {
    expect(matchIntent(q)?.id ?? null).toBe(id);
  });

  test('requests become proposals with their details', () => {
    expect(matchIntent('I pay $45 a month for the gym')).toEqual({
      id: 'budget-line',
      item: 'gym',
      amount: 45,
      period: 'm',
    });
    expect(matchIntent('We spend $120 a week on groceries')).toMatchObject({
      item: 'groceries',
      amount: 120,
      period: 'w',
    });
    expect(matchIntent('Netflix costs $18.99 monthly')).toMatchObject({
      item: 'Netflix',
      amount: 18.99,
    });
    expect(matchIntent('My car is 6 years old')).toEqual({ id: 'asset', name: 'car', ageYears: 6 });
    expect(matchIntent('I need to replace my laptop for $2,400')).toEqual({
      id: 'asset',
      name: 'laptop',
      cost: 2400,
    });
    expect(matchIntent('Categorise the cafe ones as dining out')).toEqual({
      id: 'categorise',
      match: 'cafe',
      category: 'dining out',
    });
    expect(matchIntent('show me the forecast')).toEqual({
      id: 'navigate',
      path: '/forecast',
      label: 'Forecast',
    });
    expect(parseDollars('about $2k')).toBe(2000);
  });
});
