import { describe, expect, test } from 'vitest';
import type { Txn } from '../../src/domain/types.ts';
import { kindOfCategory } from '../../src/classify/categories.ts';
import { mccCategory } from '../../src/classify/mcc.ts';
import { recall, remember, type MemoryEntry } from '../../src/classify/memory.ts';
import { features, predict, train } from '../../src/classify/model.ts';
import { classifyAll, linkRefunds, needsReview } from '../../src/classify/pipeline.ts';
import { ruleMatches, type Rule } from '../../src/classify/rules.ts';
import { Classifier, MemoryStateStore } from '../../src/classify/service.ts';

let seq = 0;
function txn(o: Partial<Txn>): Txn {
  return {
    id: `t${++seq}`,
    accountId: 'SYN-A',
    idSynthetic: false,
    status: 'POSTED',
    cdrType: 'PAYMENT',
    date: '2025-03-14',
    amount: -1250n,
    currency: 'AUD',
    description: 'CORNER GROCER 0123 GLEBE AU',
    importIds: ['i'],
    provenance: 'illustrative',
    ...o,
  };
}
const key = (t: Txn) => `${t.accountId}\u001f${t.id}`;
const base = {
  categories: [],
  rules: [],
  memory: new Map<string, MemoryEntry>(),
  userLabels: new Map(),
};

describe('categories', () => {
  test('kind follows the id prefix, with explicit exceptions', () => {
    expect(kindOfCategory('capex.computing')).toBe('capex');
    expect(kindOfCategory('income.salary')).toBe('income');
    expect(kindOfCategory('income.interest')).toBe('interest');
    expect(kindOfCategory('food.cafe')).toBe('opex');
    expect(kindOfCategory('investment.syn-broker')).toBe('investment');
  });
});

describe('stages', () => {
  test('rules: all present conditions must hold', () => {
    const r: Rule = {
      id: 'r',
      name: 'rent',
      categoryId: 'housing.rent',
      match: { merchant: 'harbourside', direction: 'debit' },
    };
    expect(ruleMatches(r, txn({ description: 'DIRECT DEBIT HARBOURSIDE REALTY' }))).toBe(true);
    expect(
      ruleMatches(r, txn({ description: 'DIRECT DEBIT HARBOURSIDE REALTY', amount: 100n }))
    ).toBe(false);
    expect(ruleMatches({ ...r, match: {} }, txn({}))).toBe(false);
    expect(ruleMatches({ ...r, match: { description: '[' } }, txn({}))).toBe(false);
  });

  test('memory: recalls by merchant prefix, ignoring store numbers, suburbs and card prefixes', () => {
    const mem = new Map<string, MemoryEntry>();
    remember(mem, txn({ merchantName: 'Fresh Fields' }), 'food.groceries');
    expect(recall(mem, txn({ description: 'SQ *FRESH FIELDS 0231 NEWTOWN AU' }))?.categoryId).toBe(
      'food.groceries'
    );
    expect(recall(mem, txn({ description: 'FRESH FIELDS PTY LTD 0231' }))?.categoryId).toBe(
      'food.groceries'
    );
    expect(recall(mem, txn({ description: 'FRESH PRODUCE CO' }))).toBeUndefined();
    // A refund from the merchant is not the same as a purchase.
    expect(recall(mem, txn({ merchantName: 'Fresh Fields', amount: 500n }))).toBeUndefined();
  });

  test('MCC: capital-sized purchases map to the capex category', () => {
    expect(mccCategory(txn({ mcc: '5732', amount: -1500n }))).toBe('shopping.electronics');
    expect(mccCategory(txn({ mcc: '5732', amount: -420000n }))).toBe('capex.computing');
    expect(mccCategory(txn({ mcc: '9999' }))).toBeUndefined();
  });

  test('model: learns from corrections and is deterministic', () => {
    const samples = [
      ...['NOODLE REPUBLIC', 'NOODLE REPUBLIC ERSKINEVILLE', 'NOODLE REPUBLIC 22'].map((d) => ({
        x: features(txn({ description: d })),
        y: 'food.dining',
      })),
      ...['IRONWORKS GYM', 'DIRECT DEBIT IRONWORKS GYM'].map((d) => ({
        x: features(txn({ description: d })),
        y: 'health.gym',
      })),
    ];
    const m = train(samples)!;
    expect(predict(m, features(txn({ description: 'NOODLE REPUBLIC GLEBE' }))).label).toBe(
      'food.dining'
    );
    expect(predict(m, features(txn({ description: 'IRONWORKS GYM FEE' }))).label).toBe(
      'health.gym'
    );
    expect(predict(train(samples)!, features(txn({ description: 'X' })))).toEqual(
      predict(m, features(txn({ description: 'X' })))
    );
    expect(train([])).toBeNull();
    expect(train(samples.filter((x) => x.y === 'food.dining'))).toBeNull();
  });
});

describe('pipeline (§8)', () => {
  test('structural first: interest, fees, transfers', () => {
    const ts = [
      txn({ cdrType: 'INTEREST_PAID', amount: 500n }),
      txn({ cdrType: 'FEE', amount: -400n }),
      txn({ transferPairId: 'p', amount: -1000n }),
    ];
    const r = classifyAll(ts, base);
    expect(ts.map((t) => r.byKey.get(key(t))?.kind)).toEqual(['interest', 'fee', 'transfer']);
  });

  test('order of precedence: user > rule > memory > MCC > model', () => {
    const t = txn({ merchantName: 'Fresh Fields', mcc: '5411' });
    const memory = new Map<string, MemoryEntry>();
    remember(memory, t, 'food.cafe');
    const rules: Rule[] = [
      { id: 'r', name: 'r', categoryId: 'shopping.general', match: { merchant: 'fresh' } },
    ];
    expect(classifyAll([t], base).byKey.get(key(t))).toMatchObject({
      by: 'mcc',
      categoryId: 'food.groceries',
    });
    expect(classifyAll([t], { ...base, memory }).byKey.get(key(t))).toMatchObject({
      by: 'memory',
      categoryId: 'food.cafe',
    });
    expect(classifyAll([t], { ...base, memory, rules }).byKey.get(key(t))).toMatchObject({
      by: 'rule',
      confidence: 1,
    });
    const userLabels = new Map([[key(t), { categoryId: 'leisure.books' }]]);
    expect(
      classifyAll([t], { ...base, memory, rules, userLabels }).byKey.get(key(t))
    ).toMatchObject({ by: 'user', categoryId: 'leisure.books' });
  });

  test('unknown transactions are unclassified and go to review', () => {
    const t = txn({ description: 'MYSTERY', mcc: undefined });
    const c = classifyAll([t], base).byKey.get(key(t));
    expect(c?.categoryId).toBe('uncategorised');
    expect(needsReview(c)).toBe(true);
  });

  test('FR-CLS-003: refunds link to the purchase and take its category', () => {
    const buy = txn({
      description: 'HARBOUR ORGANICS 12 GLEBE AU',
      merchantName: 'Harbour Organics',
      amount: -6396n,
      date: '2025-03-01',
      mcc: '5411',
    });
    const refund = txn({
      description: 'REFUND HARBOUR ORGANICS 12 GLEBE AU',
      merchantName: 'Harbour Organics',
      amount: 6396n,
      date: '2025-03-20',
      cdrType: 'OTHER',
    });
    const late = txn({
      description: 'REFUND HARBOUR ORGANICS',
      amount: 6396n,
      date: '2025-06-01',
      cdrType: 'OTHER',
    });
    expect(linkRefunds([buy, refund, late])).toEqual(new Map([[key(refund), key(buy)]]));
    const r = classifyAll([buy, refund], base);
    expect(r.byKey.get(key(refund))).toMatchObject({
      kind: 'refund',
      categoryId: 'food.groceries',
    });
  });

  test('FR-CLS-002: capital categories and large outliers are proposed as CAPEX', () => {
    const cafes = Array.from({ length: 10 }, (_, i) =>
      txn({ mcc: '5814', amount: -500n - BigInt(i), merchantName: 'Little Bean' })
    );
    const laptop = txn({ mcc: '5732', amount: -320000n, merchantName: 'Bytewise' });
    const bigCafe = txn({ mcc: '5814', amount: -25000n, merchantName: 'Little Bean' });
    const smallButOdd = txn({ mcc: '5814', amount: -15000n, merchantName: 'Little Bean' });
    const r = classifyAll([...cafes, laptop, bigCafe, smallButOdd], base);
    expect(r.capexProposals.sort()).toEqual([key(laptop), key(bigCafe)].sort());
    expect(r.byKey.get(key(bigCafe))?.kind).toBe('capex');
  });
});

describe('Classifier', () => {
  test('FR-CLS-001: a correction offers N similar and, when remembered, they follow', async () => {
    const ts = [
      txn({ description: 'DIRECT DEBIT HARBOURSIDE REALTY', amount: -62000n }),
      txn({ description: 'DIRECT DEBIT HARBOURSIDE REALTY', amount: -62000n, date: '2025-03-21' }),
      txn({ description: 'DIRECT DEBIT HARBOURSIDE REALTY', amount: -62000n, date: '2025-03-28' }),
      txn({ description: 'DIRECT DEBIT OTHER CO', amount: -1000n }),
    ];
    const clf = new Classifier(new MemoryStateStore());
    clf.apply(ts);
    const similar = clf.similar(ts, key(ts[0]!));
    expect(similar.sort()).toEqual([key(ts[1]!), key(ts[2]!)].sort());
    await clf.correct(ts, [key(ts[0]!)], 'housing.rent', true);
    clf.apply(ts);
    expect(ts.slice(0, 3).map((t) => t.classification?.categoryId)).toEqual([
      'housing.rent',
      'housing.rent',
      'housing.rent',
    ]);
    expect(ts[3]!.classification?.categoryId).toBe('uncategorised');
    // A future transaction from the same merchant follows too.
    const next = txn({
      description: 'DIRECT DEBIT HARBOURSIDE REALTY',
      amount: -63000n,
      date: '2025-04-04',
    });
    clf.apply([...ts, next]);
    expect(next.classification).toMatchObject({ categoryId: 'housing.rent', by: 'memory' });
  });

  test('FR-CLS-004: re-running never overwrites a user label', async () => {
    const t = txn({ mcc: '5411', merchantName: 'Fresh Fields' });
    const clf = new Classifier(new MemoryStateStore());
    await clf.correct([t], [key(t)], 'leisure.entertainment', false);
    await clf.addRule({ name: 'x', categoryId: 'shopping.general', match: { merchant: 'fresh' } });
    for (let i = 0; i < 3; i++) clf.apply([t]);
    expect(t.classification).toMatchObject({ by: 'user', categoryId: 'leisure.entertainment' });
  });

  test('confirming a CAPEX proposal creates an asset with an assumed life; state persists', async () => {
    const store = new MemoryStateStore();
    const t = txn({ mcc: '5732', amount: -320000n, merchantName: 'Bytewise Computers' });
    const clf = new Classifier(store);
    clf.apply([t]);
    expect(clf.last!.capexProposals).toEqual([key(t)]);
    const asset = await clf.confirmCapex([t], key(t));
    expect(asset).toMatchObject({
      categoryId: 'capex.computing',
      lifeAssumed: true,
      life: { meanYears: 4, shape: 3 },
      cost: { minor: 320000n },
    });
    clf.apply([t]);
    expect(clf.last!.capexProposals).toEqual([]);
    expect(t.classification).toMatchObject({ kind: 'capex', by: 'user', assetId: asset.id });
    const again = new Classifier(store);
    await again.load();
    expect(again.assets).toHaveLength(1);
    again.apply([t]);
    expect(t.classification?.by).toBe('user');
  });

  test('rejecting a proposal records it as operating spend', async () => {
    const t = txn({ mcc: '5944', amount: -65000n, merchantName: 'Meridian' });
    const clf = new Classifier(new MemoryStateStore());
    clf.apply([t]);
    await clf.rejectCapex([t], key(t));
    clf.apply([t]);
    expect(t.classification).toMatchObject({ kind: 'opex', by: 'user' });
    expect(clf.last!.capexProposals).toEqual([]);
  });
});
