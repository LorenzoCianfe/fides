import { InternalError, ValidationError } from '@fides/domain';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for the one class of secret that cannot be hashed
 * (ADR-0028). Every other secret in Fides is stored as a SHA-256 or scrypt
 * digest, because nothing ever needs the original back. TOTP verification is
 * the exception: RFC 6238 recomputes codes from the shared secret, so the
 * secret itself must survive at rest.
 *
 * The shape is deliberately the envelope-encryption seam `security.md` §6.2
 * commits to, not a bespoke helper: a keyring of data keys addressed by id, a
 * self-describing ciphertext that names the key that made it, and a port
 * (`ENCRYPTION`) that a real KMS adapter can implement without touching a
 * caller. That is the same mock-adapter-behind-a-port pattern ADR-0001 uses for
 * `KycPort` and `PaymentRailPort`.
 */

/** AES-256-GCM: 32-byte key, 96-bit nonce (the GCM-preferred size), 128-bit tag. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const SCHEME = 'fenc';
const VERSION = 'v1';

/** Envelope field count: `fenc$v1$keyId$iv$tag$ciphertext`. */
const ENVELOPE_PARTS = 6;

/**
 * Encrypts and decrypts a single field value.
 *
 * `context` is authenticated but not encrypted (GCM additional authenticated
 * data). It binds a ciphertext to the row and column it belongs to, so an
 * attacker holding database *write* access cannot promote themselves by copying
 * one admin's encrypted TOTP secret onto another's row: the tag check fails
 * because the context no longer matches. Encryption alone would not stop that —
 * the copied ciphertext would decrypt perfectly well.
 */
export interface EncryptionPort {
  encrypt(plaintext: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}

/**
 * A named set of data keys. More than one exists only so a key can be rotated:
 * the primary encrypts, and any key still in the ring can decrypt, so old
 * ciphertexts keep working while new writes move to the new key. Because each
 * envelope names its own key id, rotation needs no migration and no downtime —
 * the same reasoning that makes `password.ts` store its scrypt parameters
 * inline.
 */
export interface Keyring {
  /** Key id used for new ciphertexts. Must be present in `keys`. */
  readonly primaryKeyId: string;
  /** All usable keys by id, each exactly 32 bytes. */
  readonly keys: ReadonlyMap<string, Buffer>;
}

/**
 * Parse `keyId:base64Key` pairs into a keyring. The first pair is the primary.
 *
 * Rejecting a wrong-sized key here rather than at first use is deliberate: a
 * truncated key in configuration would otherwise boot cleanly and fail only
 * when the first admin tried to sign in.
 */
export function parseKeyring(spec: string): Keyring {
  const keys = new Map<string, Buffer>();
  let primaryKeyId: string | undefined;

  for (const entry of spec.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      throw new ValidationError('Each encryption key must be given as `keyId:base64Key`');
    }
    const keyId = trimmed.slice(0, separator).trim();
    const material = Buffer.from(trimmed.slice(separator + 1).trim(), 'base64');
    if (material.length !== KEY_BYTES) {
      throw new ValidationError(
        `Encryption key "${keyId}" must decode to ${KEY_BYTES} bytes, got ${material.length}`,
      );
    }
    if (keys.has(keyId)) {
      throw new ValidationError(`Encryption key id "${keyId}" is declared more than once`);
    }
    keys.set(keyId, material);
    primaryKeyId ??= keyId;
  }

  if (!primaryKeyId) throw new ValidationError('At least one encryption key must be configured');
  return { primaryKeyId, keys };
}

/** Generate a fresh 32-byte key as base64, for `.env` and key rotation. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/** True when `value` is one of our envelopes rather than a legacy plaintext. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${SCHEME}$${VERSION}$`);
}

/** AES-256-GCM over a local keyring. The KMS-backed adapter replaces only this. */
export class KeyringEncryption implements EncryptionPort {
  constructor(private readonly keyring: Keyring) {}

  encrypt(plaintext: string, context: string): string {
    const keyId = this.keyring.primaryKeyId;
    const key = this.keyring.keys.get(keyId);
    if (!key) throw new InternalError(`Primary encryption key "${keyId}" is missing`);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      SCHEME,
      VERSION,
      keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('$');
  }

  decrypt(envelope: string, context: string): string {
    const parts = envelope.split('$');
    if (parts.length !== ENVELOPE_PARTS || parts[0] !== SCHEME || parts[1] !== VERSION) {
      throw new InternalError('Malformed encryption envelope');
    }
    const [, , keyId, ivPart, tagPart, ciphertextPart] = parts;

    const key = this.keyring.keys.get(keyId!);
    // A ciphertext naming a key the ring no longer holds is a configuration
    // fault — a key was dropped while rows still referenced it — not corruption.
    if (!key) throw new InternalError(`No encryption key "${keyId}" is configured`);

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart!, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagPart!, 'base64url'));

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart!, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // GCM authentication failed: the ciphertext, the key, or the context is
      // not the one this envelope was sealed with. Never surface which.
      throw new InternalError('Encryption envelope failed authentication');
    }
  }
}

/** The AAD context binding a TOTP secret to the admin row that owns it. */
export function totpSecretContext(adminId: string): string {
  return `admins.totp_secret:${adminId}`;
}
