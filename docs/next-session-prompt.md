# Prompt for the next conversation

Copy everything below the line into a new conversation.

---

You are continuing work on **Fides**, a production-grade simulated-core EU neobank
at `C:\Users\loren\Desktop\Progetti - AI\neobank`. Read `docs/phase-1-handoff.md`
first — it is the authoritative continuation document — then `documentation.md`,
`roadmap.md`, `design.md`, and `security.md`. Honour the working process recorded
in memory: discovery-first, formal prose with no emoji in docs, and delegated
technical calls made with a justified recommendation rather than a menu.

## Where things stand

**Phase 1 (walking skeleton) is COMPLETE.** Slices 1–7 (the backend) are on
`main`. Slice 8 (the clients) is [PR #30](https://github.com/LorenzoCianfe/fides/pull/30),
which I was told would be merged once CI went green.

**Before doing anything else, confirm PR #30 actually merged**, and that `main`
contains all six of its commits:

```bash
git fetch origin && git log --oneline origin/main -8
```

If it has not merged, check `gh pr checks 30` and resolve before starting new
work. If it has, branch from an up-to-date `main` — the repo convention is one
feature branch and one PR per slice, with conventional commits, because CI and
CodeQL only run on `main` pushes and PRs targeting `main`.

What Slice 8 delivered: `apps/web` (7 screens, en/it, httpOnly-cookie
transport), `apps/mobile` (8 screens, native passkeys, bearer tokens in the
platform keystore), the new `packages/i18n` (shared catalogue, locale
negotiation, `BigInt`-exact money formatting), and the new `apps/e2e` (Playwright
journey through the full Phase 1 exit criteria, its own CI job).

## Your task, in order

The user's decision: **clear the Phase 1 debt first, then start Phase 2** — and
build the admin UI early in Phase 2.

### 1. Clear the Phase 1 debt

Each item below is real and was deliberately deferred, not forgotten. Treat the
security ones as the priority. Propose an order and a scope, get agreement, then
work slice by slice with an ADR per substantive decision.

**Security gaps (recorded in `security.md`):**

- **TOTP secrets for admins are stored unencrypted.** Accepted in ADR-0025 until
  field-level encryption or a KMS exists. Anyone with a database read can mint
  valid second factors, which defeats admin MFA entirely. This is the most
  serious open item.
- **No admin password rotation, self-service change, or TOTP reset.** A
  compromised or lost admin factor currently has no recovery path short of a
  direct database edit.
- **No per-account login lockout** for admins — only global rate limiting. Online
  password guessing against a known admin address is throttled but not stopped.
- **Audit tail-truncation is not detected.** The hash chain proves no record was
  altered or removed from the middle, but an attacker who deletes the most recent
  N records leaves a still-valid chain. Needs an external anchor (periodic
  publication of the head hash). ADR-0024 deferred it.
- **Denied attempts are not audited** — only successful actions. Deliberate,
  because a denial has no transaction to be atomic with, but it means failed
  authorization attempts leave no trail.
- **Customer account recovery does not exist.** Passkeys are the only credential
  (ADR-0020); a user who loses every device loses the account.

**Dependency and toolchain debt:**

- **[PR #26](https://github.com/LorenzoCianfe/fides/pull/26) is open and must not
  be merged as it stands.** It groups harmless `react`/`react-dom`/`openapi3-ts`
  bumps together with **`react-native` `^0.79.0` → `^0.86.2`**, which breaks the
  mobile app: Expo 53 is paired with RN 0.79, and RN 0.86 pulls a Metro whose
  `exports` map no longer provides `./src/lib/TerminalReporter`, which the Expo
  53 CLI requires. Verified by checking the branch out and bundling. Moving RN
  means moving the Expo SDK with it — a Phase 7 decision, not a minor-patch
  bump. Either wait for Dependabot to regroup without `react-native`, or take
  the RN and Expo SDK move deliberately as its own piece of work. The reasoning
  is recorded as a comment on the PR.
- The other Dependabot work has landed: dev tooling (eslint, prettier, turbo,
  tsx, `drizzle-kit` 0.30→0.31, `@types/node`) via #29, and the GitHub Actions
  majors (`pnpm/action-setup` v4→v6, `setup-node` v6→v7, `upload-artifact`
  v4→v7) via #31.
- **The `brace-expansion` patch is live maintenance debt** (`patches/brace-expansion@5.0.9.patch`,
  ADR-0026 plus its addendum). Its exit condition is the Expo toolchain dropping
  `glob@7`/`rimraf@3`, which is what drags in the `minimatch@3` needing the
  compatibility shim. Check whether that has happened. **The pin moved 5.0.8 →
  5.0.9 during Slice 8** because a new advisory (`GHSA-rgw5-rvv9-x895`) covered
  everything below 5.0.9; expect this to recur, and note that the exact-version
  pin is what makes it fail loudly rather than silently drop the shim.
- **`@nestjs/core` has an open moderate advisory** patched only in `>= 11.1.18`,
  a Nest 10→11 major belonging to Phase 7. Below the gate threshold, so it does
  not block, but it is real.
- **The standing `lodash` audit suppression** (`GHSA-r5fr-rjxr-66jc`) stays
  because its declared patch target `lodash >= 4.18.0` was never published.
  Reachable from `apps/api` via `@nestjs/swagger`. Re-check whether a fix exists.

**Verification gaps:**

- **Native passkeys have never been verified on a physical device.** They cannot
  work against `localhost` — no platform makes the secure-context exception that
  browsers do. `docs/mobile-passkeys.md` documents the online path and the local
  tunnel path in full; what is missing is someone running it on real hardware.
  This is the single largest untested claim in the codebase.
- **The E2E suite covers only the happy path.** Worth adding: idempotency replay
  (the same key returning the original result rather than paying twice), refresh
  reuse detection revoking a session, CSRF rejection, insufficient funds, and
  self-transfer.
- **No accessibility pass.** `design.md` commits to WCAG 2.2 AA; neither client
  has been audited against it.
- **`apps/admin` is an empty Next.js shell** — see below.

### 2. Then Phase 2 — Payments & cards, admin UI first

Per `roadmap.md`, and per the user's decision that the admin UI comes early:

- **Admin back office UI** (`apps/admin`). The API behind it is complete and
  currently reachable only by raw HTTP: two-step login (password + TOTP),
  customer and wallet views, ledger reconciliation, the audit read/verify
  surface, four-eyes funding approval, and admin staffing. Build against
  `@fides/ui-web` and `@fides/i18n`, which already exist.
- SEPA Credit Transfer in/out and SEPA Instant via the mock `PaymentRailPort`.
- IBAN assignment; payee management, including **public payment handles (`@tag`)
  replacing email as the P2P recipient identifier** (ADR-0023 notes email is a
  Phase 1 stand-in).
- Virtual debit card issuance via the mock `CardIssuerPort`; authorization and
  settlement simulation against the ledger.
- Card controls: limits, freeze/unfreeze, category and channel toggles, 3DS/SCA
  on sensitive card actions.

Phase 2 exit criteria: a user receives a SEPA credit, spends on a virtual card,
and sees correct ledger effects; an admin freezes a card and restricts an
account; four-eyes is enforced on high-risk admin actions.

## Environment — read this before running anything

These were **corrected during Slice 8**; older notes in the repo may contradict
them.

- **`pnpm` is not on the tool shell's PATH.** It lives at `%APPDATA%\npm\pnpm.cmd`.
  Prefix every call: `$env:PATH = "$env:APPDATA\npm;$env:PATH"; pnpm ...`
- **Use the PowerShell tool for pnpm and for git commits.** The Bash tool cannot
  see pnpm at all, and the husky pre-commit hook runs `pnpm exec lint-staged`, so
  committing from Bash fails with `pnpm: command not found`.
- **Turbo root scripts work** (`pnpm lint`, `typecheck`, `test`, `build`). The old
  "cannot find pnpm binary" note is stale.
- **`pnpm test` and the E2E suite need Docker Desktop running**
  (`C:\Program Files\Docker\Docker\Docker Desktop.exe`, ~1 minute to become ready).
- Long commit messages: write to a scratchpad file, then `git commit -F <file>`.
- `pnpm patch` / `pnpm patch-commit` must be run **from the Bash tool** —
  `patch-commit` rejected the path when invoked from PowerShell.

## Conventions that are not obvious from the code

- **DI and validation:** the vitest esbuild transform emits no decorator
  metadata, so every Nest-instantiated class needs explicit `@Inject(Token)`
  constructor parameters and every `@Body`/`@Param` needs an explicit
  `new ZodValidationPipe(Dto)`. Type-only injection silently yields `undefined`
  in tests.
- `apps/api` consumes `@fides/contracts` from its **built `dist`** — run
  `pnpm --filter @fides/contracts build` after editing contracts, before
  typechecking the API.
- **`resetDb` in `apps/api/test/db.ts` must list every table.** Adding a table
  without adding it there leaves state bleeding between tests.
- **`approve` on a pending admin action deliberately performs no pre-flight
  status check.** An earlier version did, and it rejected a checker's retry
  carrying the original `Idempotency-Key` with a 400 — exactly the case
  idempotency exists for. The authoritative checks run once, under `FOR UPDATE`,
  inside the posting transaction, which an idempotent replay never enters.
- **`pnpm audit` counts suppressed advisories in its summary but excludes them
  from the exit code.** The gate prints "1 high" while passing. Read the exit
  status, not the count.
- Audit overrides are keyed on the **advisory's vulnerable range**
  (`"postcss@<8.5.18": ">=8.5.18"`), never a bare package name, so they cannot
  silently upgrade an unrelated major line.
- **Money never passes through `Number`** anywhere. Minor units are bigint-safe
  strings because balances can exceed `MAX_SAFE_INTEGER`.

## Traps found the hard way in Slice 8

Worth knowing before touching the clients or the E2E suite:

- **Supertest cannot validate cookie *scoping*.** It sends whatever `Cookie`
  header a test constructs and models no path matching. This is how a real bug
  shipped: the CSRF cookie was scoped to `/v1`, making it unreadable by a web
  client served from `/`, so every state-changing request in cookie mode returned
  403. The integration test asserted the cookie was *readable* but never its
  *path*. Only the browser-driven E2E caught it. **Assert cookie paths
  explicitly.**
- **`transaction_history` is an asynchronous projection** from
  `ledger.entry.posted` via the outbox, while balances are maintained
  synchronously inside the posting transaction (ADR-0019). Any assertion about a
  statement row must poll; any assertion about a balance need not.
- **Playwright specifics:** its config cannot transitively import
  `testcontainers` (which reaches CommonJS-only `@grpc/grpc-js` and breaks the
  config load); the e2e package must **not** be `"type": "module"` for the same
  reason; workers do not share module state with `globalSetup`, so state travels
  by environment variable; and on Windows a shell-spawned server survives
  `child.kill()` and holds its port.
- **`NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are inlined at build time** and also feed
  the web CSP, which is why the E2E has its own `build:stack`. They are now part
  of turbo's `build` cache key — they were not, which meant changing one would
  not have invalidated a cached bundle.
- **Metro under pnpm needs hierarchical lookup ON.** The common advice to set
  `disableHierarchicalLookup` targets npm and yarn, where everything is hoisted
  flat; pnpm keeps a package's dependencies as siblings inside its own directory,
  so walking up is exactly what resolves them.
- **A green pipeline is only as wide as its jobs.** `apps/mobile` had no `build`
  script, so `pnpm build` skipped it; the end-to-end suite covers web only; and
  Expo declares its peers as `*`, so the resolver raises nothing. Three blind
  spots lined up, and a dependency bump that made the app impossible to bundle
  passed all six checks. `expo export` now runs as that package's `build`. When
  adding a new app or package, check that something in CI actually executes it —
  lint and typecheck passing is not the same as the thing working.

## How to work

- Discovery first: read before proposing, and propose before building.
- One feature branch per slice, conventional commits, one PR to `main`.
- An ADR per substantive decision, in `docs/adr/`. The next free number is
  **0028**.
- Keep `documentation.md`, `roadmap.md`, `design.md`, `security.md`, the
  `CHANGELOG`, and `docs/phase-1-handoff.md` current as you go.
- Verify before claiming: run lint, typecheck, tests, build, and the audit gate,
  and say what actually ran. Do not report work as done on the strength of a
  typecheck alone — Slice 8 produced two defects that only a real browser found.
