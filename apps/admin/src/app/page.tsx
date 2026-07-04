import { Button } from '@fides/ui-web';

const appName = process.env.APP_NAME ?? 'Fides';

export default function AdminHomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {appName} Admin
        </span>
        <h1 className="text-4xl font-semibold text-[color:var(--color-text-primary)]">
          Back office
        </h1>
        <p className="text-lg text-[color:var(--color-text-secondary)]">
          Phase 0 foundations are in place. Role-aware operations, cases, and reporting land in
          later phases behind RBAC and four-eyes controls.
        </p>
      </div>
      <div className="flex gap-3">
        <Button>Open console</Button>
        <Button variant="ghost">Documentation</Button>
      </div>
    </main>
  );
}
