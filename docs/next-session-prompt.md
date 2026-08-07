# Prompt for the next conversation

Copy everything below the line into a new conversation.

---

You are continuing work on **Fides**, a production-grade simulated-core EU neobank
at `C:\Users\loren\Desktop\Progetti - AI\neobank`. Read `docs/phase-1-handoff.md`
first — it is the authoritative continuation document — then `documentation.md`,
`roadmap.md`, `design.md`, and `security.md`. Honour the working process recorded
in memory: discovery-first, formal prose with no emoji in docs, and delegated
technical calls made with a justified recommendation rather than a menu.

**Commit as me, not as Claude.** No `Co-Authored-By: Claude` trailer on commits,
and no "Generated with Claude Code" footer on PR bodies. Commits are authored by
LorenzoCianfe alone.

## Where things stand

**Phase 1 is complete, and its remediation is half done.** Everything below is on
`main`; there is nothing outstanding to merge except the deliberately-open #26.

| Slice | Scope | Status |
|---|---|---|
| 1–8 | The whole walking skeleton: ledger, identity, accounts, transfer, audit, admin, clients, E2E | Done |
| 9 | Dependency hygiene | Done — [#34](https://github.com/LorenzoCianfe/fides/pull/34) |
| 10 A | TOTP secret encryption, lockout, denied-attempt audit | Done — [#35](https://github.com/LorenzoCianfe/fides/pull/35) |
| **10 B** | **Admin password change and TOTP reset** | **Next** |
| 11 | Audit tail-truncation anchoring | Pending |
| 12 | Five missing E2E cases + automated accessibility gate | Pending |

Confirm the state before starting:

```bash
git fetch origin && git log --oneline origin/main -6
```

You should see the merges of #35 and #34 at the top. Branch from an up-to-date
`main` — one feature branch and one PR per slice, conventional commits, because
CI and CodeQL only run on `main` pushes and PRs targeting `main`.

**Next free ADR number is 0030.**

### What Slice 9 changed (#34)

- **The last audit suppression is retired.** `GHSA-r5fr-rjxr-66jc` was suppressed
  because `lodash >= 4.18.0` "had never been published" — which stopped being
  true on 2026-03-31. Closed with a range-scoped override; `pnpm.auditConfig` is
  gone from the manifest. **The gate now reports zero highs and exits zero**, so
  the old "read the exit status, not the count" trap no longer applies — though
  the rule still holds for whatever gets suppressed next.
- Verified before taking it: `@nestjs/swagger` calls thirty `lodash` utilities and
  never `_.template`, all thirty still export from 4.18.1, and `_.template`
  survives — 4.18 hardened it rather than deleting it. Deleting is the usual fix
  for a template-injection advisory and would have broken Swagger.
- **Corrected: the `brace-expansion` patch waits on React Native, not Expo.**
  Every `@expo/*` package now resolves `glob@13`; the whole `glob@7.2.3` /
  `rimraf@3.0.2` surface enters through `react-native@0.79.7` itself — directly,
  and via `@react-native/codegen`, `community-cli-plugin` → `dev-middleware` →
  `chromium-edge-launcher` → `rimraf@3`, and `babel-jest` → `test-exclude@6`. It
  is **not independently clearable**: it retires with the RN major, which is the
  Expo SDK move, which is #26, which is Phase 7.

### What Slice 10 Wave A changed (#35)

**ADR-0028 — field-level encryption.** `EncryptionPort` (token `ENCRYPTION`) with
`KeyringEncryption`, AES-256-GCM, in `apps/api/src/shared/crypto/encryption.ts`.
KMS-shaped per ADR-0001, so that adapter drops in without touching a caller.

- Envelope `fenc$v1$keyId$iv$tag$ciphertext` is self-describing, so **rotation is
  configuration, not a migration**: put the new key first in `ENCRYPTION_KEYS`,
  keep the old one.
- **The admin id is GCM additional authenticated data.** This defeats grafting one
  operator's ciphertext onto another's row — which plain encryption would *not*
  stop, because the copied ciphertext decrypts perfectly well.
- **`ENCRYPTION_KEYS` is required with no default and the API will not boot
  without it.** A default is a published key; a plaintext fallback is a silent
  downgrade. This has deployment impact — see the environment section.
- Legacy plaintext secrets still read and are re-sealed on their next
  **successful** verification. A SQL data migration was impossible: the migrator
  cannot reach the keyring.
- **Known limit, stated in the ADR:** this defends a database read, not a host
  that also holds the environment.

**ADR-0029 — lockout and denied-attempt auditing.** These read as two gaps and
are one problem.

- Both factors share one counter (default 5 attempts, 15-minute window). It
  clears **only** in `issueSession`, where both factors have succeeded — clearing
  it at the password step would let an attacker who holds the password reset the
  counter at will and grind the code forever.
- **The key insight to preserve:** both the counter and the denial record must
  escape `verifyMfa`'s *deliberate* rollback (which exists so a typo does not also
  spend the login challenge). They are therefore written in their own transaction
  after the failure — the documented exception to ADR-0024's atomicity rule. This
  is exactly why failed second-factor attempts had gone uncounted before.
- Only a rejected **code** counts, never a spent challenge, or a dead token
  becomes a lockout denial-of-service.
- Denials are recorded only for a **known** admin: an unknown address has no admin
  to reference and is PII an un-erasable trail must not hold.
- Migration `0012` adds `failed_login_attempts` and `locked_until`.

## Your task, in order

### 1. Slice 10 Wave B — admin credential recovery

The remaining ADR-0025 gap: **no admin password rotation, no self-service password
change, no TOTP reset.** A compromised or lost admin factor has no recovery path
short of a direct database edit. Suggested shape, to be confirmed by discovery:

- Self-service password change for the authenticated admin (requires the current
  password; consider requiring a fresh TOTP code as well).
- TOTP reset **behind four-eyes** — the `pending_admin_actions` table is already
  generic with one registered type, and this is the natural second type. A reset
  is a second-factor bypass by definition, so it should not be unilateral.
- Consider whether a password change should revoke the admin's other sessions.
- New audit actions; new permissions in the matrix; watch the SoD invariant test.

### 2. Slice 11 — audit tail anchoring

Closes the ADR-0024 deferral. The hash chain proves no record was altered or
removed from the *middle*, but deleting the most recent N records leaves a
still-valid chain. Needs an external high-water anchor: periodic publication of
the head hash and sequence, plus verification against it. Decide where the anchor
lives (a separate table is not enough on its own — an attacker with database
access can truncate both).

### 3. Slice 12 — verification breadth

- **Five missing E2E cases**, all agreed: idempotency replay (the same key
  returning the original result rather than paying twice), refresh reuse detection
  revoking a session, CSRF rejection, insufficient funds, self-transfer.
- **An automated accessibility gate** — add `axe-core` to the Playwright suite so
  contrast, labels, roles, and landmarks are enforced on every PR. The **manual**
  WCAG 2.2 AA audit stays in Phase 7 per `roadmap.md`; this is the agreed middle
  path that honours `design.md`'s "not a later pass" without pulling Phase 7
  forward.

### 4. Then Phase 2 — Payments & cards, admin UI first

Per `roadmap.md` and the standing decision that the admin UI comes early:

- **Admin back office UI** (`apps/admin`, currently an empty Next.js shell — five
  source files). The API behind it is complete and reachable only by raw HTTP:
  two-step login (password + TOTP), customer and wallet views, ledger
  reconciliation, audit read/verify, four-eyes funding approval, admin staffing.
  Build against `@fides/ui-web` and `@fides/i18n`, which already exist.
- **Customer account recovery** — agreed to *design now, build here*, because
  support-mediated recovery needs the back office to operate it. Passkeys are the
  only credential (ADR-0020), so a user who loses every device loses the account.
- SEPA Credit Transfer in/out and SEPA Instant via the mock `PaymentRailPort`.
- IBAN assignment; payee management, including **public payment handles (`@tag`)
  replacing email as the P2P recipient identifier** (ADR-0023 notes email is a
  Phase 1 stand-in, and the current transfer route exposes a throttled
  recipient-existence oracle that handles supersede).
- Virtual debit card issuance via the mock `CardIssuerPort`; authorization and
  settlement simulation against the ledger.
- Card controls: limits, freeze/unfreeze, category and channel toggles, 3DS/SCA
  on sensitive card actions.

Phase 2 exit criteria: a user receives a SEPA credit, spends on a virtual card,
and sees correct ledger effects; an admin freezes a card and restricts an
account; four-eyes is enforced on high-risk admin actions.

## Open problems and watch-items

**Needs your hardware — I cannot do it.** Native passkeys have never been verified
on a physical device, and cannot be against `localhost`: no platform makes the
secure-context exception browsers do. This is the single largest untested claim in
the codebase. `docs/mobile-passkeys.md` now carries a **nine-step device
verification checklist** with pass criteria for each step. Note step 8 — the SCA
step-up is a *different* ceremony type from enrolment and sign-in, so passing
sign-in does not imply passing it; if only one thing gets tested, test that.

**Deliberately deferred to Phase 7:**

- `@nestjs/core` has an open moderate advisory patched only in `>= 11.1.18`, a
  Nest 10→11 major. `apps/api` is on `^10.4.0`. Below the gate threshold.
- The `brace-expansion` patch (`patches/brace-expansion@5.0.9.patch`), which
  retires with the React Native major — see Slice 9 above.
- **[PR #26](https://github.com/LorenzoCianfe/fides/pull/26) stays open on
  purpose**, as the reminder that the RN and Expo SDK move is owed. **Do not merge
  it as it stands:** it groups harmless `react`/`react-dom`/`openapi3-ts` bumps
  with `react-native` `^0.79.0` → `^0.86.2`, which breaks mobile bundling — Expo 53
  is paired with RN 0.79, and RN 0.86 pulls a Metro whose `exports` map no longer
  provides `./src/lib/TerminalReporter`, which the Expo 53 CLI requires.

**Accepted limitations, recorded rather than solved:**

- TOTP encryption defends a database read, not a host that also holds the process
  environment.
- Per-account lockout is inherently a denial-of-service vector against a named
  operator. Bounded by the short window.
- Denied attempts against *unknown* addresses leave no audit trail, because the
  address is PII and there is no admin to reference.
- The transfer route's recipient-existence oracle, superseded by `@tag` handles.
- Throttle counters are in-memory, per-instance, and reset on restart.

**Still to do:** `apps/admin` is an empty shell; the E2E covers only the happy
path; no accessibility pass has been run on either client.

## Environment — read this before running anything

- **`pnpm` is not on the tool shell's PATH.** It lives at `%APPDATA%\npm\pnpm.cmd`.
  Prefix every call: `$env:PATH = "$env:APPDATA\npm;$env:PATH"; pnpm ...`
- **Use the PowerShell tool for pnpm and for git commits.** The Bash tool cannot
  see pnpm at all, and the husky pre-commit hook runs `pnpm exec lint-staged`, so
  committing from Bash fails with `pnpm: command not found`.
- **`gh` is not on PATH either** — it is at `C:\Program Files\GitHub CLI\gh.exe`.
  Prefix similarly.
- Turbo root scripts work (`pnpm lint`, `typecheck`, `test`, `build`).
- **`pnpm test` and the E2E suite need Docker Desktop running**
  (`C:\Program Files\Docker\Docker\Docker Desktop.exe`, ~1 minute to be ready).
- **`ENCRYPTION_KEYS` is now required** — the API will not boot without it. Tests
  get it from `apps/api/test/setup-env.ts` (wired into vitest `setupFiles`); the
  E2E harness sets it in `apps/e2e/src/harness/stack.ts`; `.env.example` documents
  the format and how to generate a key. Any *new* place that boots the API needs
  it too.
- Long commit messages: write to a scratchpad file, then `git commit -F <file>`.
- `pnpm patch` / `pnpm patch-commit` must be run **from the Bash tool** —
  `patch-commit` rejected the path when invoked from PowerShell.

## Conventions that are not obvious from the code

- **DI and validation:** the vitest esbuild transform emits no decorator metadata,
  so every Nest-instantiated class needs explicit `@Inject(Token)` constructor
  parameters and every `@Body`/`@Param` needs an explicit
  `new ZodValidationPipe(Dto)`. Type-only injection silently yields `undefined`
  in tests.
- `apps/api` consumes `@fides/contracts` from its **built `dist`** — run
  `pnpm --filter @fides/contracts build` after editing contracts, before
  typechecking the API.
- **`resetDb` in `apps/api/test/db.ts` must list every table.** Adding a table
  without adding it there leaves state bleeding between tests. (Migration `0012`
  added columns, not tables, so the list is unchanged.)
- **`approve` on a pending admin action deliberately performs no pre-flight status
  check.** An earlier version did, and it rejected a checker's retry carrying the
  original `Idempotency-Key` with a 400 — exactly the case idempotency exists for.
  The authoritative checks run once, under `FOR UPDATE`, inside the posting
  transaction, which an idempotent replay never enters.
- **Audit overrides are keyed on the advisory's vulnerable range**
  (`"postcss@<8.5.18": ">=8.5.18"`), never a bare package name.
- **Money never passes through `Number`** anywhere. Minor units are bigint-safe
  strings because balances can exceed `MAX_SAFE_INTEGER`.
- A malformed stored hash or an unreadable encryption envelope **raises** rather
  than reading as a failed credential — it is a data-integrity fault, not a wrong
  password.

## Traps found the hard way

**From this session:**

- **Pinned-forward overrides drift.** `GHSA-5p4m-2wfm-xmqj` was published against
  `js-yaml >=4.0.0 <4.3.1`, so ADR-0026's `>=4.3.0` pin became vulnerable *in
  place* and turned the gate red on `main`. Both forced lines (`brace-expansion`,
  `js-yaml`) have now drifted once each. **When the audit gate goes red, re-check
  the existing overrides before hunting for a new culprit.** The range-scoped key
  is what makes this legible: `4.3.0` simply stopped matching, so the finding read
  as "an override needs moving" rather than "a new package is vulnerable".
- **`pnpm --filter @fides/e2e test` exits 0 having run nothing** — that package has
  no `test` script (it is `e2e`, deliberately, so `pnpm test` stays fast). A
  silent green. The real sequence is `run build:stack` then `run e2e`.
- **`pnpm build` reports `FULL TURBO` after a dependency change.** A cached build
  proves nothing about a lockfile change; use `pnpm build --force` to verify one.
- `security.md`'s version header had drifted out of step with its own changelog
  table (header said 0.7.0 while a 0.7.1 row existed). Bump both.
- Two files claimed ADR number 0027 — one was an orphaned addendum fragment, now
  folded in. Check `docs/adr/README.md` stays in step when adding an ADR.
- A field with **no default** in the env schema breaks any test that calls
  `loadEnv()` with a literal object rather than `process.env` — that is how
  `health.service.test.ts` works, and it needed the key added explicitly.

**From Slice 8, still relevant:**

- **Supertest cannot validate cookie *scoping*.** It sends whatever `Cookie` header
  a test constructs and models no path matching. This is how a real bug shipped:
  the CSRF cookie was scoped to `/v1`, unreadable by a web client served from `/`,
  so every state-changing request in cookie mode returned 403. Only the
  browser-driven E2E caught it. **Assert cookie paths explicitly.**
- **`transaction_history` is an asynchronous projection** from
  `ledger.entry.posted` via the outbox, while balances are maintained
  synchronously inside the posting transaction (ADR-0019). Any assertion about a
  statement row must poll; any assertion about a balance need not.
- **Playwright specifics:** its config cannot transitively import `testcontainers`
  (which reaches CommonJS-only `@grpc/grpc-js` and breaks the config load); the
  e2e package must **not** be `"type": "module"` for the same reason; workers do
  not share module state with `globalSetup`, so state travels by environment
  variable; and on Windows a shell-spawned server survives `child.kill()` and
  holds its port.
- **`NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are inlined at build time** and also feed
  the web CSP, which is why the E2E has its own `build:stack`.
- **Metro under pnpm needs hierarchical lookup ON.** The common advice to set
  `disableHierarchicalLookup` targets npm and yarn, where everything is hoisted
  flat; pnpm keeps a package's dependencies as siblings inside its own directory.
- **A green pipeline is only as wide as its jobs.** `apps/mobile` had no `build`
  script, so `pnpm build` skipped it, and a dependency bump that made the app
  impossible to bundle passed all six checks. `expo export` now runs as that
  package's `build`. **When adding a new app or package, check that something in
  CI actually executes it** — lint and typecheck passing is not the same as the
  thing working.

## How to work

- Discovery first: read before proposing, and propose before building.
- One feature branch per slice, conventional commits, one PR to `main`.
- An ADR per substantive decision, in `docs/adr/`. Next free number is **0030**.
- Keep `documentation.md`, `roadmap.md`, `design.md`, `security.md`, the
  `CHANGELOG`, `docs/adr/README.md`, and `docs/phase-1-handoff.md` current as you
  go.
- **I merge, you don't** — open the PR, watch CI, fix whatever turns red, and
  report. Do not merge unless I say so for that specific PR.
- Verify before claiming: run lint, typecheck, tests, build, the audit gate, and
  the E2E, and say what actually ran. Do not report work as done on the strength
  of a typecheck alone — Slice 8 produced two defects that only a real browser
  found, and this session produced one silent green (an e2e script that does not
  exist) and one red gate that only appeared after a rebase.
