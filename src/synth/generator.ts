/**
 * The seeded synthetic household generator (SPEC §7, FR-SYN-001…006).
 *
 * A persona and a seed produce CDR Banking API response files (accounts,
 * monthly balance snapshots, paginated transactions), a ground-truth label
 * file, a matching budget workbook as CSV, and a manifest. The same persona
 * and seed produce byte-identical output.
 */
import {
  addDays,
  addMonths,
  dayNumber,
  daysBetween,
  daysInMonth,
  fromDayNumber,
  parseIsoDate,
  weekday,
  zonedDateTime,
  type IsoDate,
} from '../lib/dates.ts';
import { canonicalJson, sha256Hex } from '../lib/hash.ts';
import { formatAmount, parseAmount, toMinor } from '../lib/money.ts';
import { fnv1a64, Rng, weibullScale } from '../lib/prng.ts';
import { writeCsv } from '../lib/csv.ts';
import { syntheticTxnId } from '../ingest/ids.ts';
import type { ClassificationKind } from '../domain/types.ts';
import type { Every, Persona, PersonaAccount } from './persona.ts';

export const GENERATOR = 'budget-app/synth@0.1.0';

export interface SynthFile {
  path: string;
  content: string;
}

export interface TruthLabel {
  kind: ClassificationKind;
  categoryId: string;
  assetId?: string;
  transferPairId?: string;
  /** For a PENDING record: the id of the POSTED record that replaces it. */
  supersededBy?: string;
  /** For a refund: the id of the purchase it reverses. */
  refundOf?: string;
}

export interface TruthAsset {
  assetId: string;
  name: string;
  categoryId: string;
  lifeYears: number | null;
  shape: number | null;
  lastBought: IsoDate | null;
  lastBoughtAssumed: boolean;
  purchases: IsoDate[];
  /** The next sampled replacement date after the horizon (FR-SYN-005). */
  nextReplacement: IsoDate | null;
}

export interface Truth {
  transactions: Record<string, TruthLabel>;
  assets: TruthAsset[];
}

export interface SynthOutput {
  files: SynthFile[];
  truth: Truth;
}

type CdrType =
  | 'DIRECT_DEBIT'
  | 'FEE'
  | 'INTEREST_CHARGED'
  | 'INTEREST_PAID'
  | 'OTHER'
  | 'PAYMENT'
  | 'TRANSFER_INCOMING'
  | 'TRANSFER_OUTGOING';

interface Leg {
  accountId: string;
  amount: bigint;
  type: CdrType;
  description: string;
  reference: string;
  merchantName?: string;
  mcc?: string;
  billerCode?: string;
  billerName?: string;
  truth: TruthLabel;
  /** Card purchases can be emitted PENDING first and can be refunded. */
  card?: { pendingDescription: string; refundable: boolean };
}

interface Posting {
  seq: number;
  execDate: IsoDate;
  execMinute: number;
  postDate: IsoDate;
  postMinute: number;
  leg: Leg;
  pendingFirst: boolean;
  /** The PENDING record this posting replaces, when the noise emitted one. */
  pending?: Rec;
}

interface Rec {
  accountId: string;
  id: string;
  hasId: boolean;
  status: 'PENDING' | 'POSTED';
  type: CdrType;
  description: string;
  postingDateTime?: string;
  executionDateTime: string;
  amount: string;
  reference: string;
  merchantName?: string;
  mcc?: string;
  billerCode?: string;
  billerName?: string;
  sortKey: string;
  truth: TruthLabel;
}

const SUBURBS = [
  'NEWTOWN',
  'GLEBE',
  'SURRY HILLS',
  'MARRICKVILLE',
  'REDFERN',
  'ANNANDALE',
  'LEICHHARDT',
  'ERSKINEVILLE',
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const upper = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 &]/g, '');

/** A stable small integer from a string, for store numbers and schedule offsets. */
const stableInt = (s: string, mod: number) => Number(fnv1a64(s) % BigInt(mod));

function endDate(p: Persona): IsoDate {
  return addDays(addMonths(p.start, p.months), -1);
}

/** Dates on which a schedule with period `every` fires within [start, end]. */
function scheduleDates(
  every: Every,
  start: IsoDate,
  end: IsoDate,
  key: string,
  anchorWeekday?: number
): IsoDate[] {
  const out: IsoDate[] = [];
  const s0 = dayNumber(start);
  const e0 = dayNumber(end);
  const stepDays = (first: number, step: number) => {
    for (let d = first; d <= e0; d += step) out.push(fromDayNumber(d));
  };
  const firstOnWeekday = (wd: number) => s0 + ((wd - weekday(start) + 7) % 7);
  switch (every) {
    case 'day':
      stepDays(s0, 1);
      break;
    case 'week':
      stepDays(
        anchorWeekday !== undefined ? firstOnWeekday(anchorWeekday) : s0 + stableInt(key, 7),
        7
      );
      break;
    case 'fortnight':
      stepDays(
        anchorWeekday !== undefined ? firstOnWeekday(anchorWeekday) : s0 + stableInt(key, 14),
        14
      );
      break;
    case 'month':
    case 'quarter':
    case 'year': {
      const step = every === 'month' ? 1 : every === 'quarter' ? 3 : 12;
      const day = 1 + stableInt(key, 28);
      const monthOffset = every === 'year' ? stableInt(`${key}#m`, 12) : 0;
      for (let k = monthOffset; ; k += step) {
        const first = addMonths(start, k);
        const { y, m } = parseIsoDate(first);
        const d = `${first.slice(0, 8)}${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
        if (dayNumber(d) > e0) break;
        if (dayNumber(d) >= s0) out.push(d);
      }
      break;
    }
  }
  return out;
}

function seasonal(kind: string | undefined, date: IsoDate): number {
  const m = parseIsoDate(date).m;
  if (kind === 'winter_peak') return 1 + 0.3 * Math.cos((2 * Math.PI * (m - 7)) / 12);
  if (kind === 'summer_peak') return 1 + 0.3 * Math.cos((2 * Math.PI * (m - 1)) / 12);
  return 1;
}

const yearsToDays = (y: number) => Math.round(y * 365.25);

export async function generate(persona: Persona, seedStr: string): Promise<SynthOutput> {
  const rng = new Rng(seedStr);
  const seed = String(seedStr);
  const tz = persona.timezone;
  const start = persona.start;
  const end = endDate(persona);
  const noise = persona.noise ?? {};
  const marker = { generator: GENERATOR, seed, persona: persona.name };

  const accounts = persona.accounts;
  const byRole = (role: PersonaAccount['role']) => accounts.find((a) => a.role === role);
  const txnAcct = byRole('transaction')!;
  const savAcct = byRole('savings');
  const ccAcct = byRole('credit');
  const cardAccountId = ccAcct?.id ?? txnAcct.id;
  const bufferMinor = txnAcct.buffer ? parseAmount(txnAcct.buffer) : 100000n;

  // ---- Scheduled (balance-independent) legs, keyed by execution date ----
  const scheduled = new Map<IsoDate, { minute: number; leg: Leg; lag: number }[]>();
  const schedule = (date: IsoDate, minute: number, leg: Leg, lag = 0) => {
    if (dayNumber(date) < dayNumber(start) || dayNumber(date) > dayNumber(end)) return;
    const list = scheduled.get(date) ?? [];
    list.push({ minute, leg, lag });
    scheduled.set(date, list);
  };

  const merchantText = (r: Rng, name: string, card: boolean) => {
    const store = String(stableInt(name, 9000) + 100).padStart(4, '0');
    const suburb = SUBURBS[stableInt(`${name}#sub`, SUBURBS.length)]!;
    const canonical = `${upper(name)} ${store} ${suburb} AU`;
    let description = canonical;
    let merchantName: string | undefined = name;
    if (noise.merchantNameVariants) {
      const v = r.int(10);
      if (v === 0) description = `${upper(name)} ${suburb}`;
      else if (v === 1) description = `SQ *${upper(name)} ${suburb}`;
      else if (v === 2) description = `${upper(name)} PTY LTD ${store}`;
      const mv = r.int(10);
      if (mv === 0) merchantName = `${name} Pty Ltd`;
      else if (mv === 1) merchantName = undefined;
    }
    return {
      description,
      merchantName,
      pendingDescription: card ? `${upper(name)} ${suburb}`.slice(0, 22) : description,
    };
  };

  // Income
  persona.income.forEach((inc, i) => {
    const r = rng.fork('income', i);
    const payer = inc.payer ?? 'Employer';
    const thursday = 4;
    for (const date of scheduleDates(
      inc.every,
      start,
      end,
      `income#${i}`,
      inc.every === 'week' || inc.every === 'fortnight' ? thursday : undefined
    )) {
      let amount = Number(inc.amount);
      for (const rise of inc.rises ?? []) if (date >= rise.on) amount *= 1 + rise.pct;
      if (inc.jitter) amount = Math.max(0, amount * (1 + inc.jitter * r.normal()));
      schedule(date, 3 * 60, {
        accountId: txnAcct.id,
        amount: toMinor(amount),
        type: 'TRANSFER_INCOMING',
        description: `${upper(inc.name)} ${upper(payer)}`,
        reference: `${upper(inc.name).slice(0, 10)} ${date.slice(0, 7)}`,
        truth: { kind: 'income', categoryId: inc.category ?? `income.${slug(inc.name)}` },
      });
    }
  });

  // Recurring bills
  (persona.recurring ?? []).forEach((rec, i) => {
    const r = rng.fork('recurring', i);
    const payee = rec.payee ?? rec.category;
    const via = rec.via ?? 'DIRECT_DEBIT';
    const billerCode = String(10000 + stableInt(payee, 89999));
    for (const date of scheduleDates(rec.every, start, end, `recurring#${rec.category}`)) {
      let amount = Number(rec.amount ?? rec.mean);
      if (rec.mean) {
        amount *= seasonal(rec.seasonality, date);
        if (rec.cv) amount = r.lognormalMeanCv(amount, rec.cv);
      }
      const leg: Leg = {
        accountId: rec.account ?? txnAcct.id,
        amount: -toMinor(amount),
        type: via,
        description:
          via === 'DIRECT_DEBIT'
            ? `DIRECT DEBIT ${upper(payee)}`
            : via === 'TRANSFER_OUTGOING'
              ? `TRANSFER TO ${upper(payee)}`
              : `BPAY ${upper(payee)}`,
        reference: `${upper(payee).slice(0, 12)} ${date.slice(0, 7)}`,
        truth: { kind: 'opex', categoryId: rec.category },
      };
      if (via !== 'TRANSFER_OUTGOING') {
        leg.billerName = payee;
        leg.billerCode = billerCode;
      }
      if (rec.mcc) leg.mcc = rec.mcc;
      schedule(date, 5 * 60 + stableInt(payee, 60), leg);
    }
  });

  // Card-spend helper (variable spending and capex)
  const cardLeg = (
    r: Rng,
    accountId: string,
    name: string,
    mcc: string | undefined,
    minor: bigint,
    truth: TruthLabel
  ): Leg => {
    const t = merchantText(r, name, true);
    const leg: Leg = {
      accountId,
      amount: -minor,
      type: 'PAYMENT',
      description: t.description,
      reference: '',
      truth,
      card: { pendingDescription: t.pendingDescription, refundable: true },
    };
    if (t.merchantName) leg.merchantName = t.merchantName;
    if (mcc) leg.mcc = mcc;
    return leg;
  };

  // Variable spending
  (persona.variable ?? []).forEach((v, i) => {
    const r = rng.fork('variable', i);
    const merchants = v.merchants ?? [v.category.split('.').pop() ?? 'Shop'];
    const accountId = v.account ?? cardAccountId;
    const truth: TruthLabel = { kind: 'opex', categoryId: v.category };
    if (v.weeklyMean) {
      const visitsPerWeek = v.visitsPerWeek ?? 1;
      const perVisit = Number(v.weeklyMean) / visitsPerWeek;
      for (let w = dayNumber(start); w <= dayNumber(end); w += 7) {
        const visits = r.poisson(visitsPerWeek);
        for (let k = 0; k < visits; k++) {
          const date = fromDayNumber(w + r.int(7));
          const amount = r.lognormalMeanCv(perVisit, v.cv ?? 0.3);
          schedule(
            date,
            8 * 60 + r.int(13 * 60),
            cardLeg(r, accountId, r.pick(merchants), v.mcc, toMinor(Math.max(1, amount)), truth),
            r.int(3)
          );
        }
      }
    }
    if (v.dailyProb !== undefined) {
      const [mu, sigma] = v.amount?.lognormal ?? [2, 0.3];
      for (let d = dayNumber(start); d <= dayNumber(end); d++) {
        if (!r.chance(v.dailyProb)) continue;
        const amount = r.lognormal(mu ?? 2, sigma ?? 0.3);
        schedule(
          fromDayNumber(d),
          7 * 60 + r.int(9 * 60),
          cardLeg(r, accountId, r.pick(merchants), v.mcc, toMinor(Math.max(1, amount)), truth),
          r.int(3)
        );
      }
    }
  });

  // Capital purchases (FR-SYN-005)
  const assets: TruthAsset[] = [];
  (persona.capex ?? []).forEach((c, i) => {
    const r = rng.fork('capex', i);
    const assetId = slug(c.asset);
    const categoryId = c.category ?? `capex.${assetId}`;
    const accountId = c.account ?? cardAccountId;
    const merchant = c.merchant ?? c.asset;
    const purchases: IsoDate[] = [];
    const cost = () =>
      typeof c.cost === 'string'
        ? parseAmount(c.cost)
        : toMinor(
            Math.max(
              (c.cost.normal[0] ?? 0) * 0.3,
              r.normal(c.cost.normal[0] ?? 0, c.cost.normal[1] ?? 0)
            )
          );
    const buy = (date: IsoDate) => {
      purchases.push(date);
      schedule(
        date,
        10 * 60 + r.int(9 * 60),
        cardLeg(r, accountId, merchant, c.mcc, cost(), { kind: 'capex', categoryId, assetId }),
        r.int(3)
      );
    };
    const shape = c.shape ?? 3;
    let lastBought: IsoDate | null = c.lastBought ?? null;
    let lastBoughtAssumed = false;
    let nextReplacement: IsoDate | null = null;

    if (c.every === 'year') {
      const months = c.month?.length ? c.month : [1];
      const { y: y0 } = parseIsoDate(start);
      const { y: y1 } = parseIsoDate(end);
      for (let y = y0; y <= y1; y++) {
        const m = r.pick(months);
        const day = 1 + r.int(daysInMonth(y, m));
        const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (date >= start && date <= end) buy(date);
      }
    } else if (c.lifeYears) {
      const scale = weibullScale(c.lifeYears, shape);
      let next: IsoDate | null = null;
      if (c.wish) {
        // A wish-list item: bought at most once in the horizon, with probability per year.
        for (let y = 0; y * 12 < persona.months; y++) {
          if (r.chance(c.buyProbPerYear ?? 0)) {
            const from = dayNumber(addMonths(start, y * 12));
            const to = Math.min(dayNumber(end), dayNumber(addMonths(start, (y + 1) * 12)) - 1);
            next = fromDayNumber(from + r.int(to - from + 1));
            break;
          }
        }
      } else {
        if (!lastBought) {
          lastBought = addDays(start, -r.int(yearsToDays(c.lifeYears)) - 1);
          lastBoughtAssumed = true;
        }
        const ageYears = daysBetween(lastBought, start) / 365.25;
        next = addDays(
          lastBought,
          yearsToDays(r.weibullGiven(shape, scale, Math.max(0, ageYears)))
        );
      }
      while (next && next <= end) {
        buy(next);
        next = addDays(next, Math.max(30, yearsToDays(r.weibull(shape, scale))));
      }
      nextReplacement = next;
    } else if (c.wish && r.chance(c.buyProbPerYear ?? 0)) {
      buy(addDays(start, r.int(daysBetween(start, end) + 1)));
    }
    assets.push({
      assetId,
      name: c.asset,
      categoryId,
      lifeYears: c.lifeYears ?? null,
      shape: c.lifeYears ? shape : null,
      lastBought,
      lastBoughtAssumed,
      purchases,
      nextReplacement,
    });
  });

  // Investing (transfers to accounts outside the bank data)
  (persona.investing ?? []).forEach((inv, i) => {
    for (const date of scheduleDates(inv.every, start, end, `investing#${i}`)) {
      schedule(date, 6 * 60 + stableInt(inv.to, 60), {
        accountId: txnAcct.id,
        amount: -parseAmount(inv.amount),
        type: 'TRANSFER_OUTGOING',
        description: `TRANSFER TO ${inv.to}`,
        reference: 'INVEST',
        truth: { kind: 'investment', categoryId: inv.category ?? `investment.${slug(inv.to)}` },
      });
    }
  });

  // ---- Day-by-day posting with balance-dependent behaviour ----
  const balances = new Map<string, bigint>(
    accounts.map((a) => [a.id, a.opening ? parseAmount(a.opening) : 0n])
  );
  const postingsByDay = new Map<IsoDate, Posting[]>();
  const records: Rec[] = [];
  const seqByAccount = new Map<string, number>();
  const snapshots: { asAt: string; date: IsoDate; balances: Map<string, bigint> }[] = [];
  const noiseRng = rng.fork('noise');
  const refundRng = rng.fork('refunds');
  let postingSeq = 0;
  let pairSeq = 0;

  const nextId = (accountId: string, pending: boolean) => {
    const n = (seqByAccount.get(accountId) ?? 0) + 1;
    seqByAccount.set(accountId, n);
    return `${accountId}-${pending ? 'P' : ''}${String(n).padStart(6, '0')}`;
  };
  const time = (date: IsoDate, minute: number) =>
    zonedDateTime(date, Math.floor(minute / 60) % 24, minute % 60, 0, tz);

  const queuePosting = (execDate: IsoDate, execMinute: number, leg: Leg, lag: number) => {
    let pendingFirst = !!leg.card && noiseRng.chance(noise.pendingThenPosted ?? 0);
    const lagDays = pendingFirst ? 1 + noiseRng.int(3) : lag;
    const postDate = addDays(execDate, lagDays);
    // Not yet posted when the export was taken: the export shows it as pending.
    if (dayNumber(postDate) > dayNumber(end)) pendingFirst = true;
    const postMinute =
      lagDays === 0
        ? Math.min(execMinute + 1 + noiseRng.int(30), 22 * 60)
        : 2 * 60 + noiseRng.int(4 * 60);
    const p: Posting = {
      seq: postingSeq++,
      execDate,
      execMinute,
      postDate,
      postMinute,
      leg,
      pendingFirst,
    };
    if (pendingFirst) {
      const pending: Rec = {
        accountId: leg.accountId,
        id: nextId(leg.accountId, true),
        hasId: true,
        status: 'PENDING',
        type: leg.type,
        description: leg.card?.pendingDescription ?? leg.description,
        executionDateTime: time(execDate, execMinute),
        amount: formatAmount(leg.amount),
        reference: leg.reference,
        ...(leg.merchantName ? { merchantName: leg.merchantName } : {}),
        ...(leg.mcc ? { mcc: leg.mcc } : {}),
        sortKey: `${execDate} ${String(execMinute).padStart(4, '0')}`,
        truth: { ...leg.truth },
      };
      records.push(pending);
      p.pending = pending;
    }
    // Postings beyond the horizon remain pending at export time.
    if (dayNumber(postDate) > dayNumber(end)) return;
    const list = postingsByDay.get(postDate) ?? [];
    list.push(p);
    postingsByDay.set(postDate, list);
  };

  const post = (p: Posting) => {
    const leg = p.leg;
    balances.set(leg.accountId, (balances.get(leg.accountId) ?? 0n) + leg.amount);
    const id = nextId(leg.accountId, false);
    const hasId = !noiseRng.chance(noise.missingTransactionId ?? 0);
    const rec: Rec = {
      accountId: leg.accountId,
      id,
      hasId,
      status: 'POSTED',
      type: leg.type,
      description: leg.description,
      postingDateTime: time(p.postDate, p.postMinute),
      executionDateTime: time(p.execDate, p.execMinute),
      amount: formatAmount(leg.amount),
      reference: leg.reference,
      ...(leg.merchantName ? { merchantName: leg.merchantName } : {}),
      ...(leg.mcc ? { mcc: leg.mcc } : {}),
      ...(leg.billerCode ? { billerCode: leg.billerCode } : {}),
      ...(leg.billerName ? { billerName: leg.billerName } : {}),
      sortKey: `${p.postDate} ${String(p.postMinute).padStart(4, '0')}`,
      truth: { ...leg.truth },
    };
    if (p.pending) p.pending.truth.supersededBy = id;
    records.push(rec);
    // Refunds (noise): the full amount comes back 3–40 days later.
    if (leg.card?.refundable && refundRng.chance(noise.refunds ?? 0)) {
      const date = addDays(p.postDate, 3 + refundRng.int(38));
      queuePosting(
        date,
        12 * 60 + refundRng.int(6 * 60),
        {
          accountId: leg.accountId,
          amount: -leg.amount,
          type: 'OTHER',
          description: `REFUND ${leg.description}`.slice(0, 60),
          reference: '',
          ...(leg.merchantName ? { merchantName: leg.merchantName } : {}),
          ...(leg.mcc ? { mcc: leg.mcc } : {}),
          truth: {
            kind: 'refund',
            categoryId: leg.truth.categoryId,
            ...(leg.truth.assetId ? { assetId: leg.truth.assetId } : {}),
            refundOf: id,
          },
        },
        0
      );
    }
    return id;
  };

  /** An internal transfer between two of the household's accounts (FR-ING-007). */
  const transfer = (
    date: IsoDate,
    minute: number,
    from: string,
    to: string,
    minor: bigint,
    kindLabel: string
  ) => {
    const pairId = `T-${String(++pairSeq).padStart(5, '0')}`;
    const truth: TruthLabel = {
      kind: 'transfer',
      categoryId: 'transfer.internal',
      transferPairId: pairId,
    };
    const isCardPayment = to === ccAcct?.id;
    const out: Leg = {
      accountId: from,
      amount: -minor,
      type: 'TRANSFER_OUTGOING',
      description: isCardPayment ? `CREDIT CARD PAYMENT ${to}` : `TRANSFER TO ${to} ${kindLabel}`,
      reference: kindLabel,
      truth,
    };
    const inn: Leg = {
      accountId: to,
      amount: minor,
      type: 'TRANSFER_INCOMING',
      description: isCardPayment
        ? 'PAYMENT RECEIVED THANK YOU'
        : `TRANSFER FROM ${from} ${kindLabel}`,
      reference: kindLabel,
      truth: { ...truth },
    };
    const lagIn = noiseRng.int(2);
    post({
      seq: postingSeq++,
      execDate: date,
      execMinute: minute,
      postDate: date,
      postMinute: minute,
      leg: out,
      pendingFirst: false,
    });
    const inDate = addDays(date, lagIn);
    if (dayNumber(inDate) > dayNumber(end)) {
      post({
        seq: postingSeq++,
        execDate: date,
        execMinute: minute,
        postDate: date,
        postMinute: minute + 1,
        leg: inn,
        pendingFirst: false,
      });
    } else {
      queuePostingDirect(date, minute, inDate, lagIn ? 4 * 60 : minute + 1, inn);
    }
  };
  const queuePostingDirect = (
    execDate: IsoDate,
    execMinute: number,
    postDate: IsoDate,
    postMinute: number,
    leg: Leg
  ) => {
    if (postDate === execDate) {
      post({
        seq: postingSeq++,
        execDate,
        execMinute,
        postDate,
        postMinute,
        leg,
        pendingFirst: false,
      });
      return;
    }
    const list = postingsByDay.get(postDate) ?? [];
    list.push({
      seq: postingSeq++,
      execDate,
      execMinute,
      postDate,
      postMinute,
      leg,
      pendingFirst: false,
    });
    postingsByDay.set(postDate, list);
  };

  /** Keep the transaction account out of overdraft by drawing on savings first. */
  const ensureFunds = (date: IsoDate, minute: number, debit: bigint) => {
    if (!savAcct) return;
    const bal = balances.get(txnAcct.id) ?? 0n;
    if (bal - debit >= 0n) return;
    const need = debit - bal + bufferMinor;
    const amount = ((need + 9999n) / 10000n) * 10000n;
    const avail = balances.get(savAcct.id) ?? 0n;
    const take = amount <= avail ? amount : (avail / 10000n) * 10000n;
    if (take > 0n) transfer(date, Math.max(0, minute - 1), savAcct.id, txnAcct.id, take, 'TOPUP');
  };

  const snapshot = (date: IsoDate, asAt: string) =>
    snapshots.push({ asAt, date, balances: new Map(balances) });
  snapshot(start, zonedDateTime(start, 0, 0, 0, tz));
  const ccFeeMonth = parseIsoDate(start).m;

  for (let dn = dayNumber(start); dn <= dayNumber(end); dn++) {
    const date = fromDayNumber(dn);
    const { y, m, d } = parseIsoDate(date);
    for (const s of (scheduled.get(date) ?? []).sort((a, b) => a.minute - b.minute)) {
      queuePosting(date, s.minute, s.leg, s.lag);
    }
    const todays = (postingsByDay.get(date) ?? []).sort(
      (a, b) => a.postMinute - b.postMinute || a.seq - b.seq
    );
    postingsByDay.delete(date);
    for (const p of todays) {
      if (p.leg.accountId === txnAcct.id && p.leg.amount < 0n)
        ensureFunds(date, p.postMinute, -p.leg.amount);
      post(p);
    }
    // Credit card: paid in full on the 25th.
    if (ccAcct && d === 25) {
      const owed = -(balances.get(ccAcct.id) ?? 0n);
      if (owed > 0n) {
        ensureFunds(date, 21 * 60, owed);
        transfer(date, 21 * 60, txnAcct.id, ccAcct.id, owed, 'CARD');
      }
    }
    // Month end: fees, interest, sweep to savings, then the balance snapshot.
    if (d === daysInMonth(y, m)) {
      if (noise.fees) {
        post({
          seq: postingSeq++,
          execDate: date,
          execMinute: 23 * 60,
          postDate: date,
          postMinute: 23 * 60,
          pendingFirst: false,
          leg: {
            accountId: txnAcct.id,
            amount: -400n,
            type: 'FEE',
            description: 'MONTHLY ACCOUNT FEE',
            reference: '',
            truth: { kind: 'fee', categoryId: 'fees.bank' },
          },
        });
        if (ccAcct && m === ccFeeMonth) {
          post({
            seq: postingSeq++,
            execDate: date,
            execMinute: 23 * 60 + 1,
            postDate: date,
            postMinute: 23 * 60 + 1,
            pendingFirst: false,
            leg: {
              accountId: ccAcct.id,
              amount: -12900n,
              type: 'FEE',
              description: 'ANNUAL CARD FEE',
              reference: '',
              truth: { kind: 'fee', categoryId: 'fees.bank' },
            },
          });
        }
      }
      if (savAcct?.interestPa) {
        const bal = balances.get(savAcct.id) ?? 0n;
        const interest = toMinor((Number(bal) / 100) * (savAcct.interestPa / 12));
        if (interest > 0n) {
          post({
            seq: postingSeq++,
            execDate: date,
            execMinute: 23 * 60 + 50,
            postDate: date,
            postMinute: 23 * 60 + 50,
            pendingFirst: false,
            leg: {
              accountId: savAcct.id,
              amount: interest,
              type: 'INTEREST_PAID',
              description: 'CREDIT INTEREST',
              reference: '',
              truth: { kind: 'interest', categoryId: 'income.interest' },
            },
          });
        }
      }
      if (savAcct) {
        const bal = balances.get(txnAcct.id) ?? 0n;
        if (bal > bufferMinor * 2n) {
          const sweep = ((bal - bufferMinor) / 10000n) * 10000n;
          if (sweep > 0n) transfer(date, 23 * 60 + 30, txnAcct.id, savAcct.id, sweep, 'SAVE');
        }
      }
      snapshot(date, zonedDateTime(date, 23, 59, 59, tz));
    }
  }

  // ---- Missing transaction ids (noise) and truth ----
  const truth: Truth = { transactions: {}, assets };
  const finalId = new Map<string, string>();
  for (const r of records) {
    if (!r.hasId) {
      const hid = await syntheticTxnId({
        accountId: r.accountId,
        ...(r.postingDateTime ? { postingDateTime: r.postingDateTime } : {}),
        executionDateTime: r.executionDateTime,
        amount: r.amount,
        description: r.description,
      });
      finalId.set(r.id, hid);
    }
  }
  const idOf = (id: string) => finalId.get(id) ?? id;
  for (const r of records) {
    const t: TruthLabel = { ...r.truth };
    if (t.supersededBy) t.supersededBy = idOf(t.supersededBy);
    if (t.refundOf) t.refundOf = idOf(t.refundOf);
    truth.transactions[`${r.accountId}/${idOf(r.id)}`] = t;
  }

  // ---- Files ----
  const files: SynthFile[] = [];
  const json = (path: string, body: object) =>
    files.push({
      path,
      content: JSON.stringify({ 'x-synthetic': marker, ...body }, null, 2) + '\n',
    });

  const maskedNumber = (i: number) => `xxxx xxxx xxxx ${i + 1}SYN`;
  json('accounts.json', {
    data: {
      accounts: accounts.map((a, i) => ({
        accountId: a.id,
        creationDate: addDays(start, -365 * (2 + i)),
        displayName: a.name ?? a.id,
        nickname: a.name ?? a.id,
        openStatus: 'OPEN',
        isOwned: true,
        accountOwnership: 'ONE_PARTY',
        maskedNumber: maskedNumber(i),
        productCategory: a.productCategory,
        productName: `Synthetic ${a.role === 'credit' ? 'Card' : a.role === 'savings' ? 'Saver' : 'Everyday Account'}`,
      })),
    },
    links: { self: 'https://synthetic.invalid/banking/accounts' },
    meta: { totalRecords: accounts.length, totalPages: 1 },
  });

  for (const s of snapshots) {
    files.push({
      path: `balances/${s.date}.json`,
      content:
        JSON.stringify(
          {
            'x-synthetic': marker,
            'x-as-at': s.asAt,
            data: {
              balances: accounts.map((a) => {
                const cur = s.balances.get(a.id) ?? 0n;
                const limit = a.limit ? parseAmount(a.limit) : 0n;
                return {
                  accountId: a.id,
                  currentBalance: formatAmount(cur),
                  availableBalance: formatAmount(a.role === 'credit' ? limit + cur : cur),
                  ...(a.role === 'credit' ? { creditLimit: formatAmount(limit) } : {}),
                  currency: 'AUD',
                };
              }),
            },
            links: { self: 'https://synthetic.invalid/banking/accounts/balances' },
            meta: { totalRecords: accounts.length, totalPages: 1 },
          },
          null,
          2
        ) + '\n',
    });
  }

  const pageSize = persona.pageSize ?? 100;
  const pageRng = rng.fork('pages');
  for (const a of accounts) {
    const recs = records
      .filter((r) => r.accountId === a.id)
      .sort((x, y) =>
        x.sortKey === y.sortKey ? (x.id < y.id ? 1 : -1) : x.sortKey < y.sortKey ? 1 : -1
      );
    const totalPages = Math.max(1, Math.ceil(recs.length / pageSize));
    const base = `https://synthetic.invalid/banking/accounts/${a.id}/transactions`;
    const pageBody = (items: Rec[], n: number) => ({
      data: { transactions: items.map((r) => cdrTxn(r, idOf(r.id))) },
      links: {
        self: `${base}?page=${n}`,
        first: `${base}?page=1`,
        ...(n > 1 ? { prev: `${base}?page=${n - 1}` } : {}),
        ...(n < totalPages ? { next: `${base}?page=${n + 1}` } : {}),
        last: `${base}?page=${totalPages}`,
      },
      meta: { totalRecords: recs.length, totalPages },
    });
    for (let n = 1; n <= totalPages; n++) {
      const items = recs.slice((n - 1) * pageSize, n * pageSize);
      json(`transactions/${a.id}/page-${n}.json`, pageBody(items, n));
      // Noise: an overlapping re-export straddling this page and the next.
      if (n < totalPages && pageRng.chance(noise.duplicatePages ?? 0)) {
        const half = Math.floor(pageSize / 2);
        const overlap = recs.slice((n - 1) * pageSize + half, n * pageSize + half);
        json(`transactions/${a.id}/page-${n}-overlap.json`, pageBody(overlap, n));
      }
    }
  }

  files.push(...workbook(persona, marker, assets));
  files.push({
    path: 'truth.json',
    content: JSON.stringify({ 'x-synthetic': marker, ...truth }, null, 2) + '\n',
  });

  const personaSha256 = await sha256Hex(canonicalJson(persona));
  const listed = [];
  for (const f of [...files].sort((x, y) => (x.path < y.path ? -1 : 1))) {
    listed.push({
      path: f.path,
      sha256: await sha256Hex(f.content),
      bytes: new TextEncoder().encode(f.content).length,
    });
  }
  json('manifest.json', {
    generator: GENERATOR,
    persona: persona.name,
    personaSha256,
    seed,
    start,
    end,
    months: persona.months,
    timezone: tz,
    files: listed,
  });
  files.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { files, truth };
}

function cdrTxn(r: Rec, id: string): Record<string, unknown> {
  return {
    accountId: r.accountId,
    ...(r.hasId ? { transactionId: id } : {}),
    isDetailAvailable: false,
    type: r.type,
    status: r.status,
    description: r.description,
    ...(r.postingDateTime ? { postingDateTime: r.postingDateTime } : {}),
    executionDateTime: r.executionDateTime,
    amount: r.amount,
    currency: 'AUD',
    reference: r.reference,
    ...(r.merchantName ? { merchantName: r.merchantName } : {}),
    ...(r.mcc ? { merchantCategoryCode: r.mcc } : {}),
    ...(r.billerCode ? { billerCode: r.billerCode } : {}),
    ...(r.billerName ? { billerName: r.billerName } : {}),
  };
}

// ---- Synthetic budget workbook, one CSV per sheet (§6.2, ADR 0003) ----

const TIER_MULTIPLIERS: Record<string, [number, number, number]> = {
  housing: [1, 1.25, 1.6],
  utilities: [1, 1, 1.2],
  comms: [1, 1, 1.25],
  health: [1, 1.2, 1.5],
  'food.groceries': [1, 1.2, 1.5],
  'food.cafe': [0, 1, 2],
  'food.dining': [0.5, 1, 2],
  transport: [1, 1, 1.3],
  leisure: [0.5, 1, 2],
  subscriptions: [0, 1, 1.5],
};
const PERIOD_CODE: Record<Every, string> = {
  day: 'd',
  week: 'w',
  fortnight: 'f',
  month: 'm',
  quarter: 'q',
  year: 'y',
};
const PER_WEEK: Record<string, number> = { d: 7, w: 1, f: 0.5, m: 12 / 52, q: 4 / 52, y: 1 / 52 };

function multipliers(categoryId: string): [number, number, number] {
  return (
    TIER_MULTIPLIERS[categoryId] ??
    TIER_MULTIPLIERS[categoryId.split('.')[0] ?? ''] ?? [1, 1.25, 1.5]
  );
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function workbook(p: Persona, marker: Record<string, string>, assets: TruthAsset[]): SynthFile[] {
  const header = `# x-synthetic: generator=${marker.generator}, seed=${marker.seed}, persona=${marker.persona}\r\n`;
  type Line = {
    cat: string;
    item: string;
    cost: number;
    unit: string;
    categoryId: string;
    notes: string;
  };
  const lines: Line[] = [];
  for (const r of p.recurring ?? []) {
    lines.push({
      cat: r.category.split('.')[0] ?? r.category,
      item: r.payee ?? r.category,
      cost: Number(r.amount ?? r.mean),
      unit: PERIOD_CODE[r.every],
      categoryId: r.category,
      notes: r.mean ? 'average bill' : '',
    });
  }
  for (const v of p.variable ?? []) {
    const perWeek = v.weeklyMean
      ? Number(v.weeklyMean)
      : (v.dailyProb ?? 0) *
        7 *
        Math.exp((v.amount?.lognormal[0] ?? 2) + (v.amount?.lognormal[1] ?? 0.3) ** 2 / 2);
    lines.push({
      cat: v.category.split('.')[0] ?? v.category,
      item: titleCase(v.category.split('.').pop() ?? v.category),
      cost: Math.round(perWeek * 100) / 100,
      unit: 'w',
      categoryId: v.category,
      notes: '',
    });
  }
  lines.sort((a, b) => (a.cat === b.cat ? (a.item < b.item ? -1 : 1) : a.cat < b.cat ? -1 : 1));
  const rows: (string | number)[][] = [
    [
      'Category',
      'Item',
      'Cost',
      'Unit',
      'Start Date',
      'Renew Date',
      'Fin. Secure',
      'Fin. Indepnt',
      'Fin. Luxury',
      'Sub-category',
      'Notes',
    ],
  ];
  const totals = [0, 0, 0];
  let current = '';
  for (const l of lines) {
    if (l.cat !== current) {
      rows.push([titleCase(l.cat), '', '', '', '', '', '', '', '', '', '']);
      current = l.cat;
    }
    const mult = multipliers(l.categoryId);
    mult.forEach((mv, i) => (totals[i] = (totals[i] ?? 0) + l.cost * (PER_WEEK[l.unit] ?? 0) * mv));
    rows.push([
      '',
      l.item,
      l.cost.toFixed(2),
      l.unit,
      '',
      '',
      mult[0],
      mult[1],
      mult[2],
      l.categoryId,
      l.notes,
    ]);
  }
  rows.push([
    'TOTAL per week',
    '',
    '',
    '',
    '',
    '',
    totals[0]!.toFixed(2),
    totals[1]!.toFixed(2),
    totals[2]!.toFixed(2),
    '',
    '',
  ]);

  const capexRows: (string | number)[][] = [
    [
      'Source Year',
      'Item',
      'Forecast Spend',
      'Paid?',
      'Date Paid',
      'Actual Spend',
      'Expected Life',
      'Replacement Year',
      'Product URL',
    ],
  ];
  for (const c of p.capex ?? []) {
    const a = assets.find((x) => x.name === c.asset);
    const forecast = typeof c.cost === 'string' ? Number(c.cost) : (c.cost.normal[0] ?? 0);
    const life = c.lifeYears ?? (c.every === 'year' ? 1 : '');
    const dates = [
      ...(a?.lastBought && !a.lastBoughtAssumed ? [a.lastBought] : []),
      ...(a?.purchases ?? []),
    ];
    if (dates.length === 0) {
      capexRows.push([
        p.start.slice(0, 4),
        c.asset,
        forecast.toFixed(2),
        'No',
        '',
        '',
        life,
        '',
        '',
      ]);
    }
    for (const dt of dates) {
      const ry = typeof life === 'number' ? String(Math.round(Number(dt.slice(0, 4)) + life)) : '';
      capexRows.push([
        dt.slice(0, 4),
        c.asset,
        forecast.toFixed(2),
        'Yes',
        dt,
        forecast.toFixed(2),
        life,
        ry,
        '',
      ]);
    }
  }

  const opening = p.accounts.reduce(
    (s, a) => s + Number(a.opening ?? 0) * (a.role === 'credit' ? 0 : 1),
    0
  );
  const goalRows: (string | number)[][] = [
    ['Field', 'Value'],
    ['Starting balance', opening.toFixed(2)],
    ['Budget need (per year, secure tier)', (totals[0]! * 52).toFixed(2)],
    ['Return', '0.05'],
    ['Inflation', '0.03'],
    ['Tax rate', '0.30'],
    ['CGT discount', '0.50'],
    ['Years', '40'],
  ];

  return [
    { path: 'workbook/opex-budget.csv', content: header + writeCsv(rows) },
    { path: 'workbook/capex-register.csv', content: header + writeCsv(capexRows) },
    { path: 'workbook/goal.csv', content: header + writeCsv(goalRows) },
  ];
}
