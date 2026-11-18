import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { supabase, appUrl } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useOnline } from '@/lib/hooks';

export function LoginPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const online = useOnline();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (session) return <Navigate to={safeNext} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appUrl}/reset-password` });
        if (error) throw error;
        setInfo(t('auth.resetSent'));
      }
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={mode === 'login' ? t('auth.welcome') : t('auth.forgot')} subtitle={mode === 'login' ? t('auth.signInSubtitle') : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('auth.email')} htmlFor="email">
          <Input id="email" type="email" dir="ltr" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === 'login' && (
          <Field label={t('auth.password')} htmlFor="password">
            <Input id="password" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {error && <p role="alert" className="text-sm text-neg">{error}</p>}
        {info && <p role="status" className="text-sm text-pos">{info}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!online || !email || (mode === 'login' && !password)}>
          {mode === 'login' ? t('auth.signIn') : t('auth.sendReset')}
        </Button>
        <button type="button" className="w-full text-sm text-primary font-medium py-1" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(null); setInfo(null); }}>
          {mode === 'login' ? t('auth.forgot') : t('common.back')}
        </button>
      </form>
    </AuthLayout>
  );
}
