'use client';

import { Alert, Button, Input, PageShell, Stack, stackStyles } from '@fides/ui-web';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { signIn } from '../../../lib/api/auth';
import { messageKeyForError } from '../../../lib/errors';
import { useTranslations } from '../../../lib/i18n/provider';

export default function SignInPage() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();

    try {
      await signIn(email);
      router.push(`/${locale}/dashboard`);
    } catch (cause) {
      setError(t(messageKeyForError(cause, 'signin')));
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <Stack gap={6}>
        <Stack gap={2}>
          <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
            {t('signin.title')}
          </h1>
          <p className="text-[color:var(--color-text-secondary)]">{t('signin.intro')}</p>
        </Stack>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <form className={stackStyles({ gap: 4 })} onSubmit={onSubmit}>
          <Input
            name="email"
            type="email"
            // `webauthn` lets the browser offer passkeys in the autofill menu.
            autoComplete="username webauthn"
            required
            label={t('signup.email')}
          />
          <Button type="submit" disabled={busy}>
            {t('signin.submit')}
          </Button>
        </form>

        <p className="text-sm text-[color:var(--color-text-secondary)]">
          {t('signin.noAccount')}{' '}
          <Link href={`/${locale}/signup`} className="underline">
            {t('landing.createAccount')}
          </Link>
        </p>
      </Stack>
    </PageShell>
  );
}
