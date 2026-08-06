import { formatMoney, moneyDirection, type MoneyLike } from '@fides/i18n';
import * as React from 'react';
import type { TextStyle } from 'react-native';
import { Typography, type TypographyProps } from './text';

export interface AmountProps extends Omit<TypographyProps, 'children' | 'tone' | 'variant'> {
  value: MoneyLike;
  locale?: string;
  /** Colour by direction. Off for balances, on for ledger movements. */
  signed?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const VARIANT: Record<NonNullable<AmountProps['size']>, TypographyProps['variant']> = {
  sm: 'caption',
  md: 'body',
  lg: 'display',
};

/**
 * A monetary value, formatted by the shared locale-aware helper so web and
 * mobile round and group identically. Direction colour is opt-in because a
 * balance is not a movement: a positive balance shown in green reads as an
 * increase that did not happen.
 */
export function Amount({
  value,
  locale = 'en',
  signed = false,
  size = 'md',
  style,
  ...props
}: AmountProps): React.JSX.Element {
  const direction = moneyDirection(value);
  const tone = signed && direction !== 'zero' ? direction : 'primary';

  return (
    <Typography
      variant={VARIANT[size]}
      tone={tone}
      // Keeps columns of figures aligned, matching the web `tabular-nums`.
      style={[{ fontVariant: ['tabular-nums'] } as TextStyle, style]}
      {...props}
    >
      {signed && direction === 'positive' ? '+' : ''}
      {formatMoney(value, locale)}
    </Typography>
  );
}
