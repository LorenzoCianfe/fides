import type { AccountDto } from '@fides/contracts';
import { Alert, Amount, Button, Card, Screen, Spinner, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { listAccounts } from '../api/accounts';
import { signOut } from '../api/auth';
import { SessionExpiredError } from '../api/client';
import { messageKeyForError } from '../errors';
import { useI18n } from '../i18n';
import { useNavigation } from '../navigation';

export function DashboardScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { navigate, reset } = useNavigation();

  const [accounts, setAccounts] = React.useState<AccountDto[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then(({ accounts: loaded }) => setAccounts(loaded))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // An expired session is not an error to show — it is a return to
        // sign-in. The keystore pair may simply have aged out.
        if (cause instanceof SessionExpiredError) {
          reset({ name: 'signIn' });
          return;
        }
        setError(t(messageKeyForError(cause)));
      });
    return () => controller.abort();
  }, [t, reset]);

  async function onSignOut(): Promise<void> {
    await signOut();
    reset({ name: 'welcome' });
  }

  const wallet = accounts?.[0]?.wallets[0];

  return (
    <Screen>
      <Stack gap={4} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Typography variant="title">{t('dashboard.title')}</Typography>
        <Button title={t('nav.signOut')} variant="ghost" onPress={() => void onSignOut()} />
      </Stack>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {accounts === null && !error ? <Spinner label={t('dashboard.title')} /> : null}

      {accounts !== null && !wallet && !error ? (
        // Provisioning is event-driven and asynchronous (ADR-0022): a
        // just-approved user legitimately has no account for a moment.
        <Alert tone="info">{t('dashboard.empty')}</Alert>
      ) : null}

      {wallet ? (
        <>
          <Card>
            <Stack gap={2}>
              <Typography variant="caption" tone="muted">
                {t('dashboard.balance')}
              </Typography>
              <Amount value={wallet.balance} locale={locale} size="lg" />
            </Stack>
          </Card>

          <Stack gap={3}>
            <Button title={t('dashboard.send')} onPress={() => navigate({ name: 'send' })} />
            <Button
              title={t('dashboard.activity')}
              variant="secondary"
              onPress={() => navigate({ name: 'activity', walletId: wallet.id })}
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
