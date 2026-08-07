# ADR-0026: Dependency audit remediation — scoped transitive overrides and the brace-expansion patch

- Status: Accepted
- Date: 2026-07-29
- Deciders: Solo maintainer
- Refines: [ADR-0013](0013-ci-security-gates.md)

## Context

ADR-0013 makes `pnpm audit --prod --audit-level=high` a blocking CI gate. That gate was **red on `main`** at the start of Slice 8, reporting 34 advisories of which 15 were high. None of it was caused by Phase 1 code: `main` had not run CI since 2026-07-05, so roughly three weeks of newly-published advisories surfaced at once against packages that had been in the tree since Phase 0 — the `next`, `sharp`, `postcss`, `js-yaml`, and `brace-expansion` lines belonging to the web, admin, and mobile shells.

Three forces shaped the response. First, **Slice 8 is the slice that builds on exactly these packages**, so leaving the gate red would mean adding client surface on an ungated tree. Second, the standing decision that **framework majors are deferred to Phase 7** rules out the major bumps some advisories nominally want. Third, most of the affected packages are **transitive** — pinned by an intermediate dependency that has not itself released a fix — so a direct version bump cannot reach them.

Two claims recorded in `docs/phase-1-handoff.md` §8 turned out to be inaccurate and are corrected here: `postcss` had joined the advisory set (it was not in the original list), and the assertion that none of the advisories are reachable from `apps/api` does not hold for `js-yaml`, which arrives through `@nestjs/swagger@7.4.2`, a production dependency of the API.

## Decision

**Direct dependencies move within their pinned major.** `next` goes from 15.5.20 to `^15.5.22` in `apps/web` and `apps/admin`, closing three high advisories (a Server Actions denial of service and two server-side request forgeries). This is a patch-level move inside major 15 and therefore does not touch the Phase 7 framework-major deferral.

**Transitive advisories are closed with version-range-scoped `pnpm.overrides`, not by waiting on upstream.** Three lines are forced forward: `postcss` (pinned at `8.4.31` *exactly* by `next`, so nothing but an override reaches it), `sharp` (`next`'s optional dependency), and `js-yaml`. Each override key carries the advisory's own vulnerable range rather than a bare package name, so it upgrades exactly the affected line and nothing else. This matters concretely for `js-yaml`: the tree also contains `3.15.0` under `cosmiconfig`, and an unscoped override would have dragged it across the 3→4 boundary that removed `safeLoad`. The existing `multer` and `glob` overrides already established this style.

**`brace-expansion` is forced to `5.0.8` globally and patched to restore the callable default export.** This one advisory (`GHSA-mh99-v99m-4gvg`, an out-of-memory denial of service) declares its vulnerable range as `<=5.0.7`, which means **no version in the 1.x or 2.x lines can ever clear it** — including `2.1.3`, which actually *contains* the fix (it ships the `EXPANSION_MAX_LENGTH` bound and cites the CVE) but still matches the range and is still reported. The only clearing version is `5.0.8`, and `brace-expansion@4` had removed the callable default export: `5.0.8` exports `{ expand }`. The tree's four `minimatch` versions split across that break — `@3` and `@5` call the module itself, `@9` default-imports it in both its CommonJS and ESM entries, and only `@10` uses the named export — so forcing `5.0.8` alone breaks three of the four, which was confirmed by execution before the patch was written.

The patch therefore targets **`brace-expansion` rather than the three `minimatch` versions**: one patched package instead of three, and it restores precisely the API that was removed rather than rewriting consumers. The CommonJS entry re-exports the function as `module.exports` while keeping `expand`, `default`, and the two limit constants attached; the ESM entry adds a default export. Named-export consumers are untouched. Because pnpm 9 keys `patchedDependencies` by exact version, the override pins `5.0.8` exactly — a future `5.0.9` will fail the patch loudly rather than silently dropping the shim.

**Suppression is the last resort, and was not used here.** No new entry was added to `pnpm.auditConfig.ignoreGhsas`. The one pre-existing entry — `GHSA-r5fr-rjxr-66jc`, code injection via `lodash`'s `_.template`, reaching `apps/api` through `@nestjs/swagger` — stays, because its declared patch target (`lodash >= 4.18.0`) does not exist: there is nothing to upgrade to. It remains the single documented exception, and it is why the gate still tallies one high while exiting zero.

**Two advisories are knowingly left open, both below the gate threshold.** `@nestjs/core` (moderate) is patched only in `>= 11.1.18`, a Nest 10 → 11 major that belongs to Phase 7. The remaining moderates and the one low are transitive build-tooling findings with no reachable path from a shipped artifact.

## Consequences

Positive:

- The CI dependency-audit gate exits zero again, and Slice 8's client work lands on a gated tree rather than an ungated one.
- Every fix is a real version movement, not a suppression: the code that actually runs is the patched code, and `pnpm audit` remains a meaningful signal instead of a list of exceptions.
- The scoped-range override style is now established for three more lines, so a future advisory on an already-overridden package fails loudly (the range stops matching) instead of being silently absorbed.
- `js-yaml` reaching `apps/api` through `@nestjs/swagger` is documented rather than assumed away, so the next audit review starts from an accurate reachability map.

Trade-offs / negative:

- **A patched dependency is now maintenance debt.** The `brace-expansion` patch must be revisited whenever the package moves, and pnpm's exact-version key guarantees the failure is noisy. It can be dropped entirely once the Expo toolchain stops pulling `glob@7`/`rimraf@3` (the source of `minimatch@3`) — that is the exit condition.
- Forcing `brace-expansion` across three major boundaries means `minimatch@3` and `@5` now run expansion code they were never released against. The API is a single function with a stable contract and the behaviour was verified across all four `minimatch` versions, but this is a wider version jump than an override normally makes.
- Overriding a transitive pin diverges the tree from what the intermediate package declares and tests against — `next` pins `postcss` exactly, and it now resolves to a version `next` has not shipped with. Both Next builds were verified.
- The gate still reports one high in its summary tally (the ignored `lodash` advisory), so the headline number is not zero and reading the exit code — not the tally — remains necessary.

## Alternatives considered

- **Add `GHSA-mh99-v99m-4gvg` to `ignoreGhsas`** — the cheapest option, and defensible on reachability grounds (the affected paths enter only through Expo build tooling on a developer machine, ship in no bundle, and never see attacker-controlled glob patterns). Rejected in favour of actually shipping the fixed code: a suppression would also have masked the `minimatch@10` path, which *can* be fixed, and every suppression makes the gate a little less trustworthy.
- **Patch the three `minimatch` versions instead of `brace-expansion`** — rejected: three patch files instead of one, each rewriting a consumer's import to work around a change it did not make, and each needing revision independently.
- **Override `brace-expansion` per line (`@1` → 1.1.16, `@2` → 2.1.3)** — rejected: it clears the exponential-expansion advisory but not the out-of-memory one, whose range covers every version below 5.0.8, so the gate would have stayed red.
- **Raise the gate to `--audit-level=critical`** — rejected outright: it turns a real control into a formality and would have hidden all fifteen highs rather than fixing any.
- **Wait for upstream (`next`, Expo) to bump their pins** — rejected for this slice: the gate is blocking, the wait is unbounded, and Slice 8 is precisely the work that adds surface to these packages.
- **Take the Dependabot majors already open** (react-native 0.79 → 0.86, drizzle-kit 0.30 → 0.31) — rejected: they are deliberately deferred, and none of the high advisories required them.

## Addendum — 2026-08-06: pin moved to `5.0.9`

`GHSA-rgw5-rvv9-x895` was published against `brace-expansion >=4.0.0 <5.0.9`: a
second denial of service via unbounded intermediate arrays, bypassing the
mitigation this ADR relied on. The `5.0.8` pin above therefore became vulnerable
in place, on `main` as well as on the Slice 8 branch — the same advisory-drift
pattern that prompted this ADR, not a regression introduced by client work.

The decision is unchanged; only the version moved. The override and the
`patchedDependencies` key are now `5.0.9`, and the patch was regenerated because
the fix rewrote the expansion internals and the original hunks no longer applied.
**The noisy-failure design worked exactly as intended:** `pnpm install` refused
the stale patch rather than silently dropping the shim, which is what this ADR
argued for when it chose an exact-version pin. The shim itself is byte-identical
in effect — `5.0.9` exports the same `{ expand, EXPANSION_MAX,
EXPANSION_MAX_LENGTH }` shape and still omits the callable default — and brace
expansion was re-verified across all four `minimatch` versions in the tree
(`@3.1.5`, `@5.1.9`, `@9.0.9`, `@10.2.5`) plus the ESM default-export path.

## Addendum — 2026-08-06: the `lodash` suppression is retired; the patch exit condition was misattributed

Two corrections, both found by re-checking claims this ADR made rather than by
any change in the code.

**`lodash >= 4.18.0` now exists, so the sole suppression is gone.** The decision
above kept `GHSA-r5fr-rjxr-66jc` in `ignoreGhsas` because "its declared patch
target does not exist: there is nothing to upgrade to". That was true when
written and is no longer: `lodash@4.18.0` was published on 2026-03-31 and
`4.18.1` on 2026-04-01. The advisory is now closed the way this ADR prefers —
by moving the code that actually runs — with a range-scoped override
(`"lodash@<4.18.0": ">=4.18.0"`) in the established style, and
`pnpm.auditConfig` has been removed entirely.

The upgrade was verified before it was taken rather than after. `@nestjs/swagger`
imports the whole module but uses thirty ordinary utilities
(`assign`, `cloneDeep`, `merge`, `omitBy`, `pickBy`, `unionWith`, and so on) and
**never calls `_.template`**, which is the vulnerable function; all thirty are
still exported by `4.18.1`, and `_.template` itself survives, so the fix hardened
it rather than removing it. This mattered: the usual way to close a template
injection advisory is to delete the API, which would have broken any consumer
that used it, and "the patch target exists" is not on its own a reason to take
it.

The gate now reports **zero high-severity advisories** and still exits zero.
That removes the trap recorded in the trade-offs above — the headline count and
the exit status finally agree, and `pnpm audit` carries no exceptions at all.
The warning stands as a matter of policy for whatever is suppressed next, but
nothing is suppressed today. Closing the advisory also cleared two moderates
that entered on the same line, taking the total from fourteen findings to
eleven.

**The `brace-expansion` patch is waiting on React Native, not on Expo.** The
trade-off above names its exit condition as "the Expo toolchain stops pulling
`glob@7`/`rimraf@3`". Tracing the tree shows that is now the wrong target: every
`@expo/*` package resolves `glob@13`, and the whole of the `glob@7.2.3` and
`rimraf@3.0.2` surface enters through **`react-native@0.79.7`** — directly as
its own dependency, and again via `@react-native/codegen`,
`@react-native/community-cli-plugin` → `@react-native/dev-middleware` →
`chromium-edge-launcher` → `rimraf@3`, and `babel-jest` → `test-exclude@6`.
Those are what pin the `minimatch@3` the shim exists for.

The practical consequence is that the patch is not independently clearable. Its
exit condition is the React Native major, which is the Expo SDK move, which is
the same work as the open [PR #26](https://github.com/LorenzoCianfe/fides/pull/26)
and belongs to Phase 7. It should be retired as part of that move and not
attempted before it.

## Addendum — 2026-08-06: `js-yaml` override moved to `>=4.3.1`

`GHSA-5p4m-2wfm-xmqj` was published against `js-yaml >=4.0.0 <4.3.1` — quadratic
CPU consumption in `!!omap` resolution, the `CVE-2026-59870` fix not having been
backported. The override above forced `>=4.3.0`, so **`4.3.0` became vulnerable
in place**: the same advisory-drift pattern that moved the `brace-expansion` pin,
against the same line this ADR already forced once.

The decision is unchanged; only the range moved, to
`"js-yaml@>=4.0.0 <4.3.1": ">=4.3.1"`. `4.3.1` was already published and already
present in the tree for other consumers, so nothing had to wait on upstream.

**The range-scoping rule earned its keep here, and it is worth being precise
about why.** Had the override been keyed on the bare package name, forcing
`>=4.3.0` would have silently kept satisfying itself while the tree sat on a
version the advisory covered — the gate would have gone red with no indication
that an existing override was the thing now out of date. Because the key carries
the advisory's own vulnerable range, `4.3.0` simply stopped matching it, which
is what made the finding legible as "an override needs moving" rather than "a
new package is vulnerable".

It also confirms the standing hazard this ADR was written around: a pinned-forward
transitive is not fixed forever, it is fixed until the next advisory widens the
range past the pin. Both forced lines (`brace-expansion`, `js-yaml`) have now
drifted once each. Treat every entry in `overrides` as something to re-check
whenever the gate turns red, before looking for a new culprit. Note that the
sibling `js-yaml@3.15.1` in the tree is untouched, as intended — this advisory's
range does not reach it, and an unscoped override would have dragged it across
the 3→4 boundary that removed `safeLoad`.
