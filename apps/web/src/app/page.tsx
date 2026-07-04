import { Button } from '@fides/ui-web';

const appName = process.env.APP_NAME ?? 'Fides';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {appName}
        </span>
        <h1 className="text-4xl font-semibold text-[color:var(--color-text-primary)]">
          Money, made clear.
        </h1>
        <p className="text-lg text-[color:var(--color-text-secondary)]">
          Phase 0 foundations are in place. This is the customer web shell, wired to the shared
          design tokens and component library.
        </p>
      </div>
      <div className="flex gap-3">
        <Button>Get started</Button>
        <Button variant="secondary">Learn more</Button>
      </div>
    </main>
  );
}
