import * as React from 'react';
import { cn } from './cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

/**
 * Seed button primitive. Uses token-backed CSS variables via arbitrary Tailwind
 * values so it themes automatically. The component library grows from here.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-focus-ring)]',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-base',
        variant === 'primary' &&
          'bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] hover:bg-[color:var(--color-accent-hover)]',
        variant === 'secondary' &&
          'bg-[color:var(--color-surface-muted)] text-[color:var(--color-text-primary)]',
        variant === 'ghost' &&
          'bg-transparent text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-surface-muted)]',
        className,
      )}
      {...props}
    />
  );
});
