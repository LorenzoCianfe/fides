import { Alert, Button, Input, Screen, Stack, Typography } from '@fides/ui-mobile';
import * as React from 'react';
import { register, type RegisterInput } from '../api/auth';
import { messageKeyForError } from '../errors';
import { useTranslations } from '../i18n';
import { useNavigation } from '../navigation';

const EMPTY: RegisterInput = {
  email: '',
  givenName: '',
  familyName: '',
  dateOfBirth: '',
  addressLine1: '',
  city: '',
  postalCode: '',
  country: '',
};

export function SignUpScreen(): React.JSX.Element {
  const t = useTranslations();
  const { navigate, back } = useNavigation();

  const [form, setForm] = React.useState<RegisterInput>(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  function field(key: keyof RegisterInput) {
    return (value: string) => setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setBusy(true);
    const email = form.email.trim();
    try {
      await register({ ...form, email, country: form.country.toUpperCase() });
      // The verification code is delivered out of band; the address travels so
      // the next screen can address the user by it.
      navigate({ name: 'verify', email });
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Typography variant="title">{t('signup.title')}</Typography>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Stack gap={4}>
        <Input
          label={t('signup.email')}
          value={form.email}
          onChangeText={field('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Input
          label={t('signup.givenName')}
          value={form.givenName}
          onChangeText={field('givenName')}
          autoComplete="given-name"
          textContentType="givenName"
        />
        <Input
          label={t('signup.familyName')}
          value={form.familyName}
          onChangeText={field('familyName')}
          autoComplete="family-name"
          textContentType="familyName"
        />
        <Input
          label={t('signup.dateOfBirth')}
          value={form.dateOfBirth}
          onChangeText={field('dateOfBirth')}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
        <Input
          label={t('signup.addressLine1')}
          value={form.addressLine1}
          onChangeText={field('addressLine1')}
          autoComplete="street-address"
        />
        <Input
          label={t('signup.city')}
          value={form.city}
          onChangeText={field('city')}
          autoComplete="postal-address-locality"
        />
        <Input
          label={t('signup.postalCode')}
          value={form.postalCode}
          onChangeText={field('postalCode')}
          autoComplete="postal-code"
        />
        <Input
          label={t('signup.country')}
          hint={t('signup.countryHint')}
          value={form.country}
          onChangeText={field('country')}
          autoCapitalize="characters"
          maxLength={2}
        />
      </Stack>

      <Stack gap={3}>
        <Button title={t('signup.submit')} busy={busy} onPress={() => void onSubmit()} />
        <Button title={t('action.back')} variant="ghost" onPress={back} />
      </Stack>
    </Screen>
  );
}
