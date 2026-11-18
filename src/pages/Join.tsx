import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input, LtrText, Spinner, useToast } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { rpc } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useDateFmt } from '@/components/common';
import { useOnline } from '@/lib/hooks';

interface InviteInfo {
  valid: boolean; inviter?: string | null; group_name?: string | null; email_bound?: boolean; email?: string | null;
  can_create_account?: boolean; is_owner_invite?: boolean; expires_at?: string;
}

/** Invitation tokens travel in the URL fragment (#token) so they never reach server logs or Referer headers. */
export function JoinPage() {
  const { t, i18n } = useTranslation();
  const { session, loading } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useDateFmt();
  const online = useOnline();
  const token = decodeURIComponent(loc.hash.replace(/^#/, '')).trim();

  const info = useQuery({
    queryKey: ['invite', token],
    enabled: token.length >= 32,
    queryFn: () => rpc<InviteInfo>('get_invitation_info', { p_token: token }),
    retry: false,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  useEffect(() => {
    if (info.data?.email) setEmail(info.data.email);
  }, [info.data?.email]);

  if (loading || (token.length >= 32 && info.isLoading)) return <Spinner className="min-h-dvh" />;

  const inv = info.data;
  if (!token || token.length < 32 || !inv?.valid || info.isError) {
    return (
      <AuthLayout title={t('join.title')}>
        <p className="text-sm text-neg mb-4">{t('join.invalid')}</p>
        <Link to="/login"><Button variant="secondary" className="w-full">{t('auth.signIn')}</Button></Link>
      </AuthLayout>
    );
  }

  const title = inv.is_owner_invite ? t('join.ownerSetup') : t('join.title');
  const subtitle = inv.is_owner_invite ? t('join.ownerSetupBody')
    : inv.group_name ? t('join.invitedToGroup', { name: inv.inviter, group: inv.group_name }) : t('join.invitedBy', { name: inv.inviter });

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await rpc<{ group_id: string | null }>('accept_invitation', { p_token: token });
      await qc.invalidateQueries();
      toast(t('join.accepted'));
      navigate(r.group_id ? `/groups/${r.group_id}` : '/friends', { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) return setError(t('errors.required'));
    if (password.length < 8) return setError(t('errors.passwordShort'));
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { invite_token: token, display_name: name.trim(), locale: i18n.language === 'en' ? 'en' : 'he' } },
      });
      if (error) throw error;
      if (!data.session) {
        setCheckEmail(true);
        return;
      }
      window.history.replaceState(null, '', '/join');
      navigate('/', { replace: true });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // GoTrue wraps trigger exceptions as "Database error saving new user"
      setError(/Database error/i.test(msg) ? t('errors.invalid_invitation') : errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (session) {
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <p className="text-sm text-muted mb-4">{t('join.signedInAs', { email: '' })}<LtrText className="font-medium text-fg">{session.user.email}</LtrText></p>
        {inv.is_owner_invite ? <p className="text-sm text-neg">{t('errors.owner_already_set')}</p> : (
          <Button size="lg" className="w-full" loading={busy} disabled={!online} onClick={accept}>{t('join.joinGroup')}</Button>
        )}
        {error && <p role="alert" className="text-sm text-neg mt-3">{error}</p>}
        <Link to="/" className="block text-center text-sm text-primary mt-4">{t('errors.goHome')}</Link>
      </AuthLayout>
    );
  }

  if (!inv.can_create_account) {
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <p className="text-sm text-muted mb-4">{t('join.needsAccount')}</p>
        <Link to={`/login?next=${encodeURIComponent('/join#' + token)}`}><Button className="w-full">{t('auth.signIn')}</Button></Link>
      </AuthLayout>
    );
  }

  if (checkEmail) {
    return (
      <AuthLayout title={title}>
        <p className="text-sm">{t('auth.resetSent')}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <form onSubmit={signUp} className="space-y-4" noValidate>
        <Field label={t('auth.displayName')} htmlFor="name">
          <Input id="name" autoComplete="name" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('auth.email')} htmlFor="email" hint={inv.email_bound ? t('join.boundEmail', { email: inv.email }) : undefined}>
          <Input id="email" type="email" dir="ltr" autoComplete="email" required value={email} readOnly={inv.email_bound} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')}>
          <Input id="password" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-neg">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!online}>{t('join.createAccount')}</Button>
        {inv.expires_at && <p className="text-xs text-muted text-center">{t('join.expires', { date: fmt.full(inv.expires_at) })}</p>}
        {!inv.is_owner_invite && (
          <Link to={`/login?next=${encodeURIComponent('/join#' + token)}`} className="block text-center text-sm text-primary">{t('auth.signIn')}</Link>
        )}
      </form>
    </AuthLayout>
  );
}
