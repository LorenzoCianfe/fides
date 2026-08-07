# ADR-0027: Client token transport, CSRF defence, security headers, and native app association

- Status: Accepted
- Date: 2026-07-29
- Deciders: Solo maintainer
- Refines: [ADR-0020](0020-session-tokens-webauthn-policy.md), [ADR-0021](0021-http-auth-surface-policy.md)

## Context

ADR-0021 shipped Phase 1 with body-only tokens and an `Authorization: Bearer` header, and deliberately deferred an httpOnly-cookie mode to Slice 8 — "when that client exists to exercise it". Slice 8 is that slice. Until now the accepted, documented gap has been that a browser holding a refresh token in script-reachable storage is exposed to XSS.

Three further things were outstanding and belong with this change. Security headers (helmet/HSTS) were listed as a known gap awaiting "the clients/TLS story". CORS was configured without credentials, which a cookie mode requires. And native mobile passkeys need the relying party to publish app-association documents over HTTPS, which nothing served.

The forces are in tension. The web client wants cookies, because that is the only way to put the refresh token beyond the reach of injected script. The mobile client cannot use them: a native app has no cookie jar tied to the WebAuthn origin, and the bearer contract is what `react-native-passkeys` and the existing HTTP suites speak. Both clients talk to one API instance, so this cannot be a deployment-wide switch. Meanwhile 219 existing tests and every Phase 1 route encode the bearer contract, and a change that rewrote them would be re-litigating a working design rather than extending it.

## Decision

**Transport is negotiated per request, by the client, and only affects responses that mint a session.** A client sends `X-Fides-Token-Transport: cookie` on the three routes that issue or rotate a session — passkey registration verify, authentication verify, and refresh. Anything else, including an absent or unrecognized header, is body transport and behaves exactly as before. This is the pivot the whole design turns on: a per-request opt-in means mobile and web share one API and one contract, no user agent is sniffed, and every pre-existing caller and test is byte-for-byte unaffected. A deployment-wide flag was rejected precisely because it cannot express "this client, this request".

**Cookie mode withholds the tokens from the body entirely.** The response carries session metadata (`sessionId`, deadlines) but omits `accessToken` and `refreshToken`, which are now `.optional()` in the contract. Setting cookies *and* echoing the tokens would hand them straight back to script and buy nothing; the omission is the security property. The pair is `httpOnly` and `SameSite=Strict`, with `Secure` and `SameSite` driven by config. The access cookie is scoped to `/v1`; **the refresh cookie is scoped to `/v1/auth/refresh`**, so the longest-lived credential is simply absent from ordinary API traffic.

**CSRF defence is a double-submit token bound to the session row.** A cookie travels ambiently, so a state-changing request needs separate proof that the caller's own script issued it. On issuing cookies the API mints a random `fcs_` token, stores its SHA-256 on the session (migration `0011`), and returns it in a deliberately *non*-`httpOnly` cookie; the client echoes it in `X-CSRF-Token`, and the guard compares hashes in constant time. Storing a hash rather than deriving an HMAC keeps this consistent with how every other secret in the system is held (ADR-0020), introduces no new server-side signing key to configure or rotate, and revokes the CSRF token with its session by construction. **Bearer callers are exempt**, because a header that must be set explicitly is not an ambient credential and carries the same proof intrinsically. A session issued in bearer mode has no stored hash and therefore *cannot* be driven from a cookie at all: the check fails closed rather than opting out.

**Refresh enforces CSRF inside its own transaction, not in the guard.** Refresh deliberately sits outside `SessionAuthGuard` — it runs precisely when the access token has expired — yet it is state-changing and, in cookie mode, cookie-driven. Left alone it would be the one CSRF hole in the design, letting a cross-site page churn a victim's token pair and strand the real client on a superseded token. The check therefore runs inside the rotation transaction, against the row already held `FOR UPDATE`, ordered *after* reuse detection (so a stolen token still trips the alarm) and *before* any rotation. `SameSite=Strict` already prevents this in the default configuration; the check is what makes a `SameSite=None` deployment safe.

**The guard prefers the header and never falls through.** `Authorization: Bearer` is tried first and wins whenever present; only its absence falls back to the access cookie. A *malformed* bearer is rejected outright rather than silently retried as a cookie — presenting a credential badly is an error, not an invitation to try another one.

**Security headers via helmet, with one deliberate split.** HSTS is emitted unconditionally at two years with `includeSubDomains` and `preload` (browsers ignore it over plain HTTP, so it costs nothing locally and is correct the moment TLS terminates). The JSON API gets the tightest possible content policy — `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'` — because it genuinely needs to load nothing. Swagger UI at `/docs` ships inline scripts and styles, so it gets a relaxed policy **scoped to that path alone** rather than loosening the policy that covers the money-moving surface. `Cross-Origin-Resource-Policy` is set to `cross-origin` because CORS, not CORP, is the control that actually governs a cross-origin JSON API; leaving it at `same-origin` would block legitimate reads without adding protection. CORS gains `credentials: true` and an explicit allowlist of request headers.

**The API serves its own app-association documents.** `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are generated from configuration and excluded from the `/v1` prefix (their paths are fixed by Apple and Google and cannot be versioned). Serving them from the API rather than from static hosting means the association automatically follows whichever origin fronts it — the production domain, or a developer's HTTPS tunnel — with no second deployment to keep in step. **This is what makes native passkeys both shippable and locally testable**: point a tunnel at the API, set `WEBAUTHN_RP_ID` to that host, and a physical device can complete the real ceremony. Unset configuration yields 404 rather than an empty document, because an association listing no apps fails silently and undiagnosably on device.

## Consequences

Positive:

- The ADR-0021 XSS gap is closed for the web client: injected script cannot read a token that is `httpOnly`, and cannot mint a state-changing request without a CSRF token it also cannot read from the token cookies.
- Mobile is untouched. One API, one contract, two transports, no user-agent sniffing, and every pre-existing test still passes unmodified — which is the evidence that the negotiation is genuinely additive.
- Native passkeys have a real, documented path to working on device and in production, using the same mechanism for both.
- The security-headers and CORS gaps recorded in the handoff are closed, and the strict API content policy is the correct one rather than a compromise.

Trade-offs / negative:

- **`SameSite=Strict` requires the web client and API to be same-site.** Different ports or subdomains are fine; different registrable domains are not, and such a deployment must move to `SameSite=None` — which is exactly why the CSRF token is not optional. Config validation rejects `none` without `Secure`, since browsers silently drop that pair.
- Two transports mean two paths to keep correct. The mitigation is that the second path is narrow (three routes plus the guard) and directly tested, but it is more surface than one.
- The CSRF token costs one extra `UPDATE` per cookie-mode session issue. Only cookie mode pays it; bearer sessions write nothing.
- `accessToken` and `refreshToken` became optional in the contract, so a body-mode consumer no longer gets a type-level guarantee they are present. Documented on the schema; the alternative (two response types) pushed the split into every consumer.
- Serving association documents from the API couples passkey configuration to API deployment. That is the point — it is what keeps them in step — but it does mean a static-hosting deployment of those files is no longer the path.

## Alternatives considered

- **A deployment-wide cookie switch** — rejected: web and mobile share one API instance, so a global flag cannot express "cookies for this client, bearer for that one" and would force one transport on both.
- **Sniffing the user agent** — rejected: unreliable, invisible to the caller, and it would have silently changed the behaviour of the existing HTTP suites.
- **Setting cookies *in addition to* returning body tokens** — rejected: it leaves the token in script-reachable storage, which is the exact exposure the mode exists to remove.
- **An HMAC-derived CSRF token** (`HMAC(secret, sessionId)`) — rejected: stateless and cheaper, but it introduces a server-side signing secret that must be configured, rotated, and shared across instances, and it does not die with the session. A hashed random token reuses the pattern already established for every other secret.
- **Relying on `SameSite=Strict` alone for CSRF** — rejected as the only defence: strong in the default configuration, but it silently becomes no defence at all under `SameSite=None`, and defence in depth is cheap here.
- **Putting the refresh CSRF check in a guard** — rejected: refresh runs on an expired access token and so cannot sit behind `SessionAuthGuard`. Checking inside the rotation transaction is both correct and free, since the row is already locked.
- **A single relaxed CSP covering `/docs` and the API** — rejected: it would grant the money-moving surface `unsafe-inline` to accommodate a documentation page.
- **Static hosting for the association documents** — rejected: a second thing to deploy and keep in step with `WEBAUTHN_RP_ID`, and it would not follow a developer's tunnel.

## Addendum — 2026-08-06: the CSRF cookie is site-wide, not `/v1`

As first implemented, all three cookies were path-scoped to the API: the access
cookie and the CSRF cookie to `/v1`, the refresh cookie to `/v1/auth/refresh`.
That is right for the two credentials and **wrong for the CSRF token**, which is
now set on `Path=/`.

`document.cookie` exposes only cookies whose path is a prefix of the *document's*
path. The web client is served from `/en/dashboard`, `/en/send`, and so on —
never from `/v1` — so the deliberately readable half of the double-submit pair
was unreadable by the only code that has to echo it. Every state-changing
request in cookie mode therefore failed with `403 FORBIDDEN`, including logout
and the SCA step-up that gates a transfer.

Widening the path costs nothing this ADR was protecting. The CSRF token carries
no authority on its own: presenting it without the httpOnly access cookie proves
nothing, and it is a random value whose hash is bound to a single session row.
The scoping that matters — keeping the refresh token out of ordinary API traffic
— is unchanged.

**What this says about the original verification.** The API integration suite
asserted the CSRF cookie was *readable* (`not.toContain('HttpOnly')`) but never
asserted its *path*, so it passed on a cookie no browser would hand to the
client. Supertest sends whatever `Cookie` header the test constructs; it has no
notion of path scoping, so no test built on it could have caught this. The bug
needed a real browser, and it was found the first time one drove the flow —
which is the argument for the end-to-end suite in a sentence. The path is now
asserted on both the set and the clear.
