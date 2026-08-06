'use client';

import type { TransferResponseDto } from '@fides/contracts';
import {
  Alert,
  Amount,
  Button,
  Card,
  formatMoney,
  Input,
  PageShell,
  parseAmountToMinor,
  Spinner,
  Stack,
  stackStyles,
} from '@fides/ui-web';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { sendMoney } from '../../../lib/api/accounts';
import { newIdempotencyKey } from '../../../lib/api/client';
import { messageKeyForError } from '../../../lib/errors';
import { useI18n } from '../../../lib/i18n/provider';

const CURRENCY = 'EUR';

type Stage = 'compose' | 'confirm' | 'sending' | 'sent';

export default function SendPage() {
  const { t, locale } = useI18n();
  const { locale: localeParam } = useParams<{ locale: string }>();

  const [stage, setStage] = useState<Stage>('compose');
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [result, setResult] = useState<TransferResponseDto | null>(null);

  /**
   * One key per user intent, held across retries. A retry then replays the
   * original result instead of paying twice; it is regenerated only when the
   * user starts a genuinely new payment.
   */
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  function onReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const nextRecipient = String(form.get('recipient') ?? '').trim();
    const minor = parseAmountToMinor(String(form.get('amount') ?? ''), CURRENCY, locale);

    if (!nextRecipient) {
      setError(t('error.recipientRequired'));
      return;
    }
    if (minor === null || minor === '0') {
      setError(t('error.amountInvalid'));
      return;
    }

    setRecipient(nextRecipient);
    setAmountMinor(minor);
    setStage('confirm');
  }

  async function onConfirm(): Promise<void> {
    setError(null);
    setStage('sending');
    try {
      // Step-up happens inside sendMoney: the passkey signs these exact
      // parameters, and the server re-derives the hash from what it executes.
      const transfer = await sendMoney({
        recipient,
        amountMinor,
        currency: CURRENCY,
        idempotencyKey: idempotencyKey.current,
      });
      setResult(transfer);
      setStage('sent');
    } catch (cause) {
      setError(t(messageKeyForError(cause, 'transfer')));
      setStage('confirm');
    }
  }

  function onSendAnother(): void {
    idempotencyKey.current = newIdempotencyKey();
    setResult(null);
    setRecipient('');
    setAmountMinor('');
    setError(null);
    setStage('compose');
  }

  return (
    <PageShell>
      <Stack gap={6}>
        <h1 className="text-3xl font-semibold text-[color:var(--color-text-primary)]">
          {t('send.title')}
        </h1>

        {error ? <Alert tone="error">{error}</Alert> : null}

        {stage === 'compose' ? (
          <form className={stackStyles({ gap: 4 })} onSubmit={onReview}>
            <Input
              name="recipient"
              type="email"
              required
              defaultValue={recipient}
              label={t('send.recipient')}
            />
            <Input
              name="amount"
              inputMode="decimal"
              required
              label={t('send.amount')}
              hint={t('send.amountHint')}
            />
            <Button type="submit">{t('send.review')}</Button>
          </form>
        ) : null}

        {stage === 'confirm' || stage === 'sending' ? (
          <Stack gap={4}>
            <Card>
              <Stack gap={3}>
                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                  {t('send.confirmTitle')}
                </span>
                <Amount
                  value={{ amount: amountMinor, currency: CURRENCY }}
                  locale={locale}
                  size="lg"
                />
                <span className="text-sm text-[color:var(--color-text-secondary)]">
                  {recipient}
                </span>
                <p className="text-sm text-[color:var(--color-text-muted)]">
                  {t('send.confirmIntro')}
                </p>
              </Stack>
            </Card>

            {stage === 'sending' ? (
              <Spinner label={t('send.sending')} />
            ) : (
              <div className="flex gap-3">
                <Button onClick={onConfirm}>{t('send.confirmSend')}</Button>
                <Button variant="ghost" onClick={() => setStage('compose')}>
                  {t('action.back')}
                </Button>
              </div>
            )}
          </Stack>
        ) : null}

        {stage === 'sent' && result ? (
          <Stack gap={4}>
            <Alert tone="success">
              {t('send.success', {
                amount: formatMoney(result.amount, locale),
                recipient,
              })}
            </Alert>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onSendAnother}>
                {t('send.again')}
              </Button>
              <Link
                href={`/${localeParam}/dashboard`}
                className="self-center text-sm underline text-[color:var(--color-text-secondary)]"
              >
                {t('nav.dashboard')}
              </Link>
            </div>
          </Stack>
        ) : null}
      </Stack>
    </PageShell>
  );
}
