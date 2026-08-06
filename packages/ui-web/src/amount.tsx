import * as React from 'react';
import { cn } from './cn';
import { formatMoney, moneyDirection, type MoneyLike } from './money';

export interface AmountProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: MoneyLike;
  locale?: string;
  /** Colour by direction. Off for balances, on for ledger movements. */
  signed?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<AmountProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-3xl',
};

/**
 * A monetary value. Direction colour is opt-in because a balance is not a
 * movement: showing a positive balance in green reads as an increase.
 * `tabular-nums` keeps columns of figures aligned.
 */
export function Amount({
  className,
  value,
  locale = 'en',
  signed = false,
  size = 'md',
  ...props
}: AmountProps): React.JSX.Element {
  const direction = moneyDirection(value);
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        SIZE_CLASS[size],
        signed && direction === 'positive' && 'text-[color:var(--color-positive)]',
        signed && direction === 'negative' && 'text-[color:var(--color-negative)]',
        !signed && 'text-[color:var(--color-text-primary)]',
        className,
      )}
      {...props}
    >
      {signed && direction === 'positive' ? '+' : ''}
      {formatMoney(value, locale)}
    </span>
  );
}
