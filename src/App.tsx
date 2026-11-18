import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { useMe } from './lib/api';
import { applyTheme, useSystemThemeListener } from './lib/hooks';
import { setLanguage } from './i18n';
import { AppShell, UpdatePrompt, OfflineBanner } from './components/AppShell';
import { Button, Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { JoinPage } from './pages/Join';
import { ResetPasswordPage } from './pages/ResetPassword';
import { DashboardPage } from './pages/Dashboard';
import { NotFoundPage } from './pages/NotFound';
import { supabase } from './lib/supabase';

const GroupsPage = lazy(() => import('./pages/Groups').then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import('./pages/GroupDetail').then((m) => ({ default: m.GroupDetailPage })));
const ExpenseFormPage = lazy(() => import('./pages/ExpenseForm').then((m) => ({ default: m.ExpenseFormPage })));
const ExpenseDetailPage = lazy(() => import('./pages/ExpenseDetail').then((m) => ({ default: m.ExpenseDetailPage })));
const FriendsPage = lazy(() => import('./pages/Friends').then((m) => ({ default: m.FriendsPage })));
const FriendDetailPage = lazy(() => import('./pages/FriendDetail').then((m) => ({ default: m.FriendDetailPage })));
const ActivityPage = lazy(() => import('./pages/Activity').then((m) => ({ default: m.ActivityPage })));
const NotificationsPage = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  const me = useMe();
  const { t, i18n } = useTranslation();

  // Sync stored preferences from the profile once loaded
  useEffect(() => {
    if (!me.data) return;
    if (me.data.locale !== i18n.language) setLanguage(me.data.locale);
    applyTheme(me.data.theme);
  }, [me.data?.locale, me.data?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner className="min-h-dvh" />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.isLoading) return <Spinner className="min-h-dvh" />;
  if (me.data === null || (me.data && !me.data.is_active)) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div className="card p-6 max-w-sm">
          <p className="mb-4">{t('errors.inactive')}</p>
          <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>{t('auth.signOut')}</Button>
        </div>
      </div>
    );
  }
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

function RecoveryRedirect() {
  const { recovery } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (recovery) navigate('/reset-password', { replace: true });
  }, [recovery, navigate]);
  return null;
}

export function App() {
  const { t } = useTranslation();
  useSystemThemeListener();
  if (!isConfigured) {
    return <div className="min-h-dvh grid place-items-center p-6 text-center text-muted">{t('errors.configMissing')}</div>;
  }
  return (
    <>
      <UpdatePrompt />
      <RecoveryRedirect />
      <Routes>
        <Route path="/login" element={<><OfflineBanner /><LoginPage /></>} />
        <Route path="/join" element={<><OfflineBanner /><JoinPage /></>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:id" element={<GroupDetailPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="friends/:id" element={<FriendDetailPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="expense/new" element={<ExpenseFormPage />} />
          <Route path="expense/:id" element={<ExpenseDetailPage />} />
          <Route path="expense/:id/edit" element={<ExpenseFormPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
