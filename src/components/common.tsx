import {
  Plane, Building2, Users, Heart, UtensilsCrossed, PartyPopper, Shapes, ShoppingCart, Car, BedDouble, ShoppingBag,
  Clapperboard, Zap, KeyRound, Luggage, UserRound, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Avatar, Button, cx } from './ui';
import { signedUrl, useProfiles, type Group, type Profile } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export const GROUP_ICONS = {
  trip: Plane, apartment: Building2, friends: Users, couple: Heart, restaurant: UtensilsCrossed, event: PartyPopper, other: Shapes, direct: UserRound,
} as const;
export const GROUP_TONES: Record<string, string> = {
  trip: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  apartment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  friends: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  couple: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  restaurant: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  event: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  other: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  direct: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};
export const GROUP_CATEGORIES = ['trip', 'apartment', 'friends', 'couple', 'restaurant', 'event', 'other'] as const;

export const EXPENSE_ICONS = {
  food: UtensilsCrossed, groceries: ShoppingCart, transportation: Car, accommodation: BedDouble, shopping: ShoppingBag,
  entertainment: Clapperboard, utilities: Zap, rent: KeyRound, travel: Luggage, other: Shapes,
} as const;
export const EXPENSE_TONES: Record<string, string> = {
  food: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  groceries: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300',
  transportation: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  accommodation: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  shopping: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  entertainment: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  utilities: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
  rent: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  travel: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  other: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
export const EXPENSE_CATEGORIES = ['food', 'groceries', 'transportation', 'accommodation', 'shopping', 'entertainment', 'utilities', 'rent', 'travel', 'other'] as const;

export function CategoryIcon({ kind, category, size = 'md' }: { kind: 'group' | 'expense'; category: string; size?: 'sm' | 'md' | 'lg' }) {
  const map: Record<string, typeof Shapes> = kind === 'group' ? GROUP_ICONS : EXPENSE_ICONS;
  const Icon = map[category] ?? Shapes;
  const tone = (kind === 'group' ? GROUP_TONES : EXPENSE_TONES)[category] ?? GROUP_TONES.other;
  const dims = { sm: 'h-9 w-9 rounded-xl', md: 'h-11 w-11 rounded-2xl', lg: 'h-14 w-14 rounded-2xl' }[size];
  const icon = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <span className={cx('grid place-items-center shrink-0', dims, tone)} aria-hidden>
      <Icon className={icon} />
    </span>
  );
}

/** Returns a resolver for user display names ("You" for the current user). */
export function useNames() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const profiles = useProfiles();
  return (id: string | null | undefined, opts: { you?: boolean } = { you: true }) => {
    if (!id) return t('common.unknownUser');
    if (opts.you !== false && id === session?.user.id) return t('common.you');
    const p = profiles.data?.get(id);
    if (!p) return t('common.unknownUser');
    if (p.deleted_at) return t('common.deletedUser');
    return p.display_name;
  };
}

export function useGroupTitle() {
  const names = useNames();
  const { session } = useAuth();
  return (g: Group | undefined) => {
    if (!g) return '';
    if (!g.is_direct) return g.name ?? '';
    const other = g.group_members.find((m) => m.user_id !== session?.user.id);
    return names(other?.user_id, { you: false });
  };
}

const urlCache = new Map<string, { url: string; exp: number }>();
export function useAvatarUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => (path && urlCache.get(path)?.url) || null);
  useEffect(() => {
    if (!path) return setUrl(null);
    const c = urlCache.get(path);
    if (c && c.exp > Date.now()) return setUrl(c.url);
    let live = true;
    signedUrl('avatars', path, 3600).then((u) => {
      urlCache.set(path, { url: u, exp: Date.now() + 3000_000 });
      if (live) setUrl(u);
    }).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return url;
}

export function UserAvatar({ profile, id, size = 40, className }: { profile?: Profile; id?: string; size?: number; className?: string }) {
  const profiles = useProfiles();
  const { t } = useTranslation();
  const p = profile ?? (id ? profiles.data?.get(id) : undefined);
  const url = useAvatarUrl(p?.avatar_path);
  const name = p?.deleted_at ? t('common.deletedUser') : p?.display_name ?? '?';
  return <Avatar name={name} src={url} id={p?.id ?? id} size={size} className={className} />;
}

export function BackButton({ to }: { to?: string }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const Icon = i18n.dir() === 'rtl' ? ChevronRight : ChevronLeft;
  return (
    <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={() => (to ? navigate(to) : window.history.length > 1 ? navigate(-1) : navigate('/'))}>
      <Icon className="h-6 w-6" />
    </Button>
  );
}

export function useDateFmt() {
  const { i18n } = useTranslation();
  const loc = i18n.language === 'en' ? 'en-US' : 'he-IL';
  return {
    day: (d: string) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(new Date(d.length === 10 ? d + 'T12:00:00' : d)),
    full: (d: string) => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)),
    relative: (d: string) => {
      const diff = (new Date(d).getTime() - Date.now()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
      return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }).format(new Date(d));
    },
  };
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
