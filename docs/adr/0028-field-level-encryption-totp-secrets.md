# ADR-0028: Field-level encryption — a KMS-shaped keyring, applied first to admin TOTP secrets

- Status: Accepted
- Date: 2026-08-06
- Deciders: Solo maintainer
- Refines: [ADR-0025](0025-admin-rbac-mfa-four-eyes.md), [ADR-0010](0010-data-protection-pci-scope.md)

## Context

ADR-0025 shipped the back office with mandatory two-factor sign-in and recorded one accepted gap: **TOTP secrets are stored unencrypted**. Every other secret in Fides is held only as a digest — session tokens as SHA-256, passwords as scrypt — because nothing ever needs the original back. TOTP is the exception. RFC 6238 recomputes the expected code from the shared secret on every verification, so the secret itself has to survive at rest.

The consequence is sharper than "a secret is in plaintext". Anyone with a database read can mint valid second factors for every operator, indefinitely and undetectably. That does not merely weaken admin MFA; it removes it. The password remains scrypt-hashed, so the attacker still needs the first factor — but a control whose entire purpose is to be independent of the first factor is not independent if one database read produces it.

`security.md` §6.2 already commits to the destination: field-level encryption for sensitive values, under envelope encryption via a KMS abstraction, with keys managed and rotated rather than embedded. Nothing had implemented it, and the handoff named TOTP secrets as the first candidate when it landed. This is that.

Three forces shape the answer. The project is **local-first** (ADR-0012): there is no cloud KMS to call, and inventing a dependency on one would make the system unrunnable locally, which is the opposite of how every other external capability is handled here. The hexagonal rule (ADR-0001) says an external capability enters as a **port with a mock adapter**, never as a direct dependency — that is how `KycPort`, `PaymentRailPort`, and `NotificationPort` already work. And the blast radius is small enough to be tractable: exactly three production call sites touch the secret.

## Decision

**A port, a keyring adapter, and AES-256-GCM.** `EncryptionPort` (`encrypt(plaintext, context)` / `decrypt(envelope, context)`) is bound to the `ENCRYPTION` token and implemented by `KeyringEncryption`, which holds data keys in memory from configuration. A KMS-backed adapter implements the same two methods and replaces nothing else. This is the ADR-0001 pattern applied to cryptography rather than to a third-party service, and it is why the interface is deliberately two methods wide: anything larger would leak the local adapter's shape into the seam.

**Ciphertexts are self-describing and name their key.** The envelope is `fenc$v1$keyId$iv$tag$ciphertext`, mirroring the `scrypt$N$r$p$salt$hash` format ADR-0025 chose for passwords and for the same reason: **a value carries the parameters needed to read it, so parameters can change without a migration.** Rotation follows directly — put the new key first in `ENCRYPTION_KEYS` and keep the old one, and new writes seal under the new key while old rows keep reading. No migration, no downtime, no window where a key is half-rotated.

**The admin id is authenticated as additional data.** `context` is `admins.totp_secret:<adminId>`, passed as GCM AAD: authenticated, not encrypted. This defends a threat encryption alone does not. An attacker with database **write** access could otherwise copy a colleague's encrypted secret onto their own row and authenticate as themselves with the colleague's authenticator — the ciphertext would decrypt perfectly, because it is a valid ciphertext. Binding the row makes the tag check fail. It costs nothing and closes a real privilege-escalation path.

**`ENCRYPTION_KEYS` is required, with no default.** The API refuses to start without it. A default would be a key published in the repository, and the obvious alternative — fall back to plaintext when unset — is precisely the silent security downgrade tenet 6 of `security.md` forbids: a deployment would appear to have encryption and have none. Failing at boot follows the `DATABASE_URL` precedent, and a wrong-sized key is rejected at parse time rather than at the first sign-in, so a truncated key in configuration cannot boot cleanly and fail hours later.

**Reads tolerate plaintext; writes never produce it.** Rows written before this ADR hold bare base32, and the envelope prefix makes the two unambiguous. A legacy row is re-sealed **on its next successful verification** — the one path that has just proven the stored plaintext really is the secret. Re-sealing on read would also re-encrypt during failed attempts, and a SQL data migration was never available: the migrator cannot reach the keyring. The tolerance is removable once no plaintext rows remain, and that is its exit condition.

**A malformed or unreadable envelope raises rather than reading as a failed code.** A ciphertext naming a dropped key, or one that fails authentication, is a data-integrity or configuration fault, not a wrong password — exactly the judgement `password.ts` already makes for a malformed hash.

## Consequences

Positive:

- **Admin MFA becomes independent of the database again.** A database read no longer yields a usable second factor, which is the property the control was always claimed to have. The most serious open item in `security.md` is closed.
- The KMS seam `security.md` §6.2 promised now exists and has a real consumer, so the next sensitive field (identity documents, personal identifiers) inherits it rather than re-deciding it.
- Key rotation is available immediately and needs no migration, because every ciphertext names its key.
- Grafting a ciphertext between admin rows is defeated, closing a privilege-escalation path that encryption alone would have left open.
- Misconfiguration fails at boot, loudly, instead of degrading silently.

Trade-offs / negative:

- **This defends a database read, not a full host compromise.** An attacker who holds the process environment *and* the database holds the key and the ciphertext. That is the honest limit of any locally-held key, and moving it requires a KMS that never discloses key material — which is what the port is shaped for. It is worth being precise: the threat this closes is the one `security.md` actually named, and the residual is strictly smaller than what was there before.
- The keyring lives in configuration, so key handling is now an operational concern: losing every key in the ring makes enrolled second factors unreadable, and those admins must re-enrol. Dropping a key that rows still reference fails loudly rather than silently.
- The plaintext-tolerant read path is a permanent downgrade risk until removed. Mitigated by being read-only — nothing writes plaintext — and by an explicit exit condition, but it is real.
- One more required setting, which every deployment, the test run, and the end-to-end harness must provide. That is the intended cost of refusing a default.

## Alternatives considered

- **Keep the ADR-0025 gap open until a real KMS exists** — rejected. It is the most serious open item in the security model, the destination is already documented, and waiting on infrastructure that Phase 1 deliberately does not have would have deferred it indefinitely. The port means the KMS still drops in later.
- **Hash the TOTP secret like everything else** — impossible, and worth stating so it is not re-proposed: verification recomputes the code from the secret, so a one-way function leaves nothing to compute with.
- **Derive a per-row key with HKDF from a master secret** — rejected as motion without benefit here. It still ends at one locally-held root, and AAD already provides the per-row binding that per-row keys would have bought.
- **Encrypt the whole column with Postgres `pgcrypto`** — rejected: it puts key material in SQL statements and query logs, ties the scheme to the database engine, and gives the application no seam to swap for a KMS.
- **Encrypt at the disk or database level only** — rejected as not addressing the threat. Volume encryption defends a stolen disk; it does nothing about a read through a live connection, which is the case that matters.
- **A single `ENCRYPTION_KEY` rather than a keyring** — rejected: it makes rotation a migration, and a rotation that requires a migration is a rotation that does not happen.
- **Fall back to plaintext when the key is unset** — rejected, and the reason is the whole point of the ADR: it would let a deployment believe it had encryption while storing plaintext, which is worse than the documented gap it replaces.
