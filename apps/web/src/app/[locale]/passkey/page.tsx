'use client';

import { Alert, Button, PageShell, Stack } from '@fides/ui-web';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { enrolPasskey } from '../../../lib/api/auth';
import {
  clearEnrolment,
  readEnrolment,
  type EnrolmentHandoff,
} from '../../../lib/enrolment-handoff';
import { messageKeyForError } from '../../../lib/errors';
import { useTranslations } from '../../../lib/i18n/provider';

export default function PasskeyPage() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [handoff, setHandoff] = useState<EnrolmentHandoff | null>(null);
  // Distinguishes "not read yet" from "read, and there was nothing there", so
  // the missing-handoff notice does not flash before the check has run.
  const [checked, setChecked] = useState(false);

  // Both reads need a browser: neither WebAuthn nor sessionStorage exists
  // during server rendering.
  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    setHandoff(readEnrolment());
    setChecked(true);
  }, []);

  async function onCreate(): Promise<void> {
    if (!handoff) return;
    setError(null);
    setBusy(true);
    try {
      await enrolPasskey(handoff.userId, handoff.enrolmentToken);
      // Spent: the passkey it authorized now exists.
      clearEnrolment();
      // Verifying the first passkey also issues the session, so the user is
      // already signed in by the time this resolves.
      router.push(`/${locale}/dashboard`);
    } catch (cause) {
      setError(t(messageKeyForError(cause)));
      setBusy(false);
    }
  }

  const missingHandoff = checked && handoff === null;

  return (
    <PageShell>
      <Stack gap={6}>
        <Stack gap={2}>
          <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
            {t('passkey.title')}
          </h1>
          <p className="text-[color:var(--color-text-secondary)]">{t('passkey.intro')}</p>
        </Stack>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {!supported ? <Alert tone="error">{t('passkey.unsupported')}</Alert> : null}

        {missingHandoff ? (
          <Alert tone="error">{t('passkey.expired')}</Alert>
        ) : (
          <Button
            onClick={onCreate}
            disabled={busy || !supported || !checked}
            className="self-start"
          >
            {t('passkey.create')}
          </Button>
        )}

        {missingHandoff ? (
          <Link href={`/${locale}/signup`} className="text-sm underline self-start">
            {t('landing.createAccount')}
          </Link>
        ) : null}
      </Stack>
    </PageShell>
  );
}
