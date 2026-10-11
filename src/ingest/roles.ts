import type { AccountRole } from '../domain/types.ts';

/** Infer the account's role from its CDR product category and names. The user can override it. */
export function inferRole(productCategory: string, names: string): AccountRole {
  switch (productCategory) {
    case 'CRED_AND_CHRG_CARDS':
    case 'BUY_NOW_PAY_LATER':
      return 'credit';
    case 'RESIDENTIAL_MORTGAGES':
    case 'PERS_LOANS':
    case 'BUSINESS_LOANS':
    case 'LEASES':
    case 'MARGIN_LOANS':
    case 'OVERDRAFTS':
      return 'loan';
    case 'TERM_DEPOSITS':
      return 'savings';
    default:
      if (/offset/i.test(names)) return 'offset';
      return /sav|saver|bonus|interest|goal/i.test(names) ? 'savings' : 'transaction';
  }
}
