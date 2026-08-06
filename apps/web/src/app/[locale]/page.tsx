'use client';

import { buttonStyles, PageShell, Stack } from '@fides/ui-web';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from '../../lib/i18n/provider';

export default function LandingPage() {
  const t = useTranslations();
  const { locale } = useParams<{ locale: string }>();

  return (
    <PageShell className="flex min-h-screen flex-col justify-center">
      <Stack gap={8}>
        <Stack gap={3}>
          <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
            {t('app.name')}
          </span>
          <h1 className="text-4xl font-semibold text-[color:var(--color-text-primary)]">
            {t('app.tagline')}
          </h1>
          <p className="text-lg text-[color:var(--color-text-secondary)]">{t('landing.intro')}</p>
        </Stack>

        <div className="flex flex-wrap gap-3">
          <Link href={`/${locale}/signin`} className={buttonStyles()}>
            {t('landing.signIn')}
          </Link>
          <Link href={`/${locale}/signup`} className={buttonStyles({ variant: 'secondary' })}>
            {t('landing.createAccount')}
          </Link>
        </div>
      </Stack>
    </PageShell>
  );
}
