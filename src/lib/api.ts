import { useQuery, useQueryClient, useMutation, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  avatar_path: string | null;
  locale: 'he' | 'en';
  default_currency: string;
  theme: 'system' | 'light' | 'dark';
  notify_prefs: { expenses?: boolean; settlements?: boolean; groups?: boolean };
  is_active: boolean;
  deleted_at: string | null;
}
export type GroupCategory = 'trip' | 'apartment' | 'friends' | 'couple' | 'restaurant' | 'event' | 'other' | 'direct';
export interface Member { group_id: string; user_id: string; role: 'admin' | 'member'; joined_at: string; left_at: string | null }
export interface Group {
  id: string; name: string | null; description: string | null; category: GroupCategory; currency: string;
  is_direct: boolean; archived_at: string | null; created_by: string; created_at: string; group_members: Member[];
}
export type ExpenseCategory = 'food' | 'groceries' | 'transportation' | 'accommodation' | 'shopping' | 'entertainment' | 'utilities' | 'rent' | 'travel' | 'other';
export interface Expense {
  id: string; group_id: string; description: string; category: ExpenseCategory; currency: string; amount_minor: number;
  expense_date: string; notes: string | null; split_method: 'equal' | 'exact' | 'percentage' | 'shares'; version: number;
  created_by: string; updated_by: string | null; created_at: string; updated_at: string; deleted_at: string | null;
  expense_payers: { user_id: string; amount_minor: number }[];
  expense_splits: { user_id: string; amount_minor: number; input_value: number | null }[];
}
export type SettlementStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'reversed';
export interface Settlement {
  id: string; group_id: string; currency: string; amount_minor: number; from_user: string; to_user: string;
  settled_on: string; notes: string | null; status: SettlementStatus; created_by: string; created_at: string;
  confirmed_at: string | null; closed_at: string | null; closed_by: string | null; reversal_reason: string | null;
}
export interface Activity {
  id: number; group_id: string | null; actor_id: string | null; action: string; entity_type: string | null;
  entity_id: string | null; details: Record<string, unknown>; created_at: string;
}
export interface AppNotification { id: number; type: string; group_id: string | null; payload: Record<string, unknown>; read_at: string | null; created_at: string }
export interface Friendship { user_a: string; user_b: string; direct_group_id: string; created_at: string }
export interface Receipt { id: string; expense_id: string; storage_path: string; mime_type: string; size_bytes: number; uploaded_by: string; created_at: string }
export interface Revision { id: number; expense_id: string; version: number; action: 'created' | 'updated' | 'deleted' | 'restored'; snapshot: Record<string, unknown>; changed_by: string; changed_at: string }
export interface Invitation { id: string; email: string | null; group_id: string | null; can_create_account: boolean; is_owner_invite: boolean; expires_at: string; used_at: string | null; used_by: string | null; revoked_at: string | null; created_at: string; created_by: string | null }
export interface AppSettings { owner_id: string | null; allow_member_invites: boolean; invite_ttl_hours: number }

// bigint columns arrive as numbers from PostgREST (safe below 2^53, enforced by DB checks)
const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number));

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const qk = {
  me: ['me'] as QueryKey,
  settings: ['app_settings'] as QueryKey,
  profiles: ['profiles'] as QueryKey,
  groups: ['groups'] as QueryKey,
  myBalances: ['my_balances'] as QueryKey,
  groupBalances: (id: string) => ['group_balances', id] as QueryKey,
  expenses: (gid: string) => ['expenses', gid] as QueryKey,
  expense: (id: string) => ['expense', id] as QueryKey,
  settlements: (gid: string) => ['settlements', gid] as QueryKey,
  pending: ['pending_settlements'] as QueryKey,
  activity: (gid?: string) => ['activity', gid ?? 'all'] as QueryKey,
  notifications: ['notifications'] as QueryKey,
  friends: ['friendships'] as QueryKey,
  search: (f: unknown) => ['search', f] as QueryKey,
  invitations: ['invitations'] as QueryKey,
  adminUsers: ['admin_users'] as QueryKey,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useMe() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: qk.me,
    enabled: !!uid,
    queryFn: async () => unwrap<Profile | null>(await supabase.from('profiles').select('*').eq('id', uid!).maybeSingle()),
  });
}

export function useAppSettings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.settings,
    enabled: !!session,
    queryFn: async () => unwrap<AppSettings | null>(await supabase.from('app_settings').select('owner_id, allow_member_invites, invite_ttl_hours').maybeSingle()),
  });
}

export function useIsOwner() {
  const { session } = useAuth();
  const s = useAppSettings();
  return !!session && !!s.data && s.data.owner_id === session.user.id;
}

export function useProfiles() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.profiles,
    enabled: !!session,
    queryFn: async () => {
      const rows = unwrap<Profile[]>(await supabase.from('profiles').select('id, email, display_name, avatar_path, is_active, deleted_at, locale, default_currency, theme, notify_prefs'));
      return new Map(rows.map((p) => [p.id, p]));
    },
  });
}

export function useGroups() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.groups,
    enabled: !!session,
    queryFn: async () => unwrap<Group[]>(await supabase.from('groups').select('*, group_members(*)').order('created_at', { ascending: false })),
  });
}

export function useGroup(id: string | undefined) {
  const groups = useGroups();
  return { ...groups, data: groups.data?.find((g) => g.id === id) };
}

export interface MyBalance { group_id: string; currency: string; net: number }
export function useMyBalances() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.myBalances,
    enabled: !!session,
    queryFn: async () => (await rpc<MyBalance[]>('my_balances')).map((r) => ({ ...r, net: num(r.net) })),
  });
}

export interface GroupBalance { user_id: string; currency: string; net: number }
export function useGroupBalances(gid: string | undefined) {
  return useQuery({
    queryKey: qk.groupBalances(gid ?? ''),
    enabled: !!gid,
    queryFn: async () => (await rpc<GroupBalance[]>('group_balances', { gid })).map((r) => ({ ...r, net: num(r.net) })),
  });
}

const EXPENSE_SELECT = '*, expense_payers(user_id, amount_minor), expense_splits(user_id, amount_minor, input_value)';
const normExpense = (e: Expense): Expense => ({
  ...e,
  amount_minor: num(e.amount_minor),
  expense_payers: e.expense_payers.map((p) => ({ ...p, amount_minor: num(p.amount_minor) })),
  expense_splits: e.expense_splits.map((s) => ({ ...s, amount_minor: num(s.amount_minor), input_value: s.input_value == null ? null : num(s.input_value) })),
});

export function useGroupExpenses(gid: string | undefined) {
  return useQuery({
    queryKey: qk.expenses(gid ?? ''),
    enabled: !!gid,
    queryFn: async () => unwrap<Expense[]>(await supabase.from('expenses').select(EXPENSE_SELECT).eq('group_id', gid!)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)).map(normExpense),
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: qk.expense(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const e = unwrap<Expense | null>(await supabase.from('expenses').select(EXPENSE_SELECT).eq('id', id!).maybeSingle());
      if (!e) return null;
      const [rev, rec] = await Promise.all([
        supabase.from('expense_revisions').select('*').eq('expense_id', id!).order('id', { ascending: false }),
        supabase.from('receipt_attachments').select('*').eq('expense_id', id!).order('created_at'),
      ]);
      return { expense: normExpense(e), revisions: unwrap<Revision[]>(rev), receipts: unwrap<Receipt[]>(rec) };
    },
  });
}

const normSettlement = (s: Settlement): Settlement => ({ ...s, amount_minor: num(s.amount_minor) });

export function useGroupSettlements(gid: string | undefined) {
  return useQuery({
    queryKey: qk.settlements(gid ?? ''),
    enabled: !!gid,
    queryFn: async () => unwrap<Settlement[]>(await supabase.from('settlements').select('*').eq('group_id', gid!).order('created_at', { ascending: false })).map(normSettlement),
  });
}

export function usePendingSettlements() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.pending,
    enabled: !!session,
    queryFn: async () => unwrap<Settlement[]>(await supabase.from('settlements').select('*').eq('status', 'pending').order('created_at', { ascending: false })).map(normSettlement),
  });
}

export function useActivity(gid?: string, limit = 50) {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...qk.activity(gid), limit],
    enabled: !!session,
    queryFn: async () => {
      let q = supabase.from('activity_logs').select('*').order('id', { ascending: false }).limit(limit);
      if (gid) q = q.eq('group_id', gid);
      return unwrap<Activity[]>(await q);
    },
  });
}

export function useNotifications() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    enabled: !!session,
    queryFn: async () => unwrap<AppNotification[]>(await supabase.from('notifications').select('*').order('id', { ascending: false }).limit(100)),
  });
}

export function useFriendships() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.friends,
    enabled: !!session,
    queryFn: async () => unwrap<Friendship[]>(await supabase.from('friendships').select('*')),
  });
}

export interface SearchFilters { q: string; groupId: string; userId: string; category: string; from: string; to: string; asc: boolean; deleted: boolean }
export function useExpenseSearch(f: SearchFilters) {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.search(f),
    enabled: !!session,
    queryFn: async () => {
      const select = f.userId
        ? '*, expense_payers(user_id, amount_minor), expense_splits!inner(user_id, amount_minor, input_value)'
        : EXPENSE_SELECT;
      let q = supabase.from('expenses').select(select)
        .order('expense_date', { ascending: f.asc }).order('created_at', { ascending: f.asc }).limit(500);
      if (!f.deleted) q = q.is('deleted_at', null);
      if (f.groupId) q = q.eq('group_id', f.groupId);
      if (f.category) q = q.eq('category', f.category);
      if (f.from) q = q.gte('expense_date', f.from);
      if (f.to) q = q.lte('expense_date', f.to);
      if (f.q.trim()) q = q.ilike('description', `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      if (f.userId) q = q.eq('expense_splits.user_id', f.userId);
      return unwrap<Expense[]>(await q as { data: Expense[] | null; error: unknown }).map(normExpense);
    },
  });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: qk.invitations,
    enabled,
    queryFn: async () => unwrap<Invitation[]>(await supabase.from('invitations').select('id, email, group_id, can_create_account, is_owner_invite, expires_at, used_at, used_by, revoked_at, created_at, created_by').order('created_at', { ascending: false }).limit(100)),
  });
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminUsers,
    enabled,
    queryFn: () => rpc<{ id: string; email: string | null; display_name: string; is_active: boolean; deleted_at: string | null; created_at: string }[]>('admin_list_users'),
  });
}

// ---------------------------------------------------------------------------
// Mutations: every financial write is an RPC (validated & transactional server-side)
// ---------------------------------------------------------------------------
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useRpcMutation<TArgs extends Record<string, unknown>, TRes = unknown>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => rpc<TRes>(fn, args),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Subscribes to realtime changes visible to the user (RLS-filtered) and refreshes cached queries. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const { session } = useAuth();
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries(), 300);
    };
    const channel = supabase
      .channel('clearsplit-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc, session]);
}

export async function signedUrl(bucket: 'receipts' | 'avatars', path: string, expiresIn = 300) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
