import { CURRENCIES, type CurrencyCode } from '@fides/domain';
import { z } from '../zod';

// Single source of truth: the currency enum is derived from the domain
// registry, so the wire contract can never drift from supported currencies.
const currencyCodes = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

export const CurrencyCodeSchema = z
  .enum(currencyCodes)
  .openapi('CurrencyCode', { description: 'ISO 4217 currency code', example: 'EUR' });

export type CurrencyCodeDto = z.infer<typeof CurrencyCodeSchema>;

export const MoneySchema = z
  .object({
    amount: z
      .string()
      .regex(/^-?\d+$/, 'amount must be integer minor units encoded as a string')
      .openapi({ description: 'Integer minor units (bigint-safe string)', example: '1050' }),
    currency: CurrencyCodeSchema,
  })
  .openapi('Money');

export type MoneyDto = z.infer<typeof MoneySchema>;
