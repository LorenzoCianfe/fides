import * as React from 'react';
import { cn } from './cn';

/**
 * Attributes shared by every element these wrappers can render. Typing against
 * `HTMLElement` rather than a specific element keeps the `as` prop honest: the
 * handler types stay compatible whichever tag is chosen.
 */
type PolymorphicProps<T extends React.ElementType> = React.HTMLAttributes<HTMLElement> & {
  as?: T;
};

export type StackGap = 2 | 3 | 4 | 6 | 8;

export type StackProps = PolymorphicProps<'div' | 'section' | 'main'> & {
  gap?: StackGap;
};

const GAP_CLASS: Record<StackGap, string> = {
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
};

/**
 * Stack styling on its own. `<form>` and `<ul>` carry behaviour and event types
 * that a polymorphic `as` prop can only erase — a form whose `onSubmit` sees
 * `HTMLElement` instead of `HTMLFormElement` is a downgrade — so those elements
 * stay themselves and borrow the classes.
 */
export function stackStyles(options: { gap?: StackGap; className?: string } = {}): string {
  const { gap = 4, className } = options;
  return cn('flex flex-col', GAP_CLASS[gap], className);
}

/** Vertical flow with a token-scaled gap. */
export function Stack({ className, gap = 4, as, ...props }: StackProps): React.JSX.Element {
  const Component = (as ?? 'div') as React.ElementType;
  return <Component className={stackStyles({ gap, className })} {...props} />;
}

export type CardProps = PolymorphicProps<'div' | 'section' | 'article' | 'li'>;

/** Elevated surface for grouped content. */
export function Card({ className, as, ...props }: CardProps): React.JSX.Element {
  const Component = (as ?? 'div') as React.ElementType;
  return (
    <Component
      className={cn(
        'rounded-xl border border-[color:var(--color-border)]',
        'bg-[color:var(--color-surface)] p-5',
        className,
      )}
      {...props}
    />
  );
}

/** Page shell: centred column with responsive padding. */
export function PageShell({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <main
      className={cn('mx-auto w-full max-w-xl px-5 py-10 sm:px-6 sm:py-14', className)}
      {...props}
    />
  );
}
