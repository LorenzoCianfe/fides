'use client';

import type { AccountDto } from '@fides/contracts';
import { Alert, Amount, buttonStyles, Card, PageShell, Spinner, Stack } from '@fides/ui-web';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { listAccounts } from '../../../lib/api/accounts';
import { signOut } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';
import { messageKeyForError } from '../../../lib/errors';
import { useI18n } from '../../../lib/i18n/provider';

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { locale: localeParam } = useParams<{ locale: string }>();

  const [accounts, setAccounts] = useState<AccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const { accounts: loaded } = await listAccounts(signal);
        setAccounts(loaded);
      } catch (cause) {
        if (signal.aborted) return;
        // An expired or absent session is not an error to show — it is a
        // redirect. The cookie may simply have aged out.
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace(`/${localeParam}/signin`);
          return;
        }
        setError(t(messageKeyForError(cause)));
      }
    },
    [router, localeParam, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function onSignOut(): Promise<void> {
    try {
      await signOut();
    } finally {
      // Whatever the server said, the local session is over.
      router.replace(`/${localeParam}/signin`);
    }
  }

  const wallet = accounts?.[0]?.wallets[0];

  return (
    <PageShell>
      <Stack gap={6}>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
            {t('dashboard.title')}
          </h1>
          <button
            type="button"
            onClick={onSignOut}
            className="text-sm text-[color:var(--color-text-secondary)] underline"
          >
            {t('nav.signOut')}
          </button>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        {accounts === null && !error ? <Spinner label={t('dashboard.title')} /> : null}

        {accounts !== null && wallet === undefined && !error ? (
          // Provisioning is event-driven and asynchronous (ADR-0022): a
          // just-approved user legitimately has no account for a moment.
          <Alert tone="info">{t('dashboard.empty')}</Alert>
        ) : null}

        {wallet ? (
          <>
            <Card>
              <Stack gap={2}>
                <span className="text-sm text-[color:var(--color-text-muted)]">
                  {t('dashboard.balance')}
                </span>
                <Amount value={wallet.balance} locale={locale} size="lg" />
              </Stack>
            </Card>

            <div className="flex flex-wrap gap-3">
              <Link href={`/${localeParam}/send`} className={buttonStyles()}>
                {t('dashboard.send')}
              </Link>
              <Link
                href={`/${localeParam}/activity?wallet=${wallet.id}`}
                className={buttonStyles({ variant: 'secondary' })}
              >
                {t('dashboard.activity')}
              </Link>
            </div>
          </>
        ) : null}
      </Stack>
    </PageShell>
  );
}
