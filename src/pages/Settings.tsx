import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, LogOut, Download, Trash2, Shield, Smartphone, Laptop, UserPlus, Monitor, Sun, Moon, Info, Crown } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Field, Input, LtrText, PageHeader, SectionTitle, Segmented, Select, Toggle, useToast } from '@/components/ui';
import { UserAvatar, useDateFmt, useGroupTitle, useNames } from '@/components/common';
import { InviteSheet } from '@/components/finance';
import { rpc, useAdminUsers, useAppSettings, useExpenseSearch, useGroups, useInvitations, useIsOwner, useMe, useRpcMutation, type Profile } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { setLanguage, type Lang } from '@/i18n';
import { applyTheme, useInstallPrompt, useOnline, type ThemePref } from '@/lib/hooks';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { errorText } from '@/lib/errors';
import { downloadBlob, exportExpensesCsv } from '@/lib/export';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const me = useMe();
  const isOwner = useIsOwner();
  const p = me.data;
  const [name, setName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (p) setName(p.display_name); }, [p?.display_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<Profile>, silent = false) => {
    if (!p) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) return toast(errorText(t, error), 'error');
    await qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['profiles'] });
    if (!silent) toast(t('settings.saved'));
  };

  const uploadAvatar = async (f: File) => {
    if (!p) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 2 * 1024 * 1024) return toast(t('expense.receiptTooLarge'), 'error');
    setBusy(true);
    const path = `${p.id}/${crypto.randomUUID()}.${f.type.split('/')[1]}`;
    const { error } = await supabase.storage.from('avatars').upload(path, f, { contentType: f.type });
    if (error) { setBusy(false); return toast(errorText(t, error), 'error'); }
    const old = p.avatar_path;
    await save({ avatar_path: path });
    if (old) await supabase.storage.from('avatars').remove([old]);
    setBusy(false);
  };

  if (!p) return null;
  const prefs = { expenses: true, settlements: true, groups: true, ...p.notify_prefs };

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('settings.title')} />

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <label className="relative cursor-pointer group" aria-label={t('settings.changeAvatar')}>
            <UserAvatar profile={p} size={72} />
            <span className="absolute -bottom-1 -end-1 h-8 w-8 rounded-full bg-primary text-primary-fg grid place-items-center shadow ring-2 ring-card"><Camera className="h-4 w-4" /></span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!online || busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadAvatar(f); }} />
          </label>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold truncate">{p.display_name} {isOwner && <Badge tone="primary"><Crown className="h-3 w-3" />{t('admin.owner')}</Badge>}</div>
            <LtrText className="text-sm text-muted">{p.email}</LtrText>
          </div>
        </div>
        <form className="flex gap-2 mt-4 items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save({ display_name: name.trim() }); }}>
          <Field label={t('settings.displayName')} htmlFor="s-name" className="flex-1">
            <Input id="s-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={!online || !name.trim() || name.trim() === p.display_name}>{t('common.save')}</Button>
        </form>
      </Card>

      <SectionTitle>{t('settings.preferences')}</SectionTitle>
      <Card className="p-5 space-y-4">
        <Field label={t('settings.language')}>
          <Segmented label={t('settings.language')} value={i18n.language as Lang} onChange={(v) => { setLanguage(v); void save({ locale: v }, true); }}
            options={[{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
        </Field>
        <Field label={t('settings.theme')}>
          <Segmented label={t('settings.theme')} value={p.theme} onChange={(v: ThemePref) => { applyTheme(v); void save({ theme: v }, true); }}
            options={[
              { value: 'system', label: <span className="inline-flex items-center gap-1"><Monitor className="h-3.5 w-3.5" />{t('settings.themes.system')}</span> },
              { value: 'light', label: <span className="inline-flex items-center gap-1"><Sun className="h-3.5 w-3.5" />{t('settings.themes.light')}</span> },
              { value: 'dark', label: <span className="inline-flex items-center gap-1"><Moon className="h-3.5 w-3.5" />{t('settings.themes.dark')}</span> },
            ]} />
        </Field>
        <Field label={t('settings.currency')} htmlFor="s-cur">
          <Select id="s-cur" value={p.default_currency} onChange={(e) => void save({ default_currency: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
      </Card>

      <SectionTitle>{t('settings.notifications')}</SectionTitle>
      <Card className="divide-y divide-line/70">
        {(['expenses', 'settlements', 'groups'] as const).map((k) => (
          <div key={k} className="flex items-center justify-between px-5 py-3.5">
            <label htmlFor={`n-${k}`} className="text-[15px]">{t(`settings.notify${k[0].toUpperCase()}${k.slice(1)}` as 'settings.notifyExpenses')}</label>
            <Toggle id={`n-${k}`} label={t(`settings.notify${k[0].toUpperCase()}${k.slice(1)}` as 'settings.notifyExpenses')} checked={prefs[k] !== false}
              onChange={(v) => void save({ notify_prefs: { ...prefs, [k]: v } }, true)} />
          </div>
        ))}
        <p className="px-5 py-3 text-xs text-muted flex gap-2"><Info className="h-4 w-4 shrink-0" />{t('settings.pushNote')}</p>
      </Card>

      <InstallCard />

      {isOwner && <AdminSection />}

      <SectionTitle>{t('settings.data')}</SectionTitle>
      <Card className="p-5 space-y-2">
        <ExportButtons />
      </Card>

      <SectionTitle>{t('settings.account')}</SectionTitle>
      <Card className="p-5 space-y-2">
        <Button variant="secondary" className="w-full" onClick={async () => { await supabase.auth.signOut(); qc.clear(); }}><LogOut className="h-4 w-4" />{t('auth.signOut')}</Button>
        {!isOwner && <Button variant="ghost" className="w-full text-neg" disabled={!online} onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />{t('settings.deleteAccount')}</Button>}
      </Card>
      <p className="text-center text-xs text-muted mt-6">ClearSplit · {t('settings.version', { v: __APP_VERSION__ })}</p>

      <ConfirmDialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); setTyped(''); }} danger title={t('settings.deleteAccount')} body={t('settings.deleteConfirm')}
        confirmLabel={t('settings.deleteAccount')} loading={busy}
        onConfirm={async () => {
          if (typed !== 'DELETE') return;
          setBusy(true);
          try {
            await rpc('delete_my_account');
            await supabase.auth.signOut();
            qc.clear();
          } catch (err) {
            toast(errorText(t, err), 'error');
          } finally {
            setBusy(false);
            setDeleteOpen(false);
          }
        }}>
        <Field label={t('settings.deleteTyped')} htmlFor="del-typed" className="mb-4">
          <Input id="del-typed" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function ExportButtons() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const names = useNames();
  const groups = useGroups();
  const groupTitle = useGroupTitle();
  const me = useMe();
  const all = useExpenseSearch({ q: '', groupId: '', userId: me.data?.id ?? '', category: '', from: '', to: '', asc: true, deleted: false });
  const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
  return (
    <>
      <Button variant="secondary" className="w-full" onClick={async () => {
        try {
          const data = await rpc('export_my_data');
          downloadBlob(JSON.stringify(data, null, 2), `clearsplit-my-data-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
        } catch (err) { toast(errorText(t, err), 'error'); }
      }}><Download className="h-4 w-4" />{t('settings.exportData')}</Button>
      <Button variant="secondary" className="w-full" disabled={!all.data}
        onClick={() => exportExpensesCsv(all.data ?? [], { names, groupName: (gid) => groupTitle(byId.get(gid)), lang: i18n.language, t, filename: 'clearsplit-my-expenses', me: me.data?.id })}>
        <Download className="h-4 w-4" />{t('settings.exportCsv')}
      </Button>
    </>
  );
}

export function InstallCard() {
  const { t } = useTranslation();
  const { canInstall, install, standalone } = useInstallPrompt();
  const steps = (k: 'ios' | 'android' | 'desktop') => t(`install.${k}`, { returnObjects: true }) as string[];
  return (
    <>
      <SectionTitle>{t('settings.install')}</SectionTitle>
      <Card className="p-5 space-y-4" id="install">
        {standalone ? <p className="text-sm text-pos">{t('install.installed')}</p> : canInstall && (
          <Button className="w-full" onClick={() => void install()}>{t('install.installNow')}</Button>
        )}
        {([['ios', Smartphone], ['android', Smartphone], ['desktop', Laptop]] as const).map(([k, Icon]) => (
          <details key={k} className="group rounded-xl border border-line px-4 py-3">
            <summary className="flex items-center gap-2 cursor-pointer font-medium text-[15px] list-none"><Icon className="h-4 w-4 text-primary" />{t(`install.${k}Title`)}</summary>
            <ol className="list-decimal ps-6 mt-2 space-y-1 text-sm text-muted">{steps(k).map((s, i) => <li key={i}>{s}</li>)}</ol>
          </details>
        ))}
      </Card>
    </>
  );
}

function AdminSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const fmt = useDateFmt();
  const online = useOnline();
  const settings = useAppSettings();
  const users = useAdminUsers(true);
  const invites = useInvitations(true);
  const update = useRpcMutation<{ p_allow_member_invites: boolean; p_invite_ttl_hours: number }>('update_app_settings');
  const setActive = useRpcMutation<{ p_user_id: string; p_active: boolean }>('set_user_active');
  const revoke = useRpcMutation<{ p_id: string }>('revoke_invitation');
  const [invite, setInvite] = useState(false);
  const [ttl, setTtl] = useState('');
  const [disable, setDisable] = useState<{ id: string; name: string } | null>(null);
  const s = settings.data;

  useEffect(() => { if (s) setTtl(String(s.invite_ttl_hours)); }, [s?.invite_ttl_hours]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); toast(t('settings.saved')); } catch (err) { toast(errorText(t, err), 'error'); }
  };
  const status = (i: { used_at: string | null; revoked_at: string | null; expires_at: string }) =>
    i.used_at ? ['used', 'pos'] as const : i.revoked_at ? ['revoked', 'neutral'] as const : new Date(i.expires_at) < new Date() ? ['expired', 'neutral'] as const : ['open', 'warn'] as const;

  return (
    <>
      <SectionTitle><span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />{t('admin.title')}</span></SectionTitle>
      <Card className="p-5 space-y-4">
        <p className="text-xs text-muted">{t('admin.subtitle')}</p>
        <Button className="w-full" onClick={() => setInvite(true)} disabled={!online}><UserPlus className="h-4 w-4" />{t('admin.newInvite')}</Button>
        {s && (
          <>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="a-allow" className="text-sm">{t('admin.allowMemberInvites')}</label>
              <Toggle id="a-allow" label={t('admin.allowMemberInvites')} checked={s.allow_member_invites}
                onChange={(v) => void run(() => update.mutateAsync({ p_allow_member_invites: v, p_invite_ttl_hours: s.invite_ttl_hours }))} />
            </div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(ttl); if (n >= 1 && n <= 720) void run(() => update.mutateAsync({ p_allow_member_invites: s.allow_member_invites, p_invite_ttl_hours: n })); }}>
              <Field label={t('admin.ttl')} htmlFor="a-ttl" className="flex-1"><Input id="a-ttl" type="number" min={1} max={720} dir="ltr" value={ttl} onChange={(e) => setTtl(e.target.value)} /></Field>
              <Button type="submit" variant="secondary" disabled={!online}>{t('common.save')}</Button>
            </form>
          </>
        )}

        <div>
          <h3 className="label">{t('admin.users')}</h3>
          <div className="rounded-2xl border border-line divide-y divide-line/70">
            {(users.data ?? []).map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                <UserAvatar id={u.id} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{u.deleted_at ? t('common.deletedUser') : u.display_name}</div>
                  {u.email && <LtrText className="text-xs text-muted block truncate">{u.email}</LtrText>}
                </div>
                {u.id === s?.owner_id ? <Badge tone="primary">{t('admin.owner')}</Badge> : u.deleted_at ? <Badge>{t('common.deletedUser')}</Badge> : u.is_active ? (
                  <Button size="sm" variant="ghost" className="text-neg" disabled={!online} onClick={() => setDisable({ id: u.id, name: u.display_name })}>{t('admin.disable')}</Button>
                ) : (
                  <Button size="sm" variant="soft" disabled={!online} onClick={() => void run(() => setActive.mutateAsync({ p_user_id: u.id, p_active: true }))}>{t('admin.enable')}</Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="label">{t('admin.invitations')}</h3>
          {(invites.data ?? []).length === 0 ? <p className="text-sm text-muted">{t('admin.noInvites')}</p> : (
            <div className="rounded-2xl border border-line divide-y divide-line/70 max-h-80 overflow-y-auto">
              {invites.data!.map((i) => {
                const [st, tone] = status(i);
                return (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{i.email ? <LtrText>{i.email}</LtrText> : '—'} {i.is_owner_invite && <Badge tone="primary">{t('admin.owner')}</Badge>}</div>
                      <div className="text-xs text-muted">{fmt.full(i.created_at)}</div>
                    </div>
                    <Badge tone={tone}>{t(`admin.${st}`)}</Badge>
                    {st === 'open' && <Button size="sm" variant="ghost" disabled={!online} onClick={() => void run(() => revoke.mutateAsync({ p_id: i.id }))}>{t('admin.revoke')}</Button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <InviteSheet open={invite} onOpenChange={setInvite} />
      <ConfirmDialog open={!!disable} onOpenChange={(o) => !o && setDisable(null)} danger title={t('admin.disable')}
        body={disable ? t('admin.disableConfirm', { name: disable.name }) : ''} confirmLabel={t('admin.disable')} loading={setActive.isPending}
        onConfirm={async () => { if (disable) await run(() => setActive.mutateAsync({ p_user_id: disable.id, p_active: false })); setDisable(null); }} />
    </>
  );
}
