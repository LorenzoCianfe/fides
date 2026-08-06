import { Alert, Button, Screen, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { enrolPasskey } from '../api/auth';
import { passkeysSupported } from '../auth/passkeys';
import { BUILT_FOR_RP_ID } from '../config';
import { messageKeyForError } from '../errors';
import { useTranslations } from '../i18n';
import { useNavigation } from '../navigation';

export function PasskeyScreen({
  userId,
  enrolmentToken,
}: {
  userId: string;
  enrolmentToken: string;
}): React.JSX.Element {
  const t = useTranslations();
  const { reset } = useNavigation();

  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const supported = React.useMemo(passkeysSupported, []);

  async function onCreate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await enrolPasskey(userId, enrolmentToken);
      // Verifying the first passkey also issues the session, so the user is
      // already signed in. `reset` rather than `navigate`: going "back" into a
      // spent enrolment token is not a screen anyone should reach.
      reset({ name: 'dashboard' });
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack gap={2}>
        <Typography variant="title">{t('passkey.title')}</Typography>
        <Typography tone="secondary">{t('passkey.intro')}</Typography>
      </Stack>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {supported ? null : (
        <Stack gap={2}>
          <Alert tone="error">{t('passkey.devBuildRequired')}</Alert>
          {/* Not translated: this is a developer diagnostic, and naming the
              domain the build was signed for is what makes a mismatched
              association debuggable at all. */}
          <Typography variant="caption" tone="muted">
            {BUILT_FOR_RP_ID ? `Built for ${BUILT_FOR_RP_ID}` : 'No FIDES_RP_ID set at build time'}
          </Typography>
        </Stack>
      )}

      <Button
        title={t('passkey.create')}
        busy={busy}
        disabled={!supported}
        onPress={() => void onCreate()}
      />
    </Screen>
  );
}
