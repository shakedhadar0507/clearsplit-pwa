import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Undo2, Paperclip, FileText, X } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Money, PageHeader, SectionTitle, Spinner, useToast } from '@/components/ui';
import { BackButton, CategoryIcon, UserAvatar, useDateFmt, useGroupTitle, useNames } from '@/components/common';
import { rpc, signedUrl, useExpense, useGroup } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';
import { uploadReceipt, validateReceipt } from '@/lib/receipts';
import { supabase } from '@/lib/supabase';
import { minorToDecimalString } from '@/lib/money';

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const names = useNames();
  const fmt = useDateFmt();
  const groupTitle = useGroupTitle();
  const { session } = useAuth();
  const me = session!.user.id;
  const q = useExpense(id);
  const group = useGroup(q.data?.expense.group_id);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (!q.data) {
    return <EmptyState title={t('expense.notFound')} action={<Button onClick={() => navigate('/')}>{t('errors.goHome')}</Button>} />;
  }
  const { expense: e, revisions, receipts } = q.data;
  const g = group.data;
  const isAdmin = !!g?.group_members.some((m) => m.user_id === me && m.role === 'admin' && !m.left_at);
  const canModify = e.created_by === me || isAdmin || e.expense_payers.some((p) => p.user_id === me);
  const archived = !!g?.archived_at;
  const myShare = e.expense_splits.find((s) => s.user_id === me)?.amount_minor ?? 0;
  const myPaid = e.expense_payers.find((p) => p.user_id === me)?.amount_minor ?? 0;
  const groupHref = g?.is_direct ? `/friends/${g.group_members.find((m) => m.user_id !== me)?.user_id}` : `/groups/${e.group_id}`;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries();
      toast(msg);
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async (path: string) => {
    try {
      const url = await signedUrl('receipts', path, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  };

  const methodValue = (uid: string) => {
    const s = e.expense_splits.find((x) => x.user_id === uid);
    if (!s || s.input_value == null) return null;
    if (e.split_method === 'percentage') return `${(s.input_value / 100).toString()}%`;
    if (e.split_method === 'shares') return `×${(s.input_value / 100).toString()}`;
    return null;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader back={<BackButton />} title={t('expense.details')}
        actions={canModify && !e.deleted_at && !archived && (
          <>
            <Link to={`/expense/${e.id}/edit`}><Button variant="ghost" size="icon" aria-label={t('common.edit')} disabled={!online}><Pencil className="h-5 w-5" /></Button></Link>
            <Button variant="ghost" size="icon" className="text-neg" aria-label={t('common.delete')} disabled={!online} onClick={() => setConfirmDel(true)}><Trash2 className="h-5 w-5" /></Button>
          </>
        )} />

      {e.deleted_at && (
        <div className="rounded-xl bg-neg-soft text-neg text-sm p-3 mb-4 flex items-center justify-between gap-2">
          <span>{t('expense.deletedBanner')}</span>
          {canModify && !archived && <Button size="sm" variant="secondary" disabled={!online} loading={busy} onClick={() => act(() => rpc('restore_expense', { p_expense_id: e.id }), t('expense.restored'))}><Undo2 className="h-4 w-4" />{t('common.restore')}</Button>}
        </div>
      )}

      <Card className="p-5">
        <div className="flex items-start gap-4">
          <CategoryIcon kind="expense" category={e.category} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold break-words">{e.description}</h2>
            <Money minor={e.amount_minor} currency={e.currency} className="block text-3xl font-semibold tracking-tight mt-1" />
            <div className="text-sm text-muted mt-1">{fmt.day(e.expense_date)} · {t(`expense.categories.${e.category}`)} · {t(`expense.methods.${e.split_method}`)}</div>
            {g && <Link to={groupHref} className="inline-block text-sm text-primary font-medium mt-1">{groupTitle(g)}</Link>}
          </div>
        </div>
        {(myShare > 0 || myPaid > 0) && (
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="rounded-xl bg-elev px-3 py-2"><div className="text-xs text-muted">{t('expense.yourShare')}</div><Money minor={myShare} currency={e.currency} className="font-semibold" /></div>
            <div className={`rounded-xl px-3 py-2 ${myPaid - myShare >= 0 ? 'bg-pos-soft' : 'bg-neg-soft'}`}>
              <div className="text-xs text-muted">{myPaid - myShare >= 0 ? t('balance.getsBack') : t('balance.youOwe')}</div>
              <Money minor={Math.abs(myPaid - myShare)} currency={e.currency} className={`font-semibold ${myPaid - myShare >= 0 ? 'text-pos' : 'text-neg'}`} />
            </div>
          </div>
        )}
      </Card>

      <SectionTitle>{t('expense.paidBy')}</SectionTitle>
      <Card className="divide-y divide-line/70 overflow-hidden">
        {e.expense_payers.map((p) => (
          <div key={p.user_id} className="flex items-center gap-3 px-4 py-3">
            <UserAvatar id={p.user_id} size={36} /><span className="flex-1">{names(p.user_id)}</span>
            <Money minor={p.amount_minor} currency={e.currency} className="font-semibold text-pos" />
          </div>
        ))}
      </Card>

      <SectionTitle>{t('expense.participants')}</SectionTitle>
      <Card className="divide-y divide-line/70 overflow-hidden">
        {e.expense_splits.map((s) => (
          <div key={s.user_id} className="flex items-center gap-3 px-4 py-3">
            <UserAvatar id={s.user_id} size={36} />
            <span className="flex-1">{names(s.user_id)} {methodValue(s.user_id) && <Badge className="ms-1"><bdi dir="ltr">{methodValue(s.user_id)}</bdi></Badge>}</span>
            <Money minor={s.amount_minor} currency={e.currency} className="font-semibold" />
          </div>
        ))}
      </Card>

      {e.notes && (<><SectionTitle>{t('expense.notes')}</SectionTitle><Card className="p-4 text-sm whitespace-pre-wrap break-words">{e.notes}</Card></>)}

      <SectionTitle action={!e.deleted_at && !archived && receipts.length < 5 && (
        <label className="text-sm text-primary font-medium cursor-pointer inline-flex items-center gap-1">
          <Paperclip className="h-4 w-4" />{t('expense.addReceipt')}
          <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={!online || busy} onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (!f) return;
            const err = validateReceipt(f);
            if (err) return toast(t(err), 'error');
            void act(() => uploadReceipt(e.group_id, e.id, f), t('expense.saved'));
          }} />
        </label>
      )}>{t('expense.receipts')}</SectionTitle>
      {receipts.length === 0 ? <Card className="p-4 text-sm text-muted text-center">—</Card> : (
        <Card className="divide-y divide-line/70 overflow-hidden">
          {receipts.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="h-5 w-5 text-muted" />
              <button type="button" className="flex-1 text-start text-sm text-primary font-medium" onClick={() => void openReceipt(r.storage_path)}>
                {r.mime_type === 'application/pdf' ? 'PDF' : t('expense.receipts')} · {fmt.day(r.created_at)} · <bdi dir="ltr">{Math.ceil(r.size_bytes / 1024)} KB</bdi>
              </button>
              {(r.uploaded_by === me || isAdmin) && (
                <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={!online || busy} onClick={() => act(async () => {
                  const path = await rpc<string>('remove_receipt', { p_receipt_id: r.id });
                  await supabase.storage.from('receipts').remove([path]);
                }, t('common.done'))}><X className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
        </Card>
      )}

      <SectionTitle>{t('expense.history')}</SectionTitle>
      <Card className="divide-y divide-line/70 overflow-hidden">
        {revisions.map((r) => {
          const snap = r.snapshot as { amount_minor?: number; currency?: string; description?: string };
          return (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <UserAvatar id={r.changed_by} size={30} />
              <div className="flex-1 min-w-0">
                <div><span className="font-medium">{names(r.changed_by)}</span> · {t(`expense.revision.${r.action}`)}</div>
                <div className="text-xs text-muted">{fmt.full(r.changed_at)} · v{r.version}</div>
              </div>
              {snap.amount_minor != null && snap.currency && <bdi dir="ltr" className="text-xs text-muted tabular">{minorToDecimalString(Number(snap.amount_minor), snap.currency)} {snap.currency}</bdi>}
            </div>
          );
        })}
      </Card>

      <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} danger title={t('common.delete')} body={t('expense.deleteConfirm')}
        confirmLabel={t('common.delete')} loading={busy}
        onConfirm={() => act(() => rpc('delete_expense', { p_expense_id: e.id }), t('expense.deleted')).then(() => setConfirmDel(false))} />
    </div>
  );
}
