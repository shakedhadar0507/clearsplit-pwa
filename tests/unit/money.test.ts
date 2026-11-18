import { describe, it, expect } from 'vitest';
import { parseAmount, minorToDecimalString, parsePercent, formatMoney } from '@/lib/money';
import { csvCell, toCsv } from '@/lib/csv';

describe('money parsing', () => {
  it('parses without float errors', () => {
    expect(parseAmount('0.1', 'ILS')).toBe(10);
    expect(parseAmount('0.29', 'ILS')).toBe(29);
    expect(parseAmount('1,234.56', 'USD')).toBe(123456);
    expect(parseAmount('₪300', 'ILS')).toBe(30000);
    expect(parseAmount('.5', 'ILS')).toBe(50);
    expect(parseAmount('12.345', 'ILS')).toBeNull();
    expect(parseAmount('abc', 'ILS')).toBeNull();
    expect(parseAmount('-5', 'ILS')).toBeNull();
    expect(parseAmount('100', 'JPY')).toBe(100);
    expect(parseAmount('1.5', 'JPY')).toBeNull();
  });
  it('round trips', () => {
    expect(minorToDecimalString(123456, 'ILS')).toBe('1234.56');
    expect(minorToDecimalString(-5, 'ILS')).toBe('-0.05');
    expect(minorToDecimalString(100, 'JPY')).toBe('100');
  });
  it('percent in basis points', () => {
    expect(parsePercent('33.33')).toBe(3333);
    expect(parsePercent('50')).toBe(5000);
    expect(parsePercent('12.345')).toBeNull();
  });
  it('formats ILS', () => {
    expect(formatMoney(30000, 'ILS', 'en-US')).toBe('₪300.00');
  });
});

describe('csv', () => {
  it('neutralises formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1+1')).toBe(`'+1+1`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('ארוחה, ערב')).toBe('"ארוחה, ערב"');
  });
  it('adds BOM for Hebrew in Excel', () => {
    expect(toCsv([['שם']]).startsWith('﻿')).toBe(true);
  });
});
