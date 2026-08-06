
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
