import { Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { House, Users, UserRound, Activity, Settings, Plus, Bell, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button, Spinner, cx } from './ui';
import { useOnline } from '@/lib/hooks';
import { useNotifications, useRealtimeSync } from '@/lib/api';
import { Logo } from './Logo';

const NAV = [
  { to: '/', icon: House, key: 'home', end: true },
  { to: '/groups', icon: Users, key: 'groups' },
  { to: '/friends', icon: UserRound, key: 'friends' },
  { to: '/activity', icon: Activity, key: 'activity' },
  { to: '/settings', icon: Settings, key: 'settings' },
] as const;

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-40 bg-warn-soft text-warn text-[13px] font-medium px-4 py-2 flex items-center gap-2 pt-safe">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> {t('pwa.offline')}
    </div>
  );
}

export function UpdatePrompt() {
  const { t } = useTranslation();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for updates hourly while the app is open
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed z-[55] top-[calc(env(safe-area-inset-top)+0.75rem)] inset-x-0 flex justify-center px-4">
      <div className="card shadow-pop flex items-center gap-3 px-4 py-2.5 animate-slide-up">
        <span className="text-sm">{t('pwa.update')}</span>
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>{t('pwa.reload')}</Button>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { t } = useTranslation();
  const n = useNotifications();
  const unread = n.data?.filter((x) => !x.read_at).length ?? 0;
  return (
    <NavLink to="/notifications" aria-label={`${t('nav.notifications')}${unread ? ` (${unread})` : ''}`}
      className="relative h-10 w-10 grid place-items-center rounded-xl hover:bg-elev">
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-neg text-white text-[10px] font-bold grid place-items-center tabular">{unread > 9 ? '9+' : unread}</span>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loc = useLocation();
  useRealtimeSync();
  const hideFab = /^\/(expense|settle)/.test(loc.pathname);

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 lg:w-72 shrink-0 border-e border-line bg-card/60 backdrop-blur sticky top-0 h-dvh p-4">
        <div className="flex items-center justify-between px-2 mb-6 mt-1">
          <Logo />
          <NotificationBell />
        </div>
        <Button size="lg" className="mb-6 w-full" onClick={() => navigate('/expense/new')}>
          <Plus className="h-5 w-5" /> {t('nav.addExpense')}
        </Button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ to, icon: Icon, key, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:text-fg hover:bg-elev')}>
              <Icon className="h-5 w-5" /> {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <OfflineBanner />
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-bg/85 backdrop-blur-md pt-safe">
          <div className="flex items-center justify-between px-4 h-14">
            <Logo />
            <NotificationBell />
          </div>
        </div>
        <main className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-2 md:pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-12">
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/90 backdrop-blur-lg border-t border-line pb-safe">
        <div className="relative grid grid-cols-5 h-16">
          {NAV.map(({ to, icon: Icon, key, ...rest }, i) => (
            <NavLink key={to} to={to} end={'end' in rest}
              className={({ isActive }) => cx('flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted', i === 2 && 'pt-0')}>
              <Icon className="h-[22px] w-[22px]" />
              <span>{t(`nav.${key}`)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      {!hideFab && (
        <button
          type="button"
          onClick={() => navigate('/expense/new')}
          aria-label={t('nav.addExpense')}
          className="md:hidden fixed z-40 end-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] h-14 w-14 rounded-2xl bg-primary text-primary-fg shadow-pop grid place-items-center active:scale-95 transition-transform"
        >
          <Plus className="h-7 w-7" />
        </button>
      )}
    </div>
  );
}
