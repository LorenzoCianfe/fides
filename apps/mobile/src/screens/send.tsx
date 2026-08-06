import type { CurrencyCodeDto, TransferResponseDto } from '@fides/contracts';
import { formatMoney, parseAmountToMinor } from '@fides/i18n';
import { Alert, Amount, Button, Card, Screen, Spinner, Stack, Typography } from '@fides/ui-mobile';
import { Input } from '@fides/ui-mobile';
import * as React from 'react';
import { sendMoney } from '../api/accounts';
import { newIdempotencyKey, SessionExpiredError } from '../api/client';
import { messageKeyForError } from '../errors';
import { useI18n } from '../i18n';
import { useNavigation } from '../navigation';

const CURRENCY: CurrencyCodeDto = 'EUR';

type Stage = 'compose' | 'confirm' | 'sending' | 'sent';

export function SendScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { back, reset } = useNavigation();

  const [stage, setStage] = React.useState<Stage>('compose');
  const [error, setError] = React.useState<string | null>(null);
  const [recipientInput, setRecipientInput] = React.useState('');
  const [amountInput, setAmountInput] = React.useState('');
  const [recipient, setRecipient] = React.useState('');
  const [amountMinor, setAmountMinor] = React.useState('');
  const [result, setResult] = React.useState<TransferResponseDto | null>(null);

  /**
   * One key per user intent, held across retries. A retry then replays the
   * original result instead of paying twice; it is regenerated only when the
   * user starts a genuinely new payment.
   */
  const idempotencyKey = React.useRef<string>(newIdempotencyKey());

  function onReview(): void {
    setError(null);
    const nextRecipient = recipientInput.trim();
    const minor = parseAmountToMinor(amountInput, CURRENCY, locale);

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
      if (cause instanceof SessionExpiredError) {
        reset({ name: 'signIn' });
        return;
      }
      setError(t(messageKeyForError(cause, 'transfer')));
      setStage('confirm');
    }
  }

  function onSendAnother(): void {
    idempotencyKey.current = newIdempotencyKey();
    setResult(null);
    setRecipientInput('');
    setAmountInput('');
    setRecipient('');
    setAmountMinor('');
    setError(null);
    setStage('compose');
  }

  return (
    <Screen>
      <Typography variant="title">{t('send.title')}</Typography>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {stage === 'compose' ? (
        <>
          <Stack gap={4}>
            <Input
              label={t('send.recipient')}
              value={recipientInput}
              onChangeText={setRecipientInput}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Input
              label={t('send.amount')}
              hint={t('send.amountHint')}
              value={amountInput}
              onChangeText={setAmountInput}
              keyboardType="decimal-pad"
            />
          </Stack>
          <Stack gap={3}>
            <Button title={t('send.review')} onPress={onReview} />
            <Button title={t('action.back')} variant="ghost" onPress={back} />
          </Stack>
        </>
      ) : null}

      {stage === 'confirm' || stage === 'sending' ? (
        <>
          <Card>
            <Stack gap={3}>
              <Typography variant="label">{t('send.confirmTitle')}</Typography>
              <Amount
                value={{ amount: amountMinor, currency: CURRENCY }}
                locale={locale}
                size="lg"
              />
              <Typography tone="secondary">{recipient}</Typography>
              <Typography variant="caption" tone="muted">
                {t('send.confirmIntro')}
              </Typography>
            </Stack>
          </Card>

          {stage === 'sending' ? (
            <Spinner label={t('send.sending')} />
          ) : (
            <Stack gap={3}>
              <Button title={t('send.confirmSend')} onPress={() => void onConfirm()} />
              <Button
                title={t('action.back')}
                variant="ghost"
                onPress={() => setStage('compose')}
              />
            </Stack>
          )}
        </>
      ) : null}

      {stage === 'sent' && result ? (
        <>
          <Alert tone="success">
            {t('send.success', { amount: formatMoney(result.amount, locale), recipient })}
          </Alert>
          <Stack gap={3}>
            <Button title={t('send.again')} variant="secondary" onPress={onSendAnother} />
            <Button title={t('nav.dashboard')} variant="ghost" onPress={back} />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
