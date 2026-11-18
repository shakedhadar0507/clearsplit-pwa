import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { LoaderCircle, X, Inbox } from 'lucide-react';
import {
  createContext, forwardRef, useCallback, useContext, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/money';
import { localeFor } from '@/i18n';

export const cx = clsx;

// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }>(
  function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none',
          {
            primary: 'bg-primary text-primary-fg shadow-sm hover:brightness-110',
            secondary: 'bg-card text-fg border border-line hover:bg-elev',
            ghost: 'text-fg hover:bg-elev',
            danger: 'bg-neg text-white hover:brightness-110',
            soft: 'bg-primary-soft text-primary hover:brightness-95',
          }[variant],
          { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-[15px]', lg: 'h-12 px-5 text-base', icon: 'h-10 w-10' }[size],
          className,
        )}
        {...rest}
      >
        {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('field', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('field h-auto min-h-[80px] py-2.5', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('field appearance-none bg-no-repeat pe-9', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, htmlFor, error, hint, children, className }: { label?: ReactNode; htmlFor?: string; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-neg">{error}</p>}
    </div>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cx('flex items-center justify-center py-10 text-muted', className)}>
      <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-line/60', className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6 animate-fade-in">
      <div className="h-14 w-14 rounded-2xl bg-primary-soft text-primary grid place-items-center mb-4">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="font-semibold text-[17px]">{title}</h3>
      {body && <p className="text-muted text-sm mt-1 max-w-xs">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const msg = (error as { message?: string })?.message ?? '';
  const code = /cs:([a-z_]+)/.exec(msg)?.[1];
  const text = code ? t(`errors.${code}`, { defaultValue: t('errors.generic') }) : /fetch|network/i.test(msg) ? t('errors.network') : t('errors.generic');
  return (
    <div role="alert" className="card p-5 text-center">
      <p className="text-sm text-neg">{text}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Money({ minor, currency, signed, className, tone }: { minor: number; currency: string; signed?: boolean; className?: string; tone?: 'auto' | 'none' }) {
  const { i18n } = useTranslation();
  const color = tone === 'auto' ? (minor > 0 ? 'text-pos' : minor < 0 ? 'text-neg' : 'text-muted') : '';
  return (
    <bdi dir="ltr" className={cx('tabular whitespace-nowrap', color, className)}>
      {formatMoney(minor, currency, localeFor(i18n.language), { signed })}
    </bdi>
  );
}

export function LtrText({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={className}>{children}</bdi>;
}

const AVATAR_COLORS = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-teal-100 text-teal-700'];
const DARK_AVATAR = ['dark:bg-indigo-950 dark:text-indigo-200', 'dark:bg-emerald-950 dark:text-emerald-200', 'dark:bg-amber-950 dark:text-amber-200', 'dark:bg-rose-950 dark:text-rose-200', 'dark:bg-sky-950 dark:text-sky-200', 'dark:bg-violet-950 dark:text-violet-200', 'dark:bg-teal-950 dark:text-teal-200'];

export function Avatar({ name, src, id, size = 40, className }: { name: string; src?: string | null; id?: string; size?: number; className?: string }) {
  const seed = [...(id ?? name)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => [...p][0] ?? '').join('').toUpperCase();
  return (
    <span
      className={cx('inline-grid place-items-center rounded-full overflow-hidden font-semibold shrink-0', AVATAR_COLORS[seed], DARK_AVATAR[seed], className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials || '?'}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'primary'; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', {
      neutral: 'bg-elev text-muted border border-line', pos: 'bg-pos-soft text-pos', neg: 'bg-neg-soft text-neg', warn: 'bg-warn-soft text-warn', primary: 'bg-primary-soft text-primary',
    }[tone], className)}>{children}</span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex rounded-xl bg-elev border border-line p-1 gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap',
            value === o.value ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 rounded-full transition-colors shrink-0', checked ? 'bg-primary' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'start-[1.375rem]' : 'start-0.5')} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sheet: bottom sheet on mobile, centered dialog on larger screens
export function Sheet({ open, onOpenChange, title, children, description }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          className="fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:start-1/2 sm:-translate-y-1/2 sm:ltr:-translate-x-1/2 sm:rtl:translate-x-1/2 sm:w-[min(92vw,30rem)] max-h-[92dvh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-3xl shadow-pop p-5 pb-safe animate-slide-up focus:outline-none"
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-3 mb-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.close')}><X className="h-5 w-5" /></Button>
            </Dialog.Close>
          </div>
          {description ? <Dialog.Description className="text-sm text-muted mb-4">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          <div className="pb-2">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, onConfirm, danger, loading, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body?: string; confirmLabel: string; onConfirm: () => void; danger?: boolean; loading?: boolean; children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={body}>
      {children}
      <div className="flex gap-2 mt-2">
        <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Toasts
interface Toast { id: number; text: string; tone: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], action?: Toast['action']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, tone, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), action ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed z-[60] inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx('pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 shadow-pop text-sm font-medium animate-slide-up max-w-md w-full sm:w-auto',
              t.tone === 'error' ? 'bg-neg text-white' : 'bg-fg text-bg')}>
            <span className="flex-1">{t.text}</span>
            {t.action && <button className="underline font-semibold" onClick={t.action.onClick}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function PageHeader({ title, back, actions, subtitle }: { title: ReactNode; back?: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 mb-5 min-h-[44px]">
      {back}
      <div className="flex-1 min-w-0">
        <h1 className="text-[22px] md:text-2xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <div className="text-sm text-muted truncate">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5 mt-6 px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}
