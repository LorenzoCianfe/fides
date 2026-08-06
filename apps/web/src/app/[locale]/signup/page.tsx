'use client';

import { Alert, Button, Input, PageShell, Stack, stackStyles } from '@fides/ui-web';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { register } from '../../../lib/api/auth';
import { messageKeyForError } from '../../../lib/errors';
import { useTranslations } from '../../../lib/i18n/provider';

export default function SignUpPage() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();

    try {
      await register({
        email,
        givenName: String(form.get('givenName') ?? ''),
        familyName: String(form.get('familyName') ?? ''),
        dateOfBirth: String(form.get('dateOfBirth') ?? ''),
        addressLine1: String(form.get('addressLine1') ?? ''),
        city: String(form.get('city') ?? ''),
        postalCode: String(form.get('postalCode') ?? ''),
        country: String(form.get('country') ?? '').toUpperCase(),
      });
      // The verification code is delivered out of band; the address is carried
      // in the URL so the next step can address the user by it.
      router.push(`/${locale}/verify?email=${encodeURIComponent(email)}`);
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <Stack gap={6}>
        <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
          {t('signup.title')}
        </h1>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <form className={stackStyles({ gap: 4 })} onSubmit={onSubmit}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            label={t('signup.email')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              name="givenName"
              autoComplete="given-name"
              required
              label={t('signup.givenName')}
            />
            <Input
              name="familyName"
              autoComplete="family-name"
              required
              label={t('signup.familyName')}
            />
          </div>
          <Input name="dateOfBirth" type="date" required label={t('signup.dateOfBirth')} />
          <Input
            name="addressLine1"
            autoComplete="address-line1"
            required
            label={t('signup.addressLine1')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="city" autoComplete="address-level2" required label={t('signup.city')} />
            <Input
              name="postalCode"
              autoComplete="postal-code"
              required
              label={t('signup.postalCode')}
            />
          </div>
          <Input
            name="country"
            required
            maxLength={2}
            className="uppercase"
            label={t('signup.country')}
            hint={t('signup.countryHint')}
          />

          <Button type="submit" disabled={busy}>
            {t('signup.submit')}
          </Button>
        </form>

        <p className="text-sm text-[color:var(--color-text-secondary)]">
          {t('signup.haveAccount')}{' '}
          <Link href={`/${locale}/signin`} className="underline">
            {t('landing.signIn')}
          </Link>
        </p>
      </Stack>
    </PageShell>
  );
}
