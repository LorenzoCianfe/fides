import { Alert, Button, Input, Screen, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { signIn } from '../api/auth';
import { passkeysSupported } from '../auth/passkeys';
import { messageKeyForError } from '../errors';
import { useTranslations } from '../i18n';
import { useNavigation } from '../navigation';

export function SignInScreen(): React.JSX.Element {
  const t = useTranslations();
  const { reset, back } = useNavigation();

  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const supported = React.useMemo(passkeysSupported, []);

  async function onSubmit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim());
      reset({ name: 'dashboard' });
    } catch (cause) {
      setError(t(messageKeyForError(cause, 'signin')));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack gap={2}>
        <Typography variant="title">{t('signin.title')}</Typography>
        <Typography tone="secondary">{t('signin.intro')}</Typography>
      </Stack>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {supported ? null : <Alert tone="error">{t('passkey.devBuildRequired')}</Alert>}

      <Input
        label={t('signup.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />

      <Stack gap={3}>
        <Button
          title={t('signin.submit')}
          busy={busy}
          disabled={!supported}
          onPress={() => void onSubmit()}
        />
        <Button title={t('action.back')} variant="ghost" onPress={back} />
      </Stack>
    </Screen>
  );
}
