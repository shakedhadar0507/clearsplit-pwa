import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, Skeleton, cx } from '@/components/ui';
import { BackButton, useDateFmt } from '@/components/common';
import { rpc, useNotifications, type AppNotification } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { localeFor } from '@/i18n';

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fmt = useDateFmt();
  const n = useNotifications();
  const unread = (n.data ?? []).filter((x) => !x.read_at);

  const text = (x: AppNotification) => {
    const p = x.payload as Record<string, string | number>;
    const amount = p.amount_minor != null && p.currency ? formatMoney(Number(p.amount_minor), String(p.currency), localeFor(i18n.language)) : '';
    return t(`notifications.types.${x.type}`, { ...p, amount, defaultValue: x.type });
  };
  const open = async (x: AppNotification) => {
    if (!x.read_at) {
      await rpc('mark_notifications_read', { p_ids: [x.id] }).catch(() => {});
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    const p = x.payload as Record<string, string>;
    if (p.expense_id && x.type !== 'expense_deleted') navigate(`/expense/${p.expense_id}`);
    else if (x.group_id) navigate(`/groups/${x.group_id}`);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader back={<BackButton />} title={t('notifications.title')}
        actions={unread.length > 0 && <Button size="sm" variant="ghost" onClick={async () => { await rpc('mark_notifications_read', { p_ids: null }); void qc.invalidateQueries({ queryKey: ['notifications'] }); }}><CheckCheck className="h-4 w-4" />{t('notifications.markAll')}</Button>} />
      {n.isLoading ? <Skeleton className="h-48" /> : (n.data ?? []).length === 0 ? (
        <Card><EmptyState icon={Bell} title={t('notifications.empty')} /></Card>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden">
          {n.data!.map((x) => (
            <button key={x.id} type="button" onClick={() => void open(x)} className={cx('w-full text-start flex items-start gap-3 px-4 py-3 hover:bg-elev transition-colors', !x.read_at && 'bg-primary-soft/40')}>
              <span className={cx('mt-1.5 h-2 w-2 rounded-full shrink-0', x.read_at ? 'bg-transparent' : 'bg-primary')} aria-hidden />
              <div className="flex-1 min-w-0">
                <p className={cx('text-[14px]', !x.read_at && 'font-medium')}>{text(x)}</p>
                <p className="text-xs text-muted mt-0.5">{fmt.relative(x.created_at)}</p>
              </div>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
