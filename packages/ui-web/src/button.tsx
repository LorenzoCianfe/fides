import * as React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Button styling, exposed separately so a link can look like a button without
 * a `Slot`/`asChild` polymorphism layer. A navigation control should stay an
 * anchor — keyboard behaviour, middle-click, and "open in new tab" all come
 * from the element, not from styling.
 */
export function buttonStyles(
  options: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = 'primary', size = 'md', className } = options;
  return cn(
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
  );
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
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  );
});
