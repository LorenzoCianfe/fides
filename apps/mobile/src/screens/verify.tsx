import { Alert, Button, Input, Screen, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { resendVerification, verifyEmail } from '../api/auth';
import { messageKeyForError } from '../errors';
import { useTranslations } from '../i18n';
import { useNavigation } from '../navigation';

export function VerifyScreen({ email }: { email: string }): React.JSX.Element {
  const t = useTranslations();
  const { navigate } = useNavigation();

  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { userId, enrolmentToken } = await verifyEmail(email, code.trim());
      // Carried as navigation state, never persisted: this is the one-time
      // credential that authorizes the account's first passkey.
      navigate({ name: 'passkey', userId, enrolmentToken });
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function onResend(): Promise<void> {
    setError(null);
    try {
      await resendVerification(email);
    } catch {
      // The endpoint answers 202 for unknown addresses by design
      // (anti-enumeration, ADR-0021), so there is nothing useful to report.
    }
    setNotice(t('verify.resent'));
  }

  return (
    <Screen>
      <Stack gap={2}>
        <Typography variant="title">{t('verify.title')}</Typography>
        <Typography tone="secondary">{t('verify.intro', { email })}</Typography>
      </Stack>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <Input
        label={t('verify.code')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
      />

      <Stack gap={3}>
        <Button title={t('verify.submit')} busy={busy} onPress={() => void onSubmit()} />
        <Button title={t('verify.resend')} variant="ghost" onPress={() => void onResend()} />
      </Stack>
    </Screen>
  );
}
