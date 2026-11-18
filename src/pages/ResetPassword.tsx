import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input, Spinner, useToast } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { session, loading, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Spinner className="min-h-dvh" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError(t('errors.passwordShort'));
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(errorText(t, error));
    clearRecovery();
    toast(t('auth.passwordUpdated'));
    navigate('/', { replace: true });
  };

  if (!session) {
    return (
      <AuthLayout title={t('auth.setPassword')}>
        <p className="text-sm text-neg">{t('join.invalid')}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.setPassword')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.newPassword')} htmlFor="np" hint={t('auth.passwordHint')} error={error}>
          <Input id="np" type="password" dir="ltr" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>{t('common.save')}</Button>
      </form>
    </AuthLayout>
  );
}
