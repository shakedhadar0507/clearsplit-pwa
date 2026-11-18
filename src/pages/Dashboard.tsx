import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Users, UserPlus, HandCoins, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Money, SectionTitle, Skeleton, cx } from '@/components/ui';
import { CategoryIcon, UserAvatar, useGroupTitle } from '@/components/common';
import { ActivityRow, InviteSheet, SettleSheet, SettlementRow } from '@/components/finance';
import { useActivity, useGroups, useMe, useMyBalances, usePendingSettlements, type Group } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const me = session!.user.id;
  const profile = useMe();
  const balances = useMyBalances();
  const groups = useGroups();
  const pending = usePendingSettlements();
  const activity = useActivity(undefined, 8);
  const groupTitle = useGroupTitle();
  const [invite, setInvite] = useState(false);
  const [settle, setSettle] = useState<{ group: Group; to?: string; from?: string; amount: number; currency: string } | null>(null);
  const balancesRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => {
    const m = new Map<string, { owe: number; owed: number }>();
    for (const b of balances.data ?? []) {
      const cur = m.get(b.currency) ?? { owe: 0, owed: 0 };
      if (b.net < 0) cur.owe += -b.net; else cur.owed += b.net;
      m.set(b.currency, cur);
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'ILS' ? -1 : b === 'ILS' ? 1 : a.localeCompare(b)));
  }, [balances.data]);

  const groupById = new Map((groups.data ?? []).map((g) => [g.id, g]));
  const activeGroups = (groups.data ?? []).filter((g) => !g.is_direct && !g.archived_at);
  const openBalances = (balances.data ?? []).filter((b) => groupById.has(b.group_id));
  const incoming = (pending.data ?? []).filter((s) => s.to_user === me);
  const outgoing = (pending.data ?? []).filter((s) => s.to_user !== me && (s.from_user === me || s.created_by === me));

  const myNet = (gid: string) => (balances.data ?? []).filter((b) => b.group_id === gid);

  const quick = [
    { icon: Plus, label: t('nav.addExpense'), onClick: () => navigate('/expense/new'), primary: true },
    { icon: Users, label: t('dashboard.createGroup'), onClick: () => navigate('/groups?new=1') },
    { icon: UserPlus, label: t('dashboard.addFriend'), onClick: () => setInvite(true) },
    { icon: HandCoins, label: t('dashboard.settleUp'), onClick: () => balancesRef.current?.scrollIntoView({ behavior: 'smooth' }) },
  ];

  return (
    <div className="animate-fade-in">
      <p className="text-muted text-[15px] mb-1">{profile.data ? t('dashboard.hello', { name: profile.data.display_name }) : ' '}</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-4">{t('dashboard.title')}</h1>

      {/* Summary */}
      {balances.isLoading ? <Skeleton className="h-36" /> : balances.isError ? <ErrorState error={balances.error} onRetry={() => void balances.refetch()} /> : totals.length === 0 ? (
        <Card className="p-6 text-center bg-gradient-to-br from-primary-soft to-card">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-card text-primary grid place-items-center mb-3 shadow-card"><Sparkles className="h-6 w-6" /></div>
          <h2 className="font-semibold text-lg">{t('dashboard.allSettled')}</h2>
          <p className="text-sm text-muted mt-1">{t('dashboard.allSettledBody')}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {totals.map(([cur, v]) => (
            <Card key={cur} className="p-5 overflow-hidden relative" data-testid={`summary-${cur}`}>
              <div className="text-[13px] text-muted">{t('dashboard.net')} · {cur}</div>
              <Money minor={v.owed - v.owe} currency={cur} signed tone="auto" className="block text-[34px] leading-tight font-semibold tracking-tight mt-1" />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl bg-pos-soft px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-pos font-medium"><TrendingUp className="h-3.5 w-3.5" />{t('dashboard.owedToYou')}</div>
                  <Money minor={v.owed} currency={cur} className="font-semibold text-pos text-lg" />
                </div>
                <div className="rounded-xl bg-neg-soft px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-neg font-medium"><TrendingDown className="h-3.5 w-3.5" />{t('dashboard.youOwe')}</div>
                  <Money minor={v.owe} currency={cur} className="font-semibold text-neg text-lg" />
                </div>
              </div>
            </Card>
          ))}
          {totals.length > 1 && <p className="text-xs text-muted px-1">{t('dashboard.perCurrency')}</p>}
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2 mt-4">
        {quick.map(({ icon: Icon, label, onClick, primary }) => (
          <button key={label} type="button" onClick={onClick}
            className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 hover:bg-card transition-colors text-center">
            <span className={cx('h-12 w-12 rounded-2xl grid place-items-center shadow-card', primary ? 'bg-primary text-primary-fg' : 'bg-card text-primary border border-line/60')}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-[12px] font-medium leading-tight">{label}</span>
          </button>
        ))}
      </div>

      {/* Pending confirmations */}
      {incoming.length > 0 && (
        <>
          <SectionTitle>{t('dashboard.pending')}</SectionTitle>
          <Card className="divide-y divide-line/70 overflow-hidden border-warn/40">
            {incoming.map((s) => <SettlementRow key={s.id} s={s} />)}
          </Card>
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <SectionTitle>{t('dashboard.pendingOutgoing')}</SectionTitle>
          <Card className="divide-y divide-line/70 overflow-hidden">
            {outgoing.map((s) => <SettlementRow key={s.id} s={s} />)}
          </Card>
        </>
      )}

      {/* Open balances */}
      <div ref={balancesRef} className="scroll-mt-20">
        {openBalances.length > 0 && (
          <>
            <SectionTitle>{t('dashboard.balances')}</SectionTitle>
            <Card className="divide-y divide-line/70 overflow-hidden">
              {openBalances.map((b) => {
                const g = groupById.get(b.group_id)!;
                const other = g.is_direct ? g.group_members.find((m) => m.user_id !== me)?.user_id : undefined;
                return (
                  <div key={b.group_id + b.currency} className="flex items-center gap-3 px-4 py-3">
                    <Link to={g.is_direct ? `/friends/${other}` : `/groups/${g.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      {g.is_direct ? <UserAvatar id={other} size={44} /> : <CategoryIcon kind="group" category={g.category} />}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{groupTitle(g)}</div>
                        <div className={cx('text-sm', b.net > 0 ? 'text-pos' : 'text-neg')}>
                          {b.net > 0 ? t('balance.youGetBack', { amount: '' }) : t('balance.youOweAmount', { amount: '' })}
                          <Money minor={Math.abs(b.net)} currency={b.currency} className="font-semibold" />
                        </div>
                      </div>
                    </Link>
                    {!g.archived_at && (g.is_direct ? (
                      <Button size="sm" variant="soft" onClick={() => setSettle(b.net < 0
                        ? { group: g, from: me, to: other, amount: -b.net, currency: b.currency }
                        : { group: g, from: other, to: me, amount: b.net, currency: b.currency })}>{t('dashboard.settleUp')}</Button>
                    ) : (
                      <Link to={`/groups/${g.id}#balances`}><Button size="sm" variant="soft">{t('dashboard.settleUp')}</Button></Link>
                    ))}
                  </div>
                );
              })}
            </Card>
          </>
        )}
      </div>

      {/* Active groups */}
      <SectionTitle action={<Link to="/groups" className="text-sm text-primary font-medium">{t('common.viewAll')}</Link>}>{t('dashboard.activeGroups')}</SectionTitle>
      {groups.isLoading ? <Skeleton className="h-24" /> : activeGroups.length === 0 ? (
        <Card><EmptyState icon={Users} title={t('groups.empty')} body={t('groups.emptyBody')} action={<Button onClick={() => navigate('/groups?new=1')}>{t('groups.new')}</Button>} /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {activeGroups.slice(0, 4).map((g) => {
            const nets = myNet(g.id);
            return (
              <Link key={g.id} to={`/groups/${g.id}`} className="card p-4 flex items-center gap-3 hover:shadow-pop transition-shadow">
                <CategoryIcon kind="group" category={g.category} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{g.name}</div>
                  <div className="text-xs">
                    {nets.length === 0 ? <span className="text-muted">{t('balance.settled')}</span> : nets.map((n) => (
                      <Money key={n.currency} minor={n.net} currency={n.currency} signed tone="auto" className="me-2 font-medium" />
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Recent activity */}
      <SectionTitle action={<Link to="/activity" className="text-sm text-primary font-medium">{t('common.viewAll')}</Link>}>{t('dashboard.recent')}</SectionTitle>
      {activity.isLoading ? <Skeleton className="h-40" /> : (activity.data ?? []).length === 0 ? (
        <Card><EmptyState title={t('activity.empty')} /></Card>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden">
          {activity.data!.map((a) => <ActivityRow key={a.id} a={a} groupName={a.group_id ? groupTitle(groupById.get(a.group_id)) : undefined} />)}
        </Card>
      )}

      <InviteSheet open={invite} onOpenChange={setInvite} />
      {settle && <SettleSheet open onOpenChange={(o) => !o && setSettle(null)} group={settle.group} defaults={settle} />}
    </div>
  );
}
