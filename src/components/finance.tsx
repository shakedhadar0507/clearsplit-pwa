import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Share2, Link2, Check, ArrowLeftRight, Info, Clock, CircleCheck, Undo2, X } from 'lucide-react';
import { Badge, Button, Field, Input, Money, Select, Sheet, Textarea, cx, useToast, ConfirmDialog } from './ui';
import { CategoryIcon, UserAvatar, useDateFmt, useNames, todayIso } from './common';
import { rpc, useRpcMutation, type Activity, type Expense, type Group, type Settlement } from '@/lib/api';
import { parseAmount, minorToDecimalString, SUPPORTED_CURRENCIES } from '@/lib/money';
import { simplifyDebts, type Balances } from '@/lib/ledger';
import { useAuth } from '@/lib/auth';
import { appUrl } from '@/lib/supabase';
import { errorText } from '@/lib/errors';
import { useOnline, uuid } from '@/lib/hooks';

// ---------------------------------------------------------------------------
export function InviteSheet({ open, onOpenChange, groupId }: { open: boolean; onOpenChange: (o: boolean) => void; groupId?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fmt = useDateFmt();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; expires_at: string; can_create_account: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = (o: boolean) => {
    if (!o) {
      setResult(null);
      setEmail('');
      setCopied(false);
    }
    onOpenChange(o);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ token: string; expires_at: string; can_create_account: boolean }>('create_invitation', { p_email: email.trim() || null, p_group_id: groupId ?? null });
      setResult({ link: `${appUrl}/join#${r.token}`, expires_at: r.expires_at, can_create_account: r.can_create_account });
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.link);
    setCopied(true);
    toast(t('common.copied'));
  };
  const share = async () => {
    if (!result) return;
    try {
      await navigator.share({ title: 'ClearSplit', text: t('join.title'), url: result.link });
    } catch { /* user cancelled */ }
  };
  const mailto = result && email.trim()
    ? `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('ClearSplit')}&body=${encodeURIComponent(result.link)}`
    : null;

  return (
    <Sheet open={open} onOpenChange={reset} title={groupId ? t('groups.invite') : t('friends.invite')}>
      {!result ? (
        <div className="space-y-4">
          <Field label={t('groups.inviteEmail')} htmlFor="inv-email" hint={t('groups.inviteEmailHint')}>
            <Input id="inv-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Button className="w-full" size="lg" onClick={create} loading={busy} disabled={!online}><Link2 className="h-5 w-5" />{t('groups.createInvite')}</Button>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          <p className="text-sm text-muted">{t('groups.inviteReady', { date: fmt.full(result.expires_at) })}</p>
          {!result.can_create_account && <p className="text-xs rounded-xl bg-warn-soft text-warn p-3">{t('groups.inviteNoAccount')}</p>}
          <div className="rounded-xl bg-elev border border-line p-3 text-xs break-all font-mono" dir="ltr" data-testid="invite-link">{result.link}</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{t('common.copy')}</Button>
            {'share' in navigator ? (
              <Button variant="secondary" onClick={share}><Share2 className="h-4 w-4" />{t('common.share')}</Button>
            ) : mailto ? (
              <a href={mailto}><Button variant="secondary" className="w-full">{t('auth.email')}</Button></a>
            ) : <span />}
          </div>
          {mailto && 'share' in navigator && <a href={mailto} className="block text-center text-sm text-primary">{t('auth.email')}</a>}
          <Button className="w-full" onClick={() => reset(false)}>{t('common.done')}</Button>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
export function SettleSheet({ open, onOpenChange, group, defaults }: {
  open: boolean; onOpenChange: (o: boolean) => void; group: Group; defaults?: { from?: string; to?: string; amount?: number; currency?: string };
}) {
  const { t } = useTranslation();
  const names = useNames();
  const toast = useToast();
  const online = useOnline();
  const { session } = useAuth();
  const me = session!.user.id;
  const members = group.group_members.filter((m) => !m.left_at);
  const [from, setFrom] = useState(defaults?.from ?? me);
  const [to, setTo] = useState(defaults?.to ?? members.find((m) => m.user_id !== (defaults?.from ?? me))?.user_id ?? '');
  const [currency, setCurrency] = useState(defaults?.currency ?? group.currency);
  const [amount, setAmount] = useState(defaults?.amount ? minorToDecimalString(defaults.amount, defaults.currency ?? group.currency) : '');
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [key] = useState(uuid);
  const m = useRpcMutation<{ p: Record<string, unknown> }, string>('record_settlement');
  const minor = parseAmount(amount, currency);
  const valid = minor !== null && minor > 0 && from && to && from !== to;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await m.mutateAsync({ p: { group_id: group.id, from_user: from, to_user: to, amount_minor: minor, currency, settled_on: date, notes, idempotency_key: key } });
      toast(t('settle.recorded'));
      onOpenChange(false);
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('settle.title')}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label={t('settle.payer')} htmlFor="s-from">
            <Select id="s-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {members.map((mm) => <option key={mm.user_id} value={mm.user_id}>{names(mm.user_id)}</option>)}
            </Select>
          </Field>
          <ArrowLeftRight className="h-5 w-5 text-muted mb-3" aria-hidden />
          <Field label={t('settle.recipient')} htmlFor="s-to">
            <Select id="s-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {members.filter((mm) => mm.user_id !== from).map((mm) => <option key={mm.user_id} value={mm.user_id}>{names(mm.user_id)}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label={t('common.amount')} htmlFor="s-amount" error={amount && minor === null ? t('errors.invalid_amount') : null}>
            <Input id="s-amount" inputMode="decimal" dir="ltr" className="text-lg font-semibold tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t('common.currency')} htmlFor="s-cur">
            <Select id="s-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t('common.date')} htmlFor="s-date">
          <Input id="s-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`${t('common.notes')} (${t('common.optional')})`} htmlFor="s-notes">
          <Textarea id="s-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="rounded-xl bg-elev border border-line p-3 text-xs text-muted flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p>{t('settle.disclaimer')}</p>
            <p className="mt-1 font-medium text-fg">{to === me ? t('settle.autoConfirmNote') : t('settle.pendingNote')}</p>
          </div>
        </div>
        {!online && <p className="text-xs text-warn">{t('pwa.offlineWrite')}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={!valid || !online} loading={m.isPending}>{t('settle.title')}</Button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
export function ExpenseRow({ e, groupName }: { e: Expense; groupName?: string }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const names = useNames();
  const fmt = useDateFmt();
  const me = session!.user.id;
  const paid = e.expense_payers.find((p) => p.user_id === me)?.amount_minor ?? 0;
  const owed = e.expense_splits.find((s) => s.user_id === me)?.amount_minor ?? 0;
  const net = paid - owed;
  const payerText = e.expense_payers.length > 1
    ? `${names(e.expense_payers[0].user_id)} +${e.expense_payers.length - 1}`
    : names(e.expense_payers[0]?.user_id);
  return (
    <Link to={`/expense/${e.id}`} className={cx('flex items-center gap-3 px-4 py-3 hover:bg-elev transition-colors', e.deleted_at && 'opacity-55')}>
      <CategoryIcon kind="expense" category={e.category} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{e.description}{e.deleted_at && <Badge tone="neg" className="ms-2">{t('expense.deleted')}</Badge>}</div>
        <div className="text-xs text-muted truncate">
          {fmt.day(e.expense_date)} · {t('expense.paidAmount', { name: payerText, amount: '' }).trim()} <Money minor={e.amount_minor} currency={e.currency} />
          {groupName && <> · {groupName}</>}
        </div>
      </div>
      <div className="text-end shrink-0">
        {net !== 0 ? (
          <>
            <div className="text-[11px] text-muted">{net > 0 ? t('balance.getsBack') : t('balance.youOwe')}</div>
            <Money minor={Math.abs(net)} currency={e.currency} className={cx('font-semibold text-sm', net > 0 ? 'text-pos' : 'text-neg')} />
          </>
        ) : <span className="text-xs text-muted">—</span>}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
const STATUS_TONE = { pending: 'warn', confirmed: 'pos', rejected: 'neg', cancelled: 'neutral', reversed: 'neg' } as const;

export function SettlementRow({ s, showActions = true }: { s: Settlement; showActions?: boolean }) {
  const { t } = useTranslation();
  const names = useNames();
  const fmt = useDateFmt();
  const toast = useToast();
  const online = useOnline();
  const { session } = useAuth();
  const me = session!.user.id;
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const confirm = useRpcMutation<{ p_id: string }>('confirm_settlement');
  const reject = useRpcMutation<{ p_id: string }>('reject_settlement');
  const cancel = useRpcMutation<{ p_id: string }>('cancel_settlement');
  const reverse = useRpcMutation<{ p_id: string; p_reason: string }>('reverse_settlement');

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  };

  const canConfirm = s.status === 'pending' && s.to_user === me;
  const canCancel = s.status === 'pending' && (s.created_by === me || s.from_user === me) && s.to_user !== me;
  const canReverse = s.status === 'confirmed' && (s.from_user === me || s.to_user === me);
  const Icon = s.status === 'pending' ? Clock : s.status === 'confirmed' ? CircleCheck : s.status === 'reversed' ? Undo2 : X;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cx('h-11 w-11 rounded-2xl grid place-items-center shrink-0', s.status === 'confirmed' ? 'bg-pos-soft text-pos' : s.status === 'pending' ? 'bg-warn-soft text-warn' : 'bg-elev text-muted')}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{t('settle.paid', { from: names(s.from_user), to: names(s.to_user) })}</div>
          <div className="text-xs text-muted truncate">{fmt.day(s.settled_on)}{s.notes && ` · ${s.notes}`}{s.reversal_reason && ` · ${s.reversal_reason}`}</div>
        </div>
        <div className="text-end shrink-0">
          <Money minor={s.amount_minor} currency={s.currency} className={cx('font-semibold text-sm', ['rejected', 'cancelled', 'reversed'].includes(s.status) && 'line-through opacity-60')} />
          <div><Badge tone={STATUS_TONE[s.status]}>{t(`settle.status.${s.status}`)}</Badge></div>
        </div>
      </div>
      {showActions && (canConfirm || canCancel || canReverse) && (
        <div className="flex gap-2 mt-2.5 ps-14">
          {canConfirm && <Button size="sm" disabled={!online} loading={confirm.isPending} onClick={() => run(() => confirm.mutateAsync({ p_id: s.id }), t('settle.confirmed'))}>{t('settle.confirm')}</Button>}
          {canConfirm && <Button size="sm" variant="secondary" disabled={!online} loading={reject.isPending} onClick={() => run(() => reject.mutateAsync({ p_id: s.id }), t('settle.rejected'))}>{t('settle.reject')}</Button>}
          {canCancel && <Button size="sm" variant="secondary" disabled={!online} loading={cancel.isPending} onClick={() => run(() => cancel.mutateAsync({ p_id: s.id }), t('settle.cancelled'))}>{t('settle.cancel')}</Button>}
          {canReverse && <Button size="sm" variant="ghost" className="text-neg" disabled={!online} onClick={() => setReverseOpen(true)}>{t('settle.reverse')}</Button>}
        </div>
      )}
      <ConfirmDialog open={reverseOpen} onOpenChange={setReverseOpen} title={t('settle.reverse')} body={t('settle.reverseConfirm')} danger
        confirmLabel={t('settle.reverse')} loading={reverse.isPending}
        onConfirm={() => run(() => reverse.mutateAsync({ p_id: s.id, p_reason: reason }), t('settle.reversed')).then(() => setReverseOpen(false))}>
        <Field label={t('settle.reverseReason')} htmlFor="rev-reason" className="mb-4">
          <Input id="rev-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function useActivityText() {
  const { t } = useTranslation();
  const names = useNames();
  return (a: Activity) => {
    const d = a.details as Record<string, string>;
    return t(`activity.actions.${a.action}`, { actor: names(a.actor_id), description: d.description ?? '', name: d.name ?? '', defaultValue: a.action });
  };
}

export function ActivityRow({ a, groupName }: { a: Activity; groupName?: string }) {
  const text = useActivityText();
  const fmt = useDateFmt();
  const d = a.details as { amount_minor?: number; currency?: string };
  const href = a.entity_type === 'expense' && a.entity_id ? `/expense/${a.entity_id}` : a.group_id ? `/groups/${a.group_id}` : undefined;
  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      <UserAvatar id={a.actor_id ?? undefined} size={36} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] leading-snug">{text(a)}</p>
        <p className="text-xs text-muted mt-0.5">{fmt.relative(a.created_at)}{groupName && ` · ${groupName}`}</p>
      </div>
      {d.amount_minor != null && d.currency && <Money minor={Number(d.amount_minor)} currency={d.currency} className="text-sm font-medium text-muted" />}
    </div>
  );
  return href ? <Link to={href} className="block hover:bg-elev transition-colors">{body}</Link> : body;
}

// ---------------------------------------------------------------------------
export function toBalances(rows: { user_id: string; currency: string; net: number }[]): Balances {
  const b: Balances = {};
  for (const r of rows) (b[r.currency] ??= {})[r.user_id] = r.net;
  return b;
}

export function SuggestedPayments({ group, balances }: { group: Group; balances: Balances }) {
  const { t } = useTranslation();
  const names = useNames();
  const [settle, setSettle] = useState<{ from: string; to: string; amount: number; currency: string } | null>(null);
  const transfers = useMemo(() => simplifyDebts(balances), [balances]);
  const active = new Set(group.group_members.filter((m) => !m.left_at).map((m) => m.user_id));
  if (!transfers.length) return null;
  return (
    <div>
      <div className="card divide-y divide-line/70 overflow-hidden">
        {transfers.map((tr, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <UserAvatar id={tr.from} size={32} />
            <div className="flex-1 min-w-0 text-[14px]">
              {t('settle.suggestion', { from: names(tr.from), to: names(tr.to) })}
              <div><Money minor={tr.amount} currency={tr.currency} className="font-semibold" /></div>
            </div>
            {!group.archived_at && active.has(tr.from) && active.has(tr.to) && (
              <Button size="sm" variant="soft" onClick={() => setSettle(tr)}>{t('groups.record')}</Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2 px-1">{t('groups.suggestedNote')}</p>
      {settle && <SettleSheet open onOpenChange={(o) => !o && setSettle(null)} group={group} defaults={settle} />}
    </div>
  );
}
