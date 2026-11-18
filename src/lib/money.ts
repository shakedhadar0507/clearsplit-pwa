/**
 * Money utilities. All amounts are integer minor units (e.g. agorot, cents).
 * Never use floating point arithmetic for balances.
 */

export interface CurrencyInfo {
  code: string;
  decimals: number;
  symbol: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  ILS: { code: 'ILS', decimals: 2, symbol: '₪' },
  USD: { code: 'USD', decimals: 2, symbol: '$' },
  EUR: { code: 'EUR', decimals: 2, symbol: '€' },
  GBP: { code: 'GBP', decimals: 2, symbol: '£' },
  JPY: { code: 'JPY', decimals: 0, symbol: '¥' },
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES);
export const DEFAULT_CURRENCY = 'ILS';

export function currencyInfo(code: string): CurrencyInfo {
  const info = CURRENCIES[code];
  if (!info) throw new Error(`Unsupported currency: ${code}`);
  return info;
}

/**
 * Parse a user-entered decimal string into integer minor units without floats.
 * Accepts "12", "12.5", "12.50", "1,234.56" (comma thousands separators).
 * Returns null for invalid input or too many decimal places.
 */
export function parseAmount(input: string, currency: string): number | null {
  const { decimals } = currencyInfo(currency);
  const s = input.trim().replace(/[\s,]/g, '').replace(/^[₪$€£¥]/, '');
  if (!/^\d+(\.\d*)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const [intPart = '0', fracRaw = ''] = s.split('.');
  if (fracRaw.length > decimals) return null;
  const frac = fracRaw.padEnd(decimals, '0');
  const digits = (intPart || '0') + frac;
  const value = Number(BigInt(digits));
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Convert minor units to a plain decimal string ("1234.50"). */
export function minorToDecimalString(minor: number, currency: string): string {
  const { decimals } = currencyInfo(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  if (decimals === 0) return (neg ? '-' : '') + abs.toString();
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** Locale-aware currency formatting. Formatting only – never used for math. */
export function formatMoney(minor: number, currency: string, locale = 'he-IL', opts: { signed?: boolean } = {}): string {
  const { decimals } = currencyInfo(currency);
  const str = minorToDecimalString(minor, currency);
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  });
  // Intl accepts decimal strings in modern engines; precision preserved.
  return fmt.format(str as unknown as number);
}

/** Percent stored in basis points: 100% = 10000. */
export function parsePercent(input: string): number | null {
  const s = input.trim().replace('%', '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}
