import * as React from 'react';
import { cn } from './cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. Required: a placeholder is not a label. */
  label: string;
  /** Validation message. Its presence also sets the invalid state. */
  error?: string;
  /** Supporting text shown when there is no error. */
  hint?: string;
}

/**
 * Labelled text input. The label, hint, and error are wired to the control with
 * `htmlFor`/`aria-describedby` rather than left as adjacent text, so the error
 * is announced with the field it belongs to.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, id, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[color:var(--color-text-primary)]"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-11 rounded-md border px-3 text-base',
          'bg-[color:var(--color-surface)] text-[color:var(--color-text-primary)]',
          'placeholder:text-[color:var(--color-text-muted)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-focus-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-[color:var(--color-negative)]'
            : 'border-[color:var(--color-border-strong)]',
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-[color:var(--color-negative)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-[color:var(--color-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
