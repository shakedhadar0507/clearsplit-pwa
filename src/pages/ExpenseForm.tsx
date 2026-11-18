import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Paperclip, X, WifiOff } from 'lucide-react';
import { Button, Card, EmptyState, Field, Input, Money, PageHeader, Segmented, Select, Spinner, Textarea, cx, useToast } from '@/components/ui';
import { BackButton, EXPENSE_CATEGORIES, EXPENSE_ICONS, UserAvatar, todayIso, useGroupTitle, useNames } from '@/components/common';
import { rpc, useExpense, useGroups, useMe, type Expense, type ExpenseCategory } from '@/lib/api';
import { computeSplit, type SplitMethod } from '@/lib/split';
import { minorToDecimalString, parseAmount, parsePercent, SUPPORTED_CURRENCIES } from '@/lib/money';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline, uuid } from '@/lib/hooks';
import { uploadReceipt, validateReceipt } from '@/lib/receipts';

const fmtHundredths = (v: number) => (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2));

export function ExpenseFormPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const existing = useExpense(id);
  if (id && existing.isLoading) return <Spinner />;
  if (id && !existing.data) return <EmptyState title={t('expense.notFound')} />;
  return <ExpenseForm key={id ?? 'new'} initial={existing.data?.expense} />;
}

function ExpenseForm({ initial }: { initial?: Expense }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const me = session!.user.id;
  const profile = useMe();
  const groups = useGroups();
  const names = useNames();
  const groupTitle = useGroupTitle();
  const idemKey = useRef(uuid());

  const selectable = (groups.data ?? []).filter((g) => !g.archived_at || g.id === initial?.group_id);
  const [groupId, setGroupId] = useState(initial?.group_id ?? params.get('group') ?? '');
  const group = selectable.find((g) => g.id === groupId);
  const members = useMemo(() => (group?.group_members ?? []).filter((m) => !m.left_at).map((m) => m.user_id), [group]);

  const [description, setDescription] = useState(initial?.description ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? '');
  const [amountStr, setAmountStr] = useState(initial ? minorToDecimalString(initial.amount_minor, initial.currency) : '');
  const [date, setDate] = useState(initial?.expense_date ?? todayIso());
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'food');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [multiPay, setMultiPay] = useState((initial?.expense_payers.length ?? 1) > 1);
  const [payer, setPayer] = useState(initial?.expense_payers[0]?.user_id ?? me);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.expense_payers ?? []).map((p) => [p.user_id, minorToDecimalString(p.amount_minor, initial!.currency)])));
  const [method, setMethod] = useState<SplitMethod>(initial?.split_method ?? 'equal');
  const [participants, setParticipants] = useState<Set<string>>(() => new Set(initial?.expense_splits.filter((s) => initial.split_method !== 'equal' || s.amount_minor > 0).map((s) => s.user_id) ?? []));
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!initial) return {};
    return Object.fromEntries(initial.expense_splits.map((s) => {
      const v = s.input_value ?? s.amount_minor;
      if (initial.split_method === 'exact') return [s.user_id, minorToDecimalString(s.amount_minor, initial.currency)];
      if (initial.split_method === 'percentage' || initial.split_method === 'shares') return [s.user_id, fmtHundredths(v)];
      return [s.user_id, ''];
    }));
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defaults when the group changes (new expense only)
  useEffect(() => {
    if (!group) return;
    if (!currency) setCurrency(group.currency || profile.data?.default_currency || 'ILS');
    if (!initial) {
      setParticipants(new Set(members));
      if (!members.includes(payer)) setPayer(members.includes(me) ? me : members[0]);
    }
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = currency || 'ILS';
  const total = parseAmount(amountStr, cur);
  const parts = members.filter((u) => participants.has(u));

  const split = useMemo(() => {
    if (!total) return null;
    const inputs = parts.map((userId) => {
      const raw = values[userId] ?? '';
      if (method === 'exact') return { userId, value: parseAmount(raw || '0', cur) ?? -1 };
      if (method === 'percentage') return { userId, value: parsePercent(raw || '0') ?? -1 };
      if (method === 'shares') return { userId, value: parsePercent(raw === '' ? '1' : raw) ?? -1 };
      return { userId };
    });
    return computeSplit(total, method, inputs);
  }, [total, parts.join(','), method, values, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const payers = useMemo(() => {
    if (!total) return null;
    if (!multiPay) return [{ userId: payer, amount: total }];
    return members.map((u) => ({ userId: u, amount: parseAmount(payerAmounts[u] || '0', cur) ?? -1 })).filter((p) => p.amount !== 0);
  }, [multiPay, payer, payerAmounts, members, total, cur]);
  const payersSum = payers?.reduce((s, p) => s + Math.max(p.amount, 0), 0) ?? 0;
  const payersOk = !!payers && payers.length > 0 && payers.every((p) => p.amount > 0) && payersSum === total;

  const sumOf = (fn: (u: string) => number | null) => parts.reduce((s, u) => s + Math.max(fn(u) ?? 0, 0), 0);
  const exactSum = method === 'exact' ? sumOf((u) => parseAmount(values[u] || '0', cur)) : 0;
  const pctSum = method === 'percentage' ? sumOf((u) => parsePercent(values[u] || '0')) : 0;

  const canSave = online && !!group && !!description.trim() && !!total && total > 0 && !!split?.ok && payersOk && !busy;

  const toggle = (u: string) => setParticipants((s) => {
    const n = new Set(s);
    if (n.has(u)) n.delete(u); else n.add(u);
    return n;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !split?.ok || !payers || !group) return;
    setBusy(true);
    setError(null);
    const inputVal = (u: string) => {
      const raw = values[u] ?? '';
      if (method === 'exact') return parseAmount(raw || '0', cur);
      if (method === 'percentage') return parsePercent(raw || '0');
      if (method === 'shares') return parsePercent(raw === '' ? '1' : raw);
      return null;
    };
    const p = {
      group_id: group.id, description: description.trim(), category, currency: cur, amount_minor: total, expense_date: date,
      notes: notes.trim() || null, split_method: method,
      payers: payers.map((x) => ({ user_id: x.userId, amount_minor: x.amount })),
      splits: split.allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amount, input_value: inputVal(a.userId) })),
      idempotency_key: idemKey.current,
    };
    try {
      let eid = initial?.id;
      if (initial) await rpc('update_expense', { p_expense_id: initial.id, p, p_expected_version: initial.version });
      else eid = await rpc<string>('create_expense', { p });
      for (const f of files) await uploadReceipt(group.id, eid!, f);
      await qc.invalidateQueries();
      toast(t('expense.saved'));
      navigate(initial ? `/expense/${eid}` : group.is_direct ? `/friends/${group.group_members.find((m) => m.user_id !== me)?.user_id}` : `/groups/${group.id}`, { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (groups.isLoading) return <Spinner />;

  return (
    <form onSubmit={submit} className="animate-fade-in" noValidate>
      <PageHeader back={<BackButton />} title={initial ? t('expense.edit') : t('expense.new')} />
      {!online && <div className="rounded-xl bg-warn-soft text-warn text-sm p-3 mb-4 flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 shrink-0" />{t('pwa.offlineWrite')}</div>}

      <Card className="p-4 space-y-4">
        <Field label={t('expense.group')} htmlFor="e-group">
          <Select id="e-group" value={groupId} disabled={!!initial} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="" disabled>{t('expense.pickGroup')}</option>
            {selectable.filter((g) => !g.is_direct).map((g) => <option key={g.id} value={g.id}>{groupTitle(g)}</option>)}
            {selectable.some((g) => g.is_direct) && (
              <optgroup label={t('friends.title')}>
                {selectable.filter((g) => g.is_direct).map((g) => <option key={g.id} value={g.id}>{groupTitle(g)}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label={t('expense.description')} htmlFor="e-desc">
          <Input id="e-desc" maxLength={120} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('expense.categories.food')} />
        </Field>
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <Field label={t('expense.amount')} htmlFor="e-amount" error={amountStr && total === null ? t('errors.invalid_amount') : null}>
            <Input id="e-amount" inputMode="decimal" dir="ltr" required className="text-2xl h-14 font-semibold tabular" value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t('common.currency')} htmlFor="e-cur">
            <Select id="e-cur" className="h-14" value={cur} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="label">{t('common.category')}</legend>
          <div className="grid grid-cols-5 gap-1.5">
            {EXPENSE_CATEGORIES.map((c) => {
              const Icon = EXPENSE_ICONS[c];
              return (
                <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                  className={cx('flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition-colors',
                    category === c ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-elev text-muted hover:text-fg')}>
                  <Icon className="h-[18px] w-[18px]" />{t(`expense.categories.${c}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field label={t('expense.date')} htmlFor="e-date">
          <Input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </Card>

      {group && (
        <>
          {/* Payers */}
          <Card className="p-4 mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t('expense.paidBy')}</h2>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={multiPay} onChange={(e) => setMultiPay(e.target.checked)} />
                {t('expense.multiplePayers')}
              </label>
            </div>
            {!multiPay ? (
              <Select aria-label={t('expense.paidBy')} value={payer} onChange={(e) => setPayer(e.target.value)}>
                {members.map((u) => <option key={u} value={u}>{names(u)}</option>)}
              </Select>
            ) : (
              <div className="space-y-2">
                {members.map((u) => (
                  <div key={u} className="flex items-center gap-3">
                    <UserAvatar id={u} size={32} />
                    <span className="flex-1 text-sm truncate">{names(u)}</span>
                    <Input aria-label={`${t('expense.paidBy')} ${names(u)}`} inputMode="decimal" dir="ltr" className="w-32 tabular" value={payerAmounts[u] ?? ''}
                      onChange={(e) => setPayerAmounts((s) => ({ ...s, [u]: e.target.value }))} placeholder="0.00" />
                  </div>
                ))}
                {total ? (
                  <p className={cx('text-xs text-end', payersSum === total ? 'text-pos' : 'text-neg')}>
                    {t('expense.totalPaid')}: <Money minor={payersSum} currency={cur} /> / <Money minor={total} currency={cur} />
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          {/* Split */}
          <Card className="p-4 mt-4 space-y-3">
            <h2 className="font-semibold">{t('expense.split')}</h2>
            <Segmented label={t('expense.splitMethod')} value={method} onChange={setMethod} options={(['equal', 'exact', 'percentage', 'shares'] as const).map((m) => ({ value: m, label: t(`expense.methods.${m}`) }))} />
            <div className="flex justify-end">
              <button type="button" className="text-xs text-primary font-medium" onClick={() => setParticipants(new Set(participants.size === members.length ? [] : members))}>{t('expense.selectAll')}</button>
            </div>
            <ul className="space-y-1.5">
              {members.map((u) => {
                const on = participants.has(u);
                const alloc = split?.ok ? split.allocations.find((a) => a.userId === u)?.amount : undefined;
                return (
                  <li key={u} className={cx('flex items-center gap-3 rounded-xl px-2 py-1.5', on ? '' : 'opacity-50')}>
                    <button type="button" role="checkbox" aria-checked={on} aria-label={names(u)} onClick={() => toggle(u)}
                      className={cx('h-6 w-6 rounded-lg border grid place-items-center shrink-0 transition-colors', on ? 'bg-primary border-primary text-primary-fg' : 'border-line bg-elev')}>
                      {on && <Check className="h-4 w-4" />}
                    </button>
                    <UserAvatar id={u} size={30} />
                    <span className="flex-1 text-sm truncate">{names(u)}</span>
                    {on && method !== 'equal' && (
                      <div className="relative">
                        <Input aria-label={`${t(`expense.methods.${method}`)} ${names(u)}`} inputMode="decimal" dir="ltr" className="w-24 h-9 text-sm tabular pe-7"
                          value={values[u] ?? ''} placeholder={method === 'shares' ? '1' : '0'}
                          onChange={(e) => setValues((s) => ({ ...s, [u]: e.target.value }))} />
                        <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">{method === 'percentage' ? '%' : method === 'shares' ? '×' : ''}</span>
                      </div>
                    )}
                    <span className="w-20 text-end text-sm font-medium" data-testid={`alloc-${u}`}>
                      {on && alloc !== undefined ? <Money minor={alloc} currency={cur} /> : <span className="text-muted">—</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {total ? (
              <div aria-live="polite" className="text-xs text-end">
                {method === 'exact' && exactSum !== total && <span className="text-neg">{exactSum < total ? t('expense.remaining', { amount: '' }) : t('expense.over', { amount: '' })}<Money minor={Math.abs(total - exactSum)} currency={cur} /></span>}
                {method === 'percentage' && pctSum !== 10000 && <span className="text-neg">{t('expense.percentRemaining', { value: fmtHundredths(10000 - pctSum) })}</span>}
                {split && !split.ok && !(method === 'exact' && split.error === 'exact_mismatch') && !(method === 'percentage' && split.error === 'percent_mismatch') && (
                  <span className="text-neg">{t(`errors.${split.error}`)}</span>
                )}
                {split?.ok && <span className="text-pos inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{t('expense.preview')}</span>}
              </div>
            ) : null}
          </Card>

          {/* Notes & receipts */}
          <Card className="p-4 mt-4 space-y-4">
            <Field label={`${t('expense.notes')} (${t('common.optional')})`} htmlFor="e-notes">
              <Textarea id="e-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div>
              <span className="label">{t('expense.receipts')}</span>
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-elev border border-line px-2 py-1 text-xs">
                    <Paperclip className="h-3.5 w-3.5" />{f.name.slice(0, 24)}
                    <button type="button" aria-label={t('common.delete')} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-primary cursor-pointer hover:bg-elev">
                  <Paperclip className="h-4 w-4" />{t('expense.addReceipt')}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" multiple onChange={(e) => {
                    const list = [...(e.target.files ?? [])];
                    for (const f of list) {
                      const err = validateReceipt(f);
                      if (err) toast(t(err), 'error');
                    }
                    setFiles((fs) => [...fs, ...list.filter((f) => !validateReceipt(f))].slice(0, 5));
                    e.target.value = '';
                  }} />
                </label>
              </div>
            </div>
          </Card>
        </>
      )}

      {error && <p role="alert" className="text-sm text-neg mt-4">{error}</p>}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 mt-5 z-20">
        <Button type="submit" size="lg" className="w-full shadow-pop" disabled={!canSave} loading={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
      </div>
    </form>
  );
}
