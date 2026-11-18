import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState, Button } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState icon={Compass} title={t('errors.pageNotFound')} body={t('errors.pageNotFoundBody')}
      action={<Link to="/"><Button>{t('errors.goHome')}</Button></Link>} />
  );
}
