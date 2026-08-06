'use client';

import { Alert, Button, Input, PageShell, Stack, stackStyles } from '@fides/ui-web';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { resendVerification, verifyEmail } from '../../../lib/api/auth';
import { stashEnrolment } from '../../../lib/enrolment-handoff';
import { messageKeyForError } from '../../../lib/errors';
import { useTranslations } from '../../../lib/i18n/provider';

function VerifyForm() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const email = useSearchParams().get('email') ?? '';

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();

    try {
      const { userId, enrolmentToken } = await verifyEmail(email, code);
      // Handed to the next step out of band rather than through the URL: it is
      // the one-time credential that authorizes the first passkey, and a query
      // string would leave it in history and the address bar.
      stashEnrolment({ userId, enrolmentToken });
      router.push(`/${locale}/passkey`);
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
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
    <PageShell>
      <Stack gap={6}>
        <Stack gap={2}>
          <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
            {t('verify.title')}
          </h1>
          <p className="text-[color:var(--color-text-secondary)]">{t('verify.intro', { email })}</p>
        </Stack>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="info">{notice}</Alert> : null}

        <form className={stackStyles({ gap: 4 })} onSubmit={onSubmit}>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            label={t('verify.code')}
          />
          <Button type="submit" disabled={busy}>
            {t('verify.submit')}
          </Button>
        </form>

        <Button variant="ghost" size="sm" onClick={onResend} className="self-start">
          {t('verify.resend')}
        </Button>
      </Stack>
    </PageShell>
  );
}

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
