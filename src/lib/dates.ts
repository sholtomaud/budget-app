/**
 * Calendar dates as 'YYYY-MM-DD' strings and time-zone conversion through
 * Intl (FR-ING-008). No date library.
 */
export type IsoDate = string;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isoDate(y: number, m: number, d: number): IsoDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseIsoDate(s: IsoDate): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Not an ISO date: "${s}"`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Days since 1970-01-01 for a calendar date (proleptic Gregorian). */
export function dayNumber(s: IsoDate): number {
  const { y, m, d } = parseIsoDate(s);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNumber(n: number): IsoDate {
  const dt = new Date(n * 86400000);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(s) + days);
}

export function addMonths(s: IsoDate, months: number): IsoDate {
  const { y, m, d } = parseIsoDate(s);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return isoDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(s: IsoDate): number {
  return (((dayNumber(s) + 4) % 7) + 7) % 7;
}

export function monthKey(s: IsoDate): string {
  return s.slice(0, 7);
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

function wallClock(epochMs: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    y: p.year!,
    m: p.month!,
    d: p.day!,
    h: p.hour!,
    mi: p.minute!,
    s: p.second!,
  };
}

/** Offset of `tz` from UTC at an instant, in minutes (e.g. +660 for AEDT). */
export function tzOffsetMinutes(epochMs: number, tz: string): number {
  const w = wallClock(epochMs, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * ISO 8601 date-time with the zone's offset for a local wall-clock time, e.g.
 * '2025-03-14T09:12:00+11:00'. In a DST gap the instant shifts forward.
 */
export function zonedDateTime(date: IsoDate, h: number, mi: number, s: number, tz: string): string {
  const { y, m, d } = parseIsoDate(date);
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let off = tzOffsetMinutes(guess, tz);
  let epoch = guess - off * 60000;
  const off2 = tzOffsetMinutes(epoch, tz);
  if (off2 !== off) {
    off = off2;
    epoch = guess - off * 60000;
  }
  const w = wallClock(epoch, tz);
  const sign = off >= 0 ? '+' : '-';
  const ao = Math.abs(off);
  return `${isoDate(w.y, w.m, w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}${sign}${pad(Math.floor(ao / 60))}:${pad(ao % 60)}`;
}

/** The local calendar date in `tz` of an ISO date-time string (FR-ING-008). */
export function localDateOf(dateTime: string, tz: string): IsoDate {
  const ms = Date.parse(dateTime);
  if (Number.isNaN(ms)) throw new Error(`Not a date-time: "${dateTime}"`);
  const w = wallClock(ms, tz);
  return isoDate(w.y, w.m, w.d);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
