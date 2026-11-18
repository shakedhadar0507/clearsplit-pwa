import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Download, SlidersHorizontal } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton } from '@/components/ui';
import { EXPENSE_CATEGORIES, useGroupTitle, useNames } from '@/components/common';
import { ActivityRow, ExpenseRow } from '@/components/finance';
import { useActivity, useExpenseSearch, useGroups, type SearchFilters } from '@/lib/api';
import { exportExpensesCsv } from '@/lib/export';
import { useAuth } from '@/lib/auth';

const EMPTY: SearchFilters = { q: '', groupId: '', userId: '', category: '', from: '', to: '', asc: false, deleted: false };

export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'feed' | 'expenses'>('feed');
  const [f, setF] = useState<SearchFilters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(50);
  const { session } = useAuth();
  const activity = useActivity(undefined, limit);
  const search = useExpenseSearch(f);
  const groups = useGroups();
  const groupTitle = useGroupTitle();
  const names = useNames();
  const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
  const people = [...new Set((groups.data ?? []).flatMap((g) => g.group_members.map((m) => m.user_id)))];
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('activity.title')} />
      <Segmented label={t('activity.title')} value={tab} onChange={setTab} options={[{ value: 'feed', label: t('activity.feed') }, { value: 'expenses', label: t('activity.expenses') }]} />

      {tab === 'feed' ? (
        <div className="mt-4">
          {activity.isLoading ? <Skeleton className="h-64" /> : activity.isError ? <ErrorState error={activity.error} onRetry={() => void activity.refetch()} /> : (activity.data ?? []).length === 0 ? (
            <Card><EmptyState title={t('activity.empty')} /></Card>
          ) : (
            <>
              <Card className="divide-y divide-line/70 overflow-hidden">
                {activity.data!.map((a) => <ActivityRow key={a.id} a={a} groupName={a.group_id ? groupTitle(byId.get(a.group_id)) : undefined} />)}
              </Card>
              {activity.data!.length >= limit && <Button variant="secondary" className="w-full mt-3" onClick={() => setLimit((l) => l + 50)}>{t('common.more')}</Button>}
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" aria-hidden />
              <Input aria-label={t('common.search')} placeholder={t('common.search')} className="ps-9" value={f.q} onChange={(e) => set('q', e.target.value)} />
            </div>
            <Button variant="secondary" size="icon" aria-label={t('activity.filters')} aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal className="h-5 w-5" /></Button>
            <Button variant="secondary" size="icon" aria-label={t('common.export')} disabled={!search.data?.length}
              onClick={() => exportExpensesCsv(search.data ?? [], { names, groupName: (gid) => groupTitle(byId.get(gid)), lang: i18n.language, t, filename: 'clearsplit-expenses', me: session!.user.id })}>
              <Download className="h-5 w-5" />
            </Button>
          </div>
          {showFilters && (
            <Card className="p-4 grid grid-cols-2 gap-3 animate-fade-in">
              <Field label={t('activity.group')} htmlFor="f-group" className="col-span-2 sm:col-span-1">
                <Select id="f-group" value={f.groupId} onChange={(e) => set('groupId', e.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{groupTitle(g)}</option>)}
                </Select>
              </Field>
              <Field label={t('activity.participant')} htmlFor="f-user" className="col-span-2 sm:col-span-1">
                <Select id="f-user" value={f.userId} onChange={(e) => set('userId', e.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {people.map((u) => <option key={u} value={u}>{names(u)}</option>)}
                </Select>
              </Field>
              <Field label={t('activity.category')} htmlFor="f-cat">
                <Select id="f-cat" value={f.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`expense.categories.${c}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('activity.sort')} htmlFor="f-sort">
                <Select id="f-sort" value={f.asc ? 'asc' : 'desc'} onChange={(e) => set('asc', e.target.value === 'asc')}>
                  <option value="desc">{t('activity.newest')}</option>
                  <option value="asc">{t('activity.oldest')}</option>
                </Select>
              </Field>
              <Field label={t('activity.from')} htmlFor="f-from"><Input id="f-from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
              <Field label={t('activity.to')} htmlFor="f-to"><Input id="f-to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={f.deleted} onChange={(e) => set('deleted', e.target.checked)} />{t('activity.showDeleted')}
              </label>
              <Button variant="ghost" size="sm" className="col-span-2" onClick={() => setF(EMPTY)}>{t('activity.clear')}</Button>
            </Card>
          )}
          {search.isLoading ? <Skeleton className="h-64" /> : search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : (search.data ?? []).length === 0 ? (
            <Card><EmptyState icon={Search} title={t('activity.empty')} /></Card>
          ) : (
            <>
              <p className="text-xs text-muted px-1">{t('activity.results', { count: search.data!.length })}</p>
              <Card className="divide-y divide-line/70 overflow-hidden">
                {search.data!.map((e) => <ExpenseRow key={e.id} e={e} groupName={groupTitle(byId.get(e.group_id))} />)}
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
