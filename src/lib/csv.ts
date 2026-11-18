/** CSV helpers with formula-injection protection and Excel-friendly UTF-8 BOM (Hebrew). */

const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  // Neutralise spreadsheet formula injection (OWASP): prefix with apostrophe.
  // Negative numbers are emitted by callers as plain numeric strings and are allowed.
  if (DANGEROUS.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
