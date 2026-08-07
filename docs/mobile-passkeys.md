# Mobile passkeys — running the app online and locally

Native passkeys are bound to a **domain**, not to a server. A platform
authenticator releases a credential scoped to a relying-party id only when the
app proves it owns that domain, and it checks that by fetching an association
document over **HTTPS from the relying-party id itself**. Three things therefore
have to agree, and this document is about keeping them in step:

| Thing | Set by | Must equal |
|---|---|---|
| The relying-party id the server signs challenges for | `WEBAUTHN_RP_ID` (API) | the public hostname |
| The domain the app is entitled to | `EXPO_PUBLIC_RP_ID` (build time) | the same hostname |
| The app the domain vouches for | `IOS_APP_ID` / `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_FINGERPRINTS` (API) | the built app's identifiers |

The API serves the association documents itself (ADR-0027), which is what makes
this workable in both environments — the association automatically follows
whichever HTTPS origin fronts the API, with no separate static hosting to
deploy and keep synchronized:

- `GET /.well-known/apple-app-site-association`
- `GET /.well-known/assetlinks.json`

Both return **404 when unconfigured**, deliberately: an association document
listing no apps produces a silent, undiagnosable failure on device, whereas a
404 is immediately visible.

## Why `localhost` cannot work

Browsers make a special exception for `http://localhost`, treating it as a
secure context so **web** passkeys work locally with `WEBAUTHN_RP_ID=localhost`.
Native platforms make no such exception: iOS and Android both require a real
HTTPS domain that serves the association document. There is no simulator flag
or entitlement that bypasses this.

So the local setup below is not a workaround for a missing feature — it is the
same mechanism production uses, pointed at a development hostname.

## Online (production or staging)

1. Point the API's environment at the public hostname:

   ```
   WEBAUTHN_RP_ID=app.example.com
   WEBAUTHN_ORIGINS=https://app.example.com
   IOS_APP_ID=ABCDE12345.com.example.fides
   ANDROID_PACKAGE_NAME=com.example.fides
   ANDROID_CERT_FINGERPRINTS=AA:BB:...,11:22:...
   ```

   `IOS_APP_ID` is `<TeamID>.<BundleIdentifier>`. The Android fingerprints are
   the SHA-256 of the **signing** certificates — list both the upload key and
   the Play-managed key, or passkeys break the moment Play re-signs the build.

2. Build the app against the same hostname:

   ```bash
   EXPO_PUBLIC_API_URL=https://app.example.com EXPO_PUBLIC_RP_ID=app.example.com IOS_BUNDLE_ID=com.example.fides ANDROID_PACKAGE=com.example.fides npx expo prebuild --clean
   ```

3. Verify the association documents are reachable **before** installing:

   ```bash
   curl -sS https://app.example.com/.well-known/apple-app-site-association
   ```

   A 404 here means the API's `IOS_APP_ID` is unset. Apple caches these
   documents, so fix it before the first install rather than after.

## Locally

The local path needs a stable HTTPS hostname in front of the local API. A
**named** tunnel is what makes it stable: the associated domain is compiled into
the app, so a hostname that changes on every run means rebuilding on every run.

1. Start the API and expose it on a named tunnel (`cloudflared` is one option;
   any tunnel with a fixed hostname works):

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

2. Point the API at that hostname and restart it:

   ```
   WEBAUTHN_RP_ID=fides-dev.example.com
   WEBAUTHN_ORIGINS=https://fides-dev.example.com
   IOS_APP_ID=ABCDE12345.com.fides.app
   ANDROID_PACKAGE_NAME=com.fides.app
   ANDROID_CERT_FINGERPRINTS=<your debug keystore SHA-256>
   ```

   The debug keystore fingerprint comes from:

   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

3. Build a **development build** against the same hostname. Expo Go cannot do
   this: passkeys need a native module, and Expo Go ships a fixed set.

   ```bash
   EXPO_PUBLIC_API_URL=https://fides-dev.example.com EXPO_PUBLIC_RP_ID=fides-dev.example.com npx expo run:ios
   ```

The app reports this failure rather than leaving it to be guessed at: when the
native module is missing it says a development build is required, and shows the
domain the bundle was built against, so a mismatch between the app and the API
is visible on the device itself.

## Device verification checklist

This is the one claim in the codebase that CI cannot reach: the on-device
ceremony has **never been run on physical hardware**. Document shape, routing,
and configuration are covered by tests; the ceremony itself is not, and cannot
be from a runner. What follows is the sequence to close that, in order, with
what "passed" looks like at each step so a partial result is still useful.

**Before starting.** Since ADR-0028 the API refuses to boot without
`ENCRYPTION_KEYS`. Set it alongside the variables above, or the first symptom
will be a server that never starts rather than anything to do with passkeys:

```bash
node -e "console.log('dev:' + require('crypto').randomBytes(32).toString('base64'))"
```

| # | Step | Passed when |
|---|---|---|
| 1 | Start the API with `ENCRYPTION_KEYS` set and a named tunnel in front of it | `curl https://<host>/v1/health` returns `ok` over HTTPS |
| 2 | Set `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`, and the app identifiers; restart | `curl https://<host>/.well-known/apple-app-site-association` returns JSON, not 404 |
| 3 | Same for Android | `curl https://<host>/.well-known/assetlinks.json` lists the fingerprint of the certificate that will actually sign the build |
| 4 | Build a **development build** against the same hostname (`expo run:ios` / `run:android`) | The app launches and its sign-in screen reports the domain it was built against |
| 5 | Register a new account and verify the email | The verification code arrives in the API log (console adapter) and is accepted |
| 6 | **Enrol a passkey** | The platform sheet opens, biometry succeeds, and the server accepts the attestation — this is the first thing CI has never proven |
| 7 | Sign out, then **sign in with the passkey** | The assertion is accepted and a session is issued |
| 8 | Have an admin fund the account, then **send a transfer** | The SCA step-up sheet opens as a *second* ceremony, and the transfer posts |
| 9 | Check the balance and statement on both sides | Balances moved; the statement row appears (it is an async projection, so allow a moment) |

Step 8 is the one worth being deliberate about: it is a different ceremony type
(`sca`, action-hashed and dynamically linked) from step 6/7, so passing 7 does
not imply passing 8. If only one thing can be tested, test 8.

**Record the outcome** in `security.md` and in the handoff's gap register either
way. A failure that is written down is more valuable than an untested claim, and
the troubleshooting table below maps most failures to a specific cause.

## What still works without any of this

Everything that is not a passkey ceremony. Running against a local API over
plain HTTP —

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start
```

— exercises registration, email verification, the account and balance reads,
transaction history, navigation, i18n, and money formatting. Only enrolment,
sign-in, and the SCA step-up need the tunnel, because only those three run a
ceremony.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Passkeys need a development build" | Running in Expo Go. Use `expo run:ios` / `run:android`. |
| Sheet opens then fails immediately (iOS) | `EXPO_PUBLIC_RP_ID` at build time did not match `WEBAUTHN_RP_ID`, or the AASA is 404/not JSON. Apple caches it — reinstall after fixing. |
| "No credentials available" (Android) | `assetlinks.json` does not list the fingerprint of the certificate that actually signed the installed build. |
| Ceremony succeeds, server rejects it | `WEBAUTHN_ORIGINS` does not include the tunnel origin. |
