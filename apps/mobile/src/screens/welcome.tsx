import { Button, Screen, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { useTranslations } from '../i18n';
import { useNavigation } from '../navigation';

export function WelcomeScreen(): React.JSX.Element {
  const t = useTranslations();
  const { navigate } = useNavigation();

  return (
    <Screen>
      <Stack gap={4} style={{ flex: 1, justifyContent: 'center' }}>
        <Typography variant="caption" tone="muted">
          {t('app.name').toUpperCase()}
        </Typography>
        <Typography variant="display">{t('app.tagline')}</Typography>
        <Typography tone="secondary">{t('landing.intro')}</Typography>
      </Stack>

      <Stack gap={3}>
        <Button title={t('landing.createAccount')} onPress={() => navigate({ name: 'signUp' })} />
        <Button
          title={t('landing.signIn')}
          variant="secondary"
          onPress={() => navigate({ name: 'signIn' })}
        />
      </Stack>
    </Screen>
  );
}
