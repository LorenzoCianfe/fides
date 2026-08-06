'use client';

import type { TransactionItemDto } from '@fides/contracts';
import { Alert, Amount, Button, Card, PageShell, Spinner, Stack } from '@fides/ui-web';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { listAccounts, listTransactions } from '../../../lib/api/accounts';
import { ApiError } from '../../../lib/api/client';
import { messageKeyForError } from '../../../lib/errors';
import { useI18n } from '../../../lib/i18n/provider';

function ActivityList() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { locale: localeParam } = useParams<{ locale: string }>();
  const walletParam = useSearchParams().get('wallet');

  const [walletId, setWalletId] = useState<string | null>(walletParam);
  const [items, setItems] = useState<TransactionItemDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Built once per locale rather than per render: constructing a formatter is
  // not cheap, and this list grows with every page the user loads.
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const handleFailure = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace(`/${localeParam}/signin`);
        return;
      }
      setError(t(messageKeyForError(cause)));
    },
    [router, localeParam, t],
  );

  // Deep links carry the wallet, but arriving without one should still work.
  useEffect(() => {
    if (walletId !== null) return;
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then(({ accounts }) => setWalletId(accounts[0]?.wallets[0]?.id ?? null))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) handleFailure(cause);
      });
    return () => controller.abort();
  }, [walletId, handleFailure]);

  useEffect(() => {
    if (!walletId) return;
    const controller = new AbortController();
    listTransactions(walletId, { limit: 20, signal: controller.signal })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) handleFailure(cause);
      });
    return () => controller.abort();
  }, [walletId, handleFailure]);

  async function loadMore(): Promise<void> {
    if (!walletId || !cursor) return;
    setBusy(true);
    try {
      const page = await listTransactions(walletId, { limit: 20, cursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <Stack gap={6}>
        <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
          {t('activity.title')}
        </h1>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {items === null && !error ? <Spinner label={t('activity.title')} /> : null}
        {items?.length === 0 ? <Alert tone="info">{t('activity.empty')}</Alert> : null}

        {items && items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <Card as="li" key={item.id}>
                <div className="flex items-center justify-between gap-4">
                  <Stack gap={2}>
                    <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                      {item.type}
                    </span>
                    <span className="text-sm text-[color:var(--color-text-muted)]">
                      {dateFormatter.format(new Date(item.occurredAt))}
                    </span>
                  </Stack>
                  <Stack gap={2} className="items-end">
                    <Amount value={item.amount} locale={locale} signed />
                    <Amount
                      value={item.balanceAfter}
                      locale={locale}
                      size="sm"
                      className="text-[color:var(--color-text-muted)]"
                    />
                  </Stack>
                </div>
              </Card>
            ))}
          </ul>
        ) : null}

        {cursor ? (
          <Button variant="secondary" onClick={loadMore} disabled={busy} className="self-start">
            {t('activity.loadMore')}
          </Button>
        ) : null}
      </Stack>
    </PageShell>
  );
}

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityList />
    </Suspense>
  );
}
