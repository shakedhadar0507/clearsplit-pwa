import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Users, Archive } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Input, Money, PageHeader, Select, Sheet, Skeleton, Textarea, cx, useToast } from '@/components/ui';
import { CategoryIcon, GROUP_CATEGORIES, GROUP_ICONS } from '@/components/common';
import { useGroups, useMe, useMyBalances, useRpcMutation, type Group } from '@/lib/api';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';

export function GroupForm({ group, onDone }: { group?: Group; onDone: (id: string) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const online = useOnline();
  const me = useMe();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [category, setCategory] = useState<string>(group?.category ?? 'trip');
  const [currency, setCurrency] = useState(group?.currency ?? me.data?.default_currency ?? 'ILS');
  const create = useRpcMutation<Record<string, unknown>, string>('create_group');
  const update = useRpcMutation<Record<string, unknown>>('update_group');
  const busy = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const args = { p_name: name.trim(), p_description: description, p_category: category, p_currency: currency };
    try {
      if (group) {
        await update.mutateAsync({ p_group_id: group.id, ...args });
        toast(t('groups.updated'));
        onDone(group.id);
      } else {
        const id = await create.mutateAsync(args);
        toast(t('groups.created'));
        onDone(id);
      }
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t('groups.name')} htmlFor="g-name">
        <Input id="g-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <fieldset>
        <legend className="label">{t('groups.category')}</legend>
        <div className="grid grid-cols-4 gap-2">
          {GROUP_CATEGORIES.map((c) => {
            const Icon = GROUP_ICONS[c];
            return (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                className={cx('flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[12px] font-medium transition-colors',
                  category === c ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-elev text-muted hover:text-fg')}>
                <Icon className="h-5 w-5" />{t(`groups.categories.${c}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label={t('groups.currency')} htmlFor="g-cur">
        <Select id="g-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label={`${t('groups.description')} (${t('common.optional')})`} htmlFor="g-desc">
        <Textarea id="g-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!name.trim() || !online}>{t('common.save')}</Button>
    </form>
  );
}

export function GroupsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groups = useGroups();
  const balances = useMyBalances();
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (params.get('new')) {
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const list = (groups.data ?? []).filter((g) => !g.is_direct);
  const active = list.filter((g) => !g.archived_at);
  const archived = list.filter((g) => g.archived_at);

  const row = (g: Group) => {
    const nets = (balances.data ?? []).filter((b) => b.group_id === g.id);
    const members = g.group_members.filter((m) => !m.left_at).length;
    return (
      <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-elev transition-colors">
        <CategoryIcon kind="group" category={g.category} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{g.name}</div>
          <div className="text-xs text-muted">{t('groups.membersCount', { count: members })} · {t(`groups.categories.${g.category}`)}</div>
        </div>
        <div className="text-end text-sm">
          {nets.length === 0 ? <span className="text-muted text-xs">{t('balance.settled')}</span> : nets.map((n) => (
            <div key={n.currency}><Money minor={n.net} currency={n.currency} signed tone="auto" className="font-semibold" /></div>
          ))}
        </div>
      </Link>
    );
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('groups.title')} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('groups.new')}</Button>} />
      {groups.isLoading ? <Skeleton className="h-48" /> : groups.isError ? <ErrorState error={groups.error} onRetry={() => void groups.refetch()} /> : active.length === 0 ? (
        <Card><EmptyState icon={Users} title={t('groups.empty')} body={t('groups.emptyBody')} action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('groups.new')}</Button>} /></Card>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden">{active.map(row)}</Card>
      )}
      {archived.length > 0 && (
        <div className="mt-6">
          <button type="button" className="flex items-center gap-2 text-sm text-muted font-medium px-1" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
            <Archive className="h-4 w-4" />{t('groups.archivedList')} ({archived.length})
          </button>
          {showArchived && <Card className="divide-y divide-line/70 overflow-hidden mt-2 opacity-80">{archived.map(row)}</Card>}
        </div>
      )}
      <Sheet open={open} onOpenChange={setOpen} title={t('groups.new')}>
        <GroupForm onDone={(id) => { setOpen(false); navigate(`/groups/${id}`); }} />
      </Sheet>
    </div>
  );
}
