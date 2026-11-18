import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, Search, UserRound } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, Money, PageHeader, SectionTitle, Skeleton, useToast } from '@/components/ui';
import { UserAvatar, useNames } from '@/components/common';
import { InviteSheet } from '@/components/finance';
import { useFriendships, useGroups, useMyBalances, useRpcMutation } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';

export function FriendsPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const online = useOnline();
  const names = useNames();
  const friendships = useFriendships();
  const groups = useGroups();
  const balances = useMyBalances();
  const add = useRpcMutation<{ p_user_id: string }>('add_friend_from_group');
  const [q, setQ] = useState('');
  const [invite, setInvite] = useState(false);

  const friends = useMemo(() => (friendships.data ?? []).map((f) => ({ ...f, other: f.user_a === me ? f.user_b : f.user_a })), [friendships.data, me]);
  const friendIds = new Set(friends.map((f) => f.other));
  const coMembers = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups.data ?? []) {
      if (g.is_direct) continue;
      for (const m of g.group_members) if (!m.left_at && m.user_id !== me) s.add(m.user_id);
    }
    return [...s].filter((u) => !friendIds.has(u));
  }, [groups.data, friends]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = friends.filter((f) => names(f.other).toLowerCase().includes(q.trim().toLowerCase()));
  const sharedCount = (u: string) => (groups.data ?? []).filter((g) => !g.is_direct && g.group_members.some((m) => m.user_id === u && !m.left_at)).length;

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('friends.title')} actions={<Button size="sm" onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" />{t('friends.invite')}</Button>} />
      {friends.length > 3 && (
        <div className="relative mb-4">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" aria-hidden />
          <Input aria-label={t('friends.search')} placeholder={t('friends.search')} className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {friendships.isLoading ? <Skeleton className="h-40" /> : friendships.isError ? <ErrorState error={friendships.error} onRetry={() => void friendships.refetch()} /> : friends.length === 0 ? (
        <Card><EmptyState icon={UserRound} title={t('friends.empty')} body={t('friends.emptyBody')} action={<Button onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" />{t('friends.invite')}</Button>} /></Card>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden">
          {filtered.map((f) => {
            const nets = (balances.data ?? []).filter((b) => b.group_id === f.direct_group_id);
            const shared = sharedCount(f.other);
            return (
              <Link key={f.other} to={`/friends/${f.other}`} className="flex items-center gap-3 px-4 py-3 hover:bg-elev transition-colors">
                <UserAvatar id={f.other} size={44} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{names(f.other)}</div>
                  {shared > 0 && <div className="text-xs text-muted">{t('friends.inGroups', { count: shared })}</div>}
                </div>
                <div className="text-end text-sm">
                  {nets.length === 0 ? <span className="text-xs text-muted">{t('balance.settled')}</span> : nets.map((n) => (
                    <div key={n.currency} className={n.net > 0 ? 'text-pos' : 'text-neg'}>
                      <div className="text-[11px]">{n.net > 0 ? t('balance.owesYou') : t('balance.youOwe')}</div>
                      <Money minor={Math.abs(n.net)} currency={n.currency} className="font-semibold" />
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </Card>
      )}
      {coMembers.length > 0 && (
        <>
          <SectionTitle>{t('groups.members')}</SectionTitle>
          <Card className="divide-y divide-line/70 overflow-hidden">
            {coMembers.map((u) => (
              <div key={u} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar id={u} size={36} />
                <span className="flex-1 truncate">{names(u)}</span>
                <Button size="sm" variant="soft" disabled={!online} loading={add.isPending && add.variables?.p_user_id === u}
                  onClick={async () => {
                    try { await add.mutateAsync({ p_user_id: u }); toast(t('friends.added')); } catch (err) { toast(errorText(t, err), 'error'); }
                  }}>{t('friends.addFromGroup')}</Button>
              </div>
            ))}
          </Card>
        </>
      )}
      <InviteSheet open={invite} onOpenChange={setInvite} />
    </div>
  );
}
