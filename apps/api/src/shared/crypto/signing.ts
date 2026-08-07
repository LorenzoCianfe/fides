import { InternalError, ValidationError } from '@fides/domain';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * Detached signatures over values that must stay verifiable *outside* the system
 * that produced them (ADR-0031). Its first consumer is the audit anchor: a
 * periodically published statement of the chain's head, which exists so that
 * truncating the trail is detectable by someone who no longer trusts the
 * database the trail lives in.
 *
 * **Why asymmetric rather than an HMAC.** An HMAC would be simpler and would
 * reuse the ADR-0028 keyring shape directly, but anyone able to verify an HMAC
 * is equally able to forge one — so every verifier must sit inside the trust
 * boundary of the signer. That defeats the purpose here. Ed25519 lets an
 * auditor, or an operator reading a log archive months later, confirm an anchor
 * while holding nothing that could mint a false one.
 *
 * The shape otherwise mirrors {@link ../crypto/encryption.EncryptionPort}: a
 * keyring addressed by id, a self-describing envelope naming the key that made
 * it, and a port a KMS or HSM adapter can implement without touching a caller
 * (ADR-0001). Signing is exactly the operation one would want in an HSM.
 */

const SCHEME = 'fsig';
const VERSION = 'v1';

/** Envelope field count: `fsig$v1$keyId$signature`. */
const ENVELOPE_PARTS = 4;

export interface SigningPort {
  /** Sign a canonical payload with the primary key; returns a self-describing envelope. */
  sign(payload: string): string;
  /**
   * True when `envelope` is a genuine signature over `payload`. A malformed
   * envelope or an unrecognised key id raises instead of returning false: those
   * are data-integrity faults, and reporting them as "not a valid signature"
   * would tell an operator their anchor was forged when it was merely written by
   * a key that has since left the ring.
   */
  verify(payload: string, envelope: string): boolean;
  /**
   * The SPKI public key, base64, for a key id (default: the primary). Published
   * so anchors can be verified off-host, by someone holding no signing material.
   */
  publicKey(keyId?: string): string;
  /** The key id new signatures will name. */
  readonly primaryKeyId: string;
}

/**
 * A named set of signing keys. More than one exists only so a key can be
 * rotated: the primary signs, and every key in the ring still verifies, so
 * anchors published under an old key stay checkable. Each envelope names its own
 * key id, so rotation is configuration rather than a migration — the same
 * reasoning behind the ADR-0028 ciphertext envelope and the scrypt hash format.
 */
export interface SigningKeyring {
  readonly primaryKeyId: string;
  readonly keys: ReadonlyMap<string, KeyObject>;
}

/**
 * Parse `keyId:base64Pkcs8` pairs into a signing keyring. The first pair is the
 * primary.
 *
 * PKCS8 rather than a bare 32-byte seed because it is what `node:crypto` accepts
 * without hand-assembling DER, and what every other tool will hand you when you
 * ask it for an Ed25519 private key. Rejecting a malformed or non-Ed25519 key
 * here rather than at first use is deliberate: a bad key in configuration would
 * otherwise boot cleanly and fail only at the first anchor, hours later, in a
 * background pass whose failure is logged rather than surfaced.
 */
export function parseSigningKeyring(spec: string): SigningKeyring {
  const keys = new Map<string, KeyObject>();
  let primaryKeyId: string | undefined;

  for (const entry of spec.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      throw new ValidationError('Each signing key must be given as `keyId:base64Pkcs8`');
    }
    const keyId = trimmed.slice(0, separator).trim();
    if (keys.has(keyId)) {
      throw new ValidationError(`Signing key id "${keyId}" is declared more than once`);
    }

    let key: KeyObject;
    try {
      key = createPrivateKey({
        key: Buffer.from(trimmed.slice(separator + 1).trim(), 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } catch {
      throw new ValidationError(`Signing key "${keyId}" is not a valid base64 PKCS8 private key`);
    }
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new ValidationError(
        `Signing key "${keyId}" must be Ed25519, got ${key.asymmetricKeyType ?? 'unknown'}`,
      );
    }

    keys.set(keyId, key);
    primaryKeyId ??= keyId;
  }

  if (!primaryKeyId) throw new ValidationError('At least one signing key must be configured');
  return { primaryKeyId, keys };
}

/** Generate a fresh Ed25519 private key as base64 PKCS8, for `.env` and rotation. */
export function generateSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

/** Ed25519 over a local keyring. A KMS- or HSM-backed adapter replaces only this. */
export class Ed25519Signing implements SigningPort {
  /** Public keys are derived once; deriving per verification is pure waste. */
  private readonly publicKeys = new Map<string, KeyObject>();

  constructor(private readonly keyring: SigningKeyring) {
    for (const [keyId, key] of keyring.keys) {
      this.publicKeys.set(keyId, createPublicKey(key));
    }
  }

  get primaryKeyId(): string {
    return this.keyring.primaryKeyId;
  }

  sign(payload: string): string {
    const keyId = this.keyring.primaryKeyId;
    const key = this.keyring.keys.get(keyId);
    if (!key) throw new InternalError(`Primary signing key "${keyId}" is missing`);

    // Ed25519 takes no digest algorithm: it hashes internally (RFC 8032).
    const signature = cryptoSign(null, Buffer.from(payload, 'utf8'), key);
    return [SCHEME, VERSION, keyId, signature.toString('base64url')].join('$');
  }

  verify(payload: string, envelope: string): boolean {
    const parts = envelope.split('$');
    if (parts.length !== ENVELOPE_PARTS || parts[0] !== SCHEME || parts[1] !== VERSION) {
      throw new ValidationError('Malformed signature envelope');
    }
    const [, , keyId, signaturePart] = parts;

    const publicKey = this.publicKeys.get(keyId!);
    // Not a forgery — a key that has left the ring. Saying "invalid signature"
    // would send an operator hunting for tampering that never happened.
    if (!publicKey) throw new ValidationError(`No signing key "${keyId}" is configured`);

    try {
      return cryptoVerify(
        null,
        Buffer.from(payload, 'utf8'),
        publicKey,
        Buffer.from(signaturePart!, 'base64url'),
      );
    } catch {
      // A structurally impossible signature (wrong length, unparseable) is a
      // failed verification rather than a fault: it is exactly what a forgery
      // attempt looks like.
      return false;
    }
  }

  publicKey(keyId: string = this.keyring.primaryKeyId): string {
    const key = this.publicKeys.get(keyId);
    if (!key) throw new ValidationError(`No signing key "${keyId}" is configured`);
    return key.export({ format: 'der', type: 'spki' }).toString('base64');
  }
}
