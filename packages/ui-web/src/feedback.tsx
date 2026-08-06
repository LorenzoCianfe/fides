import * as React from 'react';
import { cn } from './cn';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'error' | 'success' | 'info';
}

const TONE_CLASS: Record<NonNullable<AlertProps['tone']>, string> = {
  error: 'border-[color:var(--color-negative)] text-[color:var(--color-negative)]',
  success: 'border-[color:var(--color-positive)] text-[color:var(--color-positive)]',
  info: 'border-[color:var(--color-info)] text-[color:var(--color-text-secondary)]',
};

/**
 * Inline message. Errors are announced assertively because they usually follow
 * a failed submission the user is waiting on; other tones are polite.
 */
export function Alert({ className, tone = 'info', ...props }: AlertProps): React.JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border-l-2 bg-[color:var(--color-surface-muted)] px-4 py-3 text-sm',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    />
  );
}

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: string;
}

/** Busy indicator. The label is for assistive tech, not the eye. */
export function Spinner({ className, label, ...props }: SpinnerProps): React.JSX.Element {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--color-border-strong)] border-t-[color:var(--color-accent)]"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
