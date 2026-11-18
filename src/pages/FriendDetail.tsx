import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, HandCoins, UserMinus, Receipt } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, LtrText, Money, PageHeader, SectionTitle, Skeleton, Spinner, cx, useToast } from '@/components/ui';
import { BackButton, CategoryIcon, UserAvatar, useNames } from '@/components/common';
import { ExpenseRow, SettleSheet, SettlementRow } from '@/components/finance';
import { useFriendships, useGroups, useGroupExpenses, useGroupSettlements, useMyBalances, useProfiles, useRpcMutation } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';

export function FriendDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const names = useNames();
  const { session } = useAuth();
  const me = session!.user.id;
  const friendships = useFriendships();
  const groups = useGroups();
  const profiles = useProfiles();
  const balances = useMyBalances();
  const remove = useRpcMutation<{ p_user_id: string }>('remove_friend');
  const [settle, setSettle] = useState<null | { from: string; to: string; amount?: number; currency?: string }>(null);
  const [confirm, setConfirm] = useState(false);

  const f = friendships.data?.find((x) => (x.user_a === me && x.user_b === id) || (x.user_b === me && x.user_a === id));
  // Fall back to an existing direct group (e.g. after the friendship was removed)
  const direct = (groups.data ?? []).find((g) => g.id === f?.direct_group_id)
    ?? (groups.data ?? []).find((g) => g.is_direct && g.group_members.some((m) => m.user_id === id));
  const expenses = useGroupExpenses(direct?.id);
  const settlements = useGroupSettlements(direct?.id);

  if (friendships.isLoading || groups.isLoading) return <Spinner />;
  const profile = id ? profiles.data?.get(id) : undefined;
  if (!id || (!f && !direct) || !profile) return <EmptyState title={t('friends.notFound')} action={<Button onClick={() => navigate('/friends')}>{t('common.back')}</Button>} />;

  const nets = (balances.data ?? []).filter((b) => b.group_id === direct?.id);
  const shared = (groups.data ?? []).filter((g) => !g.is_direct && g.group_members.some((m) => m.user_id === id && !m.left_at) && g.group_members.some((m) => m.user_id === me && !m.left_at));

  return (
    <div className="animate-fade-in">
      <PageHeader back={<BackButton to="/friends" />} title={names(id)} />
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <UserAvatar profile={profile} size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold truncate">{names(id)}</h2>
            {profile.email && <LtrText className="text-sm text-muted">{profile.email}</LtrText>}
            <div className="mt-1.5">
              {nets.length === 0 ? <span className="text-muted">{t('balance.settled')}</span> : nets.map((n) => (
                <div key={n.currency} className={cx('font-semibold', n.net > 0 ? 'text-pos' : 'text-neg')}>
                  {n.net > 0 ? t('balance.youGetBack', { amount: '' }) : t('balance.youOweAmount', { amount: '' })}<Money minor={Math.abs(n.net)} currency={n.currency} />
                </div>
              ))}
            </div>
          </div>
        </div>
        {direct && (
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button disabled={!online} onClick={() => navigate(`/expense/new?group=${direct.id}`)}><Plus className="h-4 w-4" />{t('expense.new')}</Button>
            <Button variant="secondary" disabled={!online} onClick={() => {
              const n = nets[0];
              setSettle(!n ? { from: me, to: id } : n.net < 0 ? { from: me, to: id, amount: -n.net, currency: n.currency } : { from: id, to: me, amount: n.net, currency: n.currency });
            }}><HandCoins className="h-4 w-4" />{t('dashboard.settleUp')}</Button>
          </div>
        )}
      </Card>

      {shared.length > 0 && (
        <>
          <SectionTitle>{t('friends.shared')}</SectionTitle>
          <Card className="divide-y divide-line/70 overflow-hidden">
            {shared.map((g) => {
              const gn = (balances.data ?? []).filter((b) => b.group_id === g.id);
              return (
                <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-elev">
                  <CategoryIcon kind="group" category={g.category} size="sm" />
                  <span className="flex-1 truncate font-medium">{g.name}</span>
                  <span className="text-xs text-muted">{t('groups.yourBalance')}: </span>
                  {gn.length === 0 ? <span className="text-xs text-muted">{t('balance.settled')}</span> : gn.map((n) => <Money key={n.currency} minor={n.net} currency={n.currency} signed tone="auto" className="text-sm font-semibold" />)}
                </Link>
              );
            })}
          </Card>
        </>
      )}

      <SectionTitle>{t('friends.direct')}</SectionTitle>
      {expenses.isLoading ? <Skeleton className="h-32" /> : (expenses.data ?? []).length === 0 ? (
        <Card><EmptyState icon={Receipt} title={t('groups.noExpenses')} body={t('groups.noExpensesBody')} /></Card>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden">{expenses.data!.map((e) => <ExpenseRow key={e.id} e={e} />)}</Card>
      )}

      {(settlements.data ?? []).length > 0 && (
        <>
          <SectionTitle>{t('groups.settlements')}</SectionTitle>
          <Card className="divide-y divide-line/70 overflow-hidden">{settlements.data!.map((s) => <SettlementRow key={s.id} s={s} />)}</Card>
        </>
      )}

      {f && (
        <Button variant="ghost" className="w-full text-neg mt-6" disabled={!online} onClick={() => setConfirm(true)}><UserMinus className="h-4 w-4" />{t('friends.remove')}</Button>
      )}
      {settle && direct && <SettleSheet open onOpenChange={(o) => !o && setSettle(null)} group={direct} defaults={settle} />}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title={t('friends.remove')} body={t('friends.removeConfirm', { name: names(id) })}
        confirmLabel={t('friends.remove')} loading={remove.isPending}
        onConfirm={async () => {
          try { await remove.mutateAsync({ p_user_id: id }); toast(t('friends.removed')); navigate('/friends'); } catch (err) { toast(errorText(t, err), 'error'); }
          setConfirm(false);
        }} />
    </div>
  );
}
