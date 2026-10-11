/**
 * Money as integer minor units (FR-ING-003). Decimal strings are parsed
 * digit by digit, never through a binary float.
 */
export interface Money {
  minor: bigint;
  ccy: string;
}

/** Minor-unit exponent per currency or asset code. BTC is held in satoshis. */
const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, BTC: 8, ETH: 18 };

export function exponentOf(ccy: string): number {
  return EXPONENT[ccy] ?? 2;
}

/**
 * Parse a CDR AmountString ("-63.85", "1200", "+5.1") to minor units.
 * Rejects more fractional digits than the currency allows, unless they are zeros.
 */
export function parseAmount(s: string, ccy = 'AUD'): bigint {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`Not a decimal amount: "${s}"`);
  const exp = exponentOf(ccy);
  let frac = m[3] ?? '';
  if (frac.length > exp) {
    if (/[^0]/.test(frac.slice(exp))) {
      throw new Error(`"${s}" has more than ${exp} decimal places for ${ccy}`);
    }
    frac = frac.slice(0, exp);
  }
  const digits = (m[2] ?? '0') + frac.padEnd(exp, '0');
  const v = BigInt(digits);
  return m[1] === '-' ? -v : v;
}

/** Minor units → plain decimal string ("-63.85"), as CDR writes amounts. */
export function formatAmount(minor: bigint, ccy = 'AUD'): string {
  const exp = exponentOf(ccy);
  const neg = minor < 0n;
  const abs = (neg ? -minor : minor).toString().padStart(exp + 1, '0');
  const int = exp ? abs.slice(0, -exp) : abs;
  const frac = exp ? `.${abs.slice(-exp)}` : '';
  return `${neg ? '-' : ''}${int}${frac}`;
}

/** Display formatting, e.g. "-$63.85". Display only; never parse the result. */
export function displayMoney(minor: bigint, ccy = 'AUD', locale = 'en-AU'): string {
  const exp = exponentOf(ccy);
  const value = Number(minor) / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: ccy }).format(value);
  } catch {
    return `${formatAmount(minor, ccy)} ${ccy}`;
  }
}

/** Round a float amount (in major units) to minor units. For synthetic generation only. */
export function toMinor(major: number, ccy = 'AUD'): bigint {
  return BigInt(Math.round(major * 10 ** exponentOf(ccy)));
}
