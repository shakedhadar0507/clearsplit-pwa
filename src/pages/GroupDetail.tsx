import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, HandCoins, UserPlus, Settings, Archive, ArchiveRestore, LogOut, Download, Crown, Receipt } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Money, PageHeader, Segmented, SectionTitle, Sheet, Skeleton, Spinner, cx, useToast } from '@/components/ui';
import { BackButton, CategoryIcon, UserAvatar, useNames, useGroupTitle } from '@/components/common';
import { ActivityRow, ExpenseRow, InviteSheet, SettleSheet, SettlementRow, SuggestedPayments, toBalances } from '@/components/finance';
import { GroupForm } from './Groups';
import { useActivity, useGroup, useGroupBalances, useGroupExpenses, useGroupSettlements, useRpcMutation, type Expense, type Group } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';
import { exportExpensesCsv } from '@/lib/export';

type Tab = 'expenses' | 'balances' | 'settlements' | 'activity';

export function GroupDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loc = useLocation();
  const { session } = useAuth();
  const me = session!.user.id;
  const online = useOnline();
  const group = useGroup(id);
  const expenses = useGroupExpenses(id);
  const settlements = useGroupSettlements(id);
  const balances = useGroupBalances(group.data ? id : undefined);
  const activity = useActivity(id, 100);
  const names = useNames();
  const [tab, setTab] = useState<Tab>(loc.hash === '#balances' ? 'balances' : 'expenses');
  const [settle, setSettle] = useState(false);
  const [invite, setInvite] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (group.data?.is_direct) {
      const other = group.data.group_members.find((m) => m.user_id !== me);
      if (other) navigate(`/friends/${other.user_id}`, { replace: true });
    }
  }, [group.data, me, navigate]);

  const b = useMemo(() => toBalances(balances.data ?? []), [balances.data]);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses.data ?? []) if (!e.deleted_at) m.set(e.currency, (m.get(e.currency) ?? 0) + e.amount_minor);
    return [...m.entries()];
  }, [expenses.data]);

  if (group.isLoading) return <Spinner />;
  if (!group.data) return <EmptyState title={t('errors.not_found')} action={<Button onClick={() => navigate('/groups')}>{t('common.back')}</Button>} />;
  const g = group.data;
  const members = g.group_members.filter((m) => !m.left_at);
  const isAdmin = members.some((m) => m.user_id === me && m.role === 'admin');
  const myNets = Object.entries(b).map(([cur, m]) => [cur, m[me] ?? 0] as const).filter(([, v]) => v !== 0);
  const archived = !!g.archived_at;

  return (
    <div className="animate-fade-in">
      <PageHeader back={<BackButton to="/groups" />} title={g.name}
        subtitle={<>{t(`groups.categories.${g.category}`)} · {t('groups.membersCount', { count: members.length })}</>}
        actions={<Button variant="ghost" size="icon" aria-label={t('groups.settings')} onClick={() => setSettingsOpen(true)}><Settings className="h-5 w-5" /></Button>} />

      {archived && <div className="rounded-xl bg-warn-soft text-warn text-sm p-3 mb-4 flex gap-2"><Archive className="h-4 w-4 mt-0.5 shrink-0" />{t('groups.archivedNote')}</div>}

      <Card className="p-5">
        <div className="flex items-start gap-4">
          <CategoryIcon kind="group" category={g.category} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-muted">{t('groups.yourBalance')}</div>
            {balances.isLoading ? <Skeleton className="h-8 w-32 mt-1" /> : myNets.length === 0 ? (
              <div className="text-xl font-semibold text-muted mt-0.5">{t('balance.youAreSettled')}</div>
            ) : myNets.map(([cur, v]) => (
              <div key={cur} className={cx('text-xl font-semibold mt-0.5', v > 0 ? 'text-pos' : 'text-neg')}>
                {v > 0 ? t('balance.youGetBack', { amount: '' }) : t('balance.youOweAmount', { amount: '' })}<Money minor={Math.abs(v)} currency={cur} />
              </div>
            ))}
            {totals.length > 0 && (
              <div className="text-xs text-muted mt-2">{t('groups.totalSpent')}: {totals.map(([c, v], i) => <span key={c}>{i > 0 && ' · '}<Money minor={v} currency={c} /></span>)}</div>
            )}
          </div>
        </div>
        <div className="flex -space-x-2 rtl:space-x-reverse mt-4" aria-label={t('groups.members')}>
          {members.slice(0, 8).map((m) => <UserAvatar key={m.user_id} id={m.user_id} size={32} className="ring-2 ring-card" />)}
          {members.length > 8 && <span className="h-8 w-8 rounded-full bg-elev ring-2 ring-card text-xs grid place-items-center">+{members.length - 8}</span>}
        </div>
        {g.description && <p className="text-sm text-muted mt-3">{g.description}</p>}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Button disabled={archived || !online} onClick={() => navigate(`/expense/new?group=${g.id}`)}><Plus className="h-4 w-4" />{t('expense.new')}</Button>
          <Button variant="secondary" disabled={archived || !online || members.length < 2} onClick={() => setSettle(true)}><HandCoins className="h-4 w-4" />{t('dashboard.settleUp')}</Button>
          <Button variant="secondary" disabled={archived || !online} onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" />{t('groups.invite')}</Button>
        </div>
      </Card>

      <Segmented className="mt-5" label={t('groups.title')} value={tab} onChange={setTab} options={[
        { value: 'expenses', label: t('groups.expenses') },
        { value: 'balances', label: t('groups.balances') },
        { value: 'settlements', label: t('groups.settlements') },
        { value: 'activity', label: t('groups.activity') },
      ]} />

      <div className="mt-4">
        {tab === 'expenses' && (expenses.isLoading ? <Skeleton className="h-40" /> : expenses.isError ? <ErrorState error={expenses.error} /> : (expenses.data ?? []).length === 0 ? (
          <Card><EmptyState icon={Receipt} title={t('groups.noExpenses')} body={t('groups.noExpensesBody')}
            action={!archived && <Button onClick={() => navigate(`/expense/new?group=${g.id}`)}><Plus className="h-4 w-4" />{t('expense.new')}</Button>} /></Card>
        ) : (
          <Card className="divide-y divide-line/70 overflow-hidden">{expenses.data!.map((e) => <ExpenseRow key={e.id} e={e} />)}</Card>
        ))}

        {tab === 'balances' && (balances.isLoading ? <Skeleton className="h-40" /> : balances.isError ? <ErrorState error={balances.error} /> : (
          <>
            <Card className="divide-y divide-line/70 overflow-hidden">
              {g.group_members.filter((m) => !m.left_at || Object.values(b).some((x) => (x[m.user_id] ?? 0) !== 0)).map((m) => {
                const nets = Object.entries(b).map(([cur, x]) => [cur, x[m.user_id] ?? 0] as const).filter(([, v]) => v !== 0);
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                    <UserAvatar id={m.user_id} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{names(m.user_id)} {m.role === 'admin' && <Badge tone="primary"><Crown className="h-3 w-3" />{t('groups.admin')}</Badge>} {m.left_at && <Badge>{t('groups.formerMember')}</Badge>}</div>
                    </div>
                    <div className="text-end text-sm">
                      {nets.length === 0 ? <span className="text-muted">{t('balance.settled')}</span> : nets.map(([cur, v]) => (
                        <div key={cur} className={v > 0 ? 'text-pos' : 'text-neg'}>
                          <span className="text-xs me-1">{v > 0 ? t('balance.getsBack') : t('balance.owes')}</span>
                          <Money minor={Math.abs(v)} currency={cur} className="font-semibold" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Card>
            <SectionTitle>{t('groups.suggested')}</SectionTitle>
            {Object.values(b).every((x) => Object.values(x).every((v) => v === 0)) ? (
              <Card className="p-5 text-center text-sm text-muted">{t('balance.youAreSettled')}</Card>
            ) : <SuggestedPayments group={g} balances={b} />}
          </>
        ))}

        {tab === 'settlements' && (settlements.isLoading ? <Skeleton className="h-40" /> : (settlements.data ?? []).length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">{t('groups.noSettlements')}</Card>
        ) : (
          <Card className="divide-y divide-line/70 overflow-hidden">{settlements.data!.map((s) => <SettlementRow key={s.id} s={s} />)}</Card>
        ))}

        {tab === 'activity' && (activity.isLoading ? <Skeleton className="h-40" /> : (activity.data ?? []).length === 0 ? (
          <Card><EmptyState title={t('activity.empty')} /></Card>
        ) : (
          <Card className="divide-y divide-line/70 overflow-hidden">{activity.data!.map((a) => <ActivityRow key={a.id} a={a} />)}</Card>
        ))}
      </div>

      {settle && <SettleSheet open onOpenChange={setSettle} group={g} />}
      <InviteSheet open={invite} onOpenChange={setInvite} groupId={g.id} />
      <GroupSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} group={g} isAdmin={isAdmin} expenses={expenses.data ?? []} />
    </div>
  );
}

function GroupSettingsSheet({ open, onOpenChange, group, isAdmin, expenses }: { open: boolean; onOpenChange: (o: boolean) => void; group: Group; isAdmin: boolean; expenses: Expense[] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const names = useNames();
  const groupTitle = useGroupTitle();
  const online = useOnline();
  const { session } = useAuth();
  const me = session!.user.id;
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'leave' } | { kind: 'remove'; user: string }>(null);
  const remove = useRpcMutation<{ p_group_id: string; p_user_id: string }>('remove_group_member');
  const role = useRpcMutation<{ p_group_id: string; p_user_id: string; p_role: string }>('set_member_role');
  const archive = useRpcMutation<{ p_group_id: string; p_archived: boolean }>('set_group_archived');
  const members = group.group_members.filter((m) => !m.left_at);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (err) {
      toast(errorText(t, err), 'error');
      return false;
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEdit(false); }} title={t('groups.settings')}>
      {edit ? <GroupForm group={group} onDone={() => setEdit(false)} /> : (
        <div className="space-y-5">
          {isAdmin && <Button variant="secondary" className="w-full" disabled={!online} onClick={() => setEdit(true)}>{t('common.edit')}</Button>}
          <div>
            <h3 className="label">{t('groups.members')}</h3>
            <div className="rounded-2xl border border-line divide-y divide-line/70">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                  <UserAvatar id={m.user_id} size={34} />
                  <div className="flex-1 min-w-0 text-sm font-medium truncate">{names(m.user_id)} {m.role === 'admin' && <Badge tone="primary">{t('groups.admin')}</Badge>}</div>
                  {isAdmin && m.user_id !== me && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={!online} onClick={() => run(() => role.mutateAsync({ p_group_id: group.id, p_user_id: m.user_id, p_role: m.role === 'admin' ? 'member' : 'admin' }))}>
                        {m.role === 'admin' ? t('groups.makeMember') : t('groups.makeAdmin')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-neg" disabled={!online} onClick={() => setConfirm({ kind: 'remove', user: m.user_id })}>{t('groups.remove')}</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => exportExpensesCsv(expenses, { names, groupName: () => groupTitle(group), lang: i18n.language, t, filename: `clearsplit-${group.name}` })}>
            <Download className="h-4 w-4" />{t('common.export')}
          </Button>
          {isAdmin && (
            <Button variant="secondary" className="w-full" disabled={!online} loading={archive.isPending}
              onClick={() => run(() => archive.mutateAsync({ p_group_id: group.id, p_archived: !group.archived_at }))}>
              {group.archived_at ? <><ArchiveRestore className="h-4 w-4" />{t('groups.unarchive')}</> : <><Archive className="h-4 w-4" />{t('groups.archive')}</>}
            </Button>
          )}
          <Button variant="ghost" className="w-full text-neg" disabled={!online} onClick={() => setConfirm({ kind: 'leave' })}><LogOut className="h-4 w-4" />{t('groups.leave')}</Button>
        </div>
      )}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} danger
        title={confirm?.kind === 'leave' ? t('groups.leave') : t('groups.remove')}
        body={confirm?.kind === 'leave' ? t('groups.leaveConfirm') : confirm?.kind === 'remove' ? t('groups.removeConfirm', { name: names(confirm.user) }) : ''}
        confirmLabel={confirm?.kind === 'leave' ? t('groups.leave') : t('groups.remove')} loading={remove.isPending}
        onConfirm={async () => {
          if (!confirm) return;
          const user = confirm.kind === 'leave' ? me : confirm.user;
          const ok = await run(() => remove.mutateAsync({ p_group_id: group.id, p_user_id: user }), confirm.kind === 'leave' ? t('groups.left') : undefined);
          setConfirm(null);
          if (ok && confirm.kind === 'leave') navigate('/groups');
        }} />
    </Sheet>
  );
}
