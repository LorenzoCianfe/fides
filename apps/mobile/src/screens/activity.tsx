import type { TransactionItemDto } from '@fides/contracts';
import { Alert, Amount, Button, Card, Screen, Spinner, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { FlatList, View } from 'react-native';
import { listAccounts, listTransactions } from '../api/accounts';
import { SessionExpiredError } from '../api/client';
import { messageKeyForError } from '../errors';
import { useI18n } from '../i18n';
import { useNavigation } from '../navigation';

const PAGE_SIZE = 20;

export function ActivityScreen({ walletId: initial }: { walletId?: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { back, reset } = useNavigation();

  const [walletId, setWalletId] = React.useState<string | null>(initial ?? null);
  const [items, setItems] = React.useState<TransactionItemDto[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Built once per locale rather than per render: constructing a formatter is
  // not cheap, and this list grows with every page the user loads.
  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const handleFailure = React.useCallback(
    (cause: unknown) => {
      if (cause instanceof SessionExpiredError) {
        reset({ name: 'signIn' });
        return;
      }
      setError(t(messageKeyForError(cause)));
    },
    [t, reset],
  );

  // Reaching this screen without a wallet should still work.
  React.useEffect(() => {
    if (walletId !== null) return;
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then(({ accounts }) => setWalletId(accounts[0]?.wallets[0]?.id ?? null))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) handleFailure(cause);
      });
    return () => controller.abort();
  }, [walletId, handleFailure]);

  React.useEffect(() => {
    if (!walletId) return;
    const controller = new AbortController();
    listTransactions(walletId, { limit: PAGE_SIZE, signal: controller.signal })
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
    if (!walletId || !cursor || busy) return;
    setBusy(true);
    try {
      const page = await listTransactions(walletId, { limit: PAGE_SIZE, cursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll={false}>
      <Typography variant="title">{t('activity.title')}</Typography>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {items === null && !error ? <Spinner label={t('activity.title')} /> : null}
      {items?.length === 0 ? <Alert tone="info">{t('activity.empty')}</Alert> : null}

      {items && items.length > 0 ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          // Paging on scroll rather than a button: a transaction list is the
          // one screen a user genuinely scrolls through.
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={busy ? <Spinner label={t('activity.loadMore')} /> : null}
          renderItem={({ item }) => (
            <Card>
              <Stack gap={4} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Stack gap={2} style={{ flexShrink: 1 }}>
                  <Typography variant="label">{item.type}</Typography>
                  <Typography variant="caption" tone="muted">
                    {dateFormatter.format(new Date(item.occurredAt))}
                  </Typography>
                </Stack>
                <Stack gap={2} style={{ alignItems: 'flex-end' }}>
                  <Amount value={item.amount} locale={locale} signed />
                  <Amount value={item.balanceAfter} locale={locale} size="sm" />
                </Stack>
              </Stack>
            </Card>
          )}
        />
      ) : null}

      <Button title={t('action.back')} variant="ghost" onPress={back} />
    </Screen>
  );
}
