import type { TFunction } from 'i18next';
import type { Expense } from './api';
import { toCsv } from './csv';
import { minorToDecimalString } from './money';

export function downloadBlob(content: string | Blob, filename: string, type = 'text/csv;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV export with exact decimal amounts (no float formatting), UTF-8 BOM for Hebrew, formula-injection protection. */
export function exportExpensesCsv(
  expenses: Expense[],
  o: { names: (id: string, opts?: { you?: boolean }) => string; groupName: (gid: string) => string; lang: string; t: TFunction; filename: string; me?: string },
) {
  const header = [
    o.t('common.date'), o.t('common.description'), o.t('common.category'), o.t('activity.group'), o.t('common.currency'),
    o.t('common.amount'), o.t('expense.paidBy'), o.t('expense.participants'), o.t('expense.splitMethod'), o.t('common.notes'), 'Status', 'ID',
  ];
  if (o.me) header.splice(6, 0, o.t('expense.yourShare'));
  const rows = expenses.map((e) => {
    const r: unknown[] = [
      e.expense_date, e.description, o.t(`expense.categories.${e.category}`), o.groupName(e.group_id), e.currency,
      minorToDecimalString(e.amount_minor, e.currency),
      e.expense_payers.map((p) => `${o.names(p.user_id, { you: false })}: ${minorToDecimalString(p.amount_minor, e.currency)}`).join('; '),
      e.expense_splits.map((s) => `${o.names(s.user_id, { you: false })}: ${minorToDecimalString(s.amount_minor, e.currency)}`).join('; '),
      o.t(`expense.methods.${e.split_method}`), e.notes ?? '', e.deleted_at ? 'deleted' : 'active', e.id,
    ];
    if (o.me) r.splice(6, 0, minorToDecimalString(e.expense_splits.find((s) => s.user_id === o.me)?.amount_minor ?? 0, e.currency));
    return r;
  });
  const safeName = o.filename.replace(/[\\/:*?"<>|]+/g, '_');
  downloadBlob(toCsv([header, ...rows]), `${safeName}-${new Date().toISOString().slice(0, 10)}.csv`);
}
