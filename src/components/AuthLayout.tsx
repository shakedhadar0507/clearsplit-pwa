import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { LogoMark } from './Logo';
import { setLanguage } from '@/i18n';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="min-h-dvh flex flex-col pt-safe">
      <div className="flex justify-end p-4">
        <button type="button" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg rounded-lg px-2 py-1"
          onClick={() => setLanguage(i18n.language === 'he' ? 'en' : 'he')}>
          <Languages className="h-4 w-4" /> {i18n.language === 'he' ? 'English' : 'עברית'}
        </button>
      </div>
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 pb-10">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="flex flex-col items-center text-center mb-7">
            <LogoMark size={56} />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-muted mt-1 text-[15px]">{subtitle}</p>}
          </div>
          <div className="card p-5">{children}</div>
          <p className="text-center text-xs text-muted mt-5">{t('auth.privateApp')}</p>
        </div>
      </div>
    </div>
  );
}
