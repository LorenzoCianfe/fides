import { ValidationError } from '@fides/domain';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 4648 §6 base32 alphabet (no padding on output; tolerated on input). */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface TotpConfig {
  readonly algorithm: TotpAlgorithm;
  readonly digits: number;
  readonly stepSeconds: number;
  /** Steps of clock skew accepted on either side of the current one. */
  readonly window: number;
}

/**
 * Authenticator-app defaults (RFC 6238 §4): HMAC-SHA1, 6 digits, a 30-second
 * step, and one step of skew either way. SHA-1 here is a MAC over a counter,
 * not a collision-resistant digest, and is what every authenticator implements.
 */
export const DEFAULT_TOTP_CONFIG: TotpConfig = {
  algorithm: 'sha1',
  digits: 6,
  stepSeconds: 30,
  window: 1,
};

/** Encode bytes as unpadded base32 (RFC 4648). */
export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decode base32, tolerating padding, whitespace, and lower case. */
export function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new ValidationError('Malformed base32 secret');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh base32 TOTP secret; 20 bytes is the RFC 4226 §4 recommendation. */
export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

/**
 * HOTP (RFC 4226 §5.3): HMAC the 8-byte big-endian counter, take the dynamic
 * truncation of the digest, and render it as `digits` decimal characters.
 */
export function hotp(
  secret: Buffer,
  counter: number,
  algorithm: TotpAlgorithm = DEFAULT_TOTP_CONFIG.algorithm,
  digits: number = DEFAULT_TOTP_CONFIG.digits,
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The RFC 6238 time step containing `atMs`. */
export function totpStep(
  atMs: number,
  stepSeconds: number = DEFAULT_TOTP_CONFIG.stepSeconds,
): number {
  return Math.floor(atMs / 1000 / stepSeconds);
}

/** The TOTP code for a base32 secret at an instant (RFC 6238 §4). */
export function generateTotp(
  secretBase32: string,
  atMs: number,
  config: TotpConfig = DEFAULT_TOTP_CONFIG,
): string {
  const step = totpStep(atMs, config.stepSeconds);
  return hotp(decodeBase32(secretBase32), step, config.algorithm, config.digits);
}

export interface TotpVerification {
  readonly valid: boolean;
  /** The time step the code matched, for replay bookkeeping; null when invalid. */
  readonly step: number | null;
}

/**
 * Verify a code against the acceptance window, in constant time per candidate.
 *
 * `afterStep` is the replay guard: a code whose step is not strictly greater
 * than the last accepted one is treated as no match, so a code observed in
 * transit cannot be reused within its own validity window (ADR-0025).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number,
  config: TotpConfig = DEFAULT_TOTP_CONFIG,
  afterStep: number | null = null,
): TotpVerification {
  const candidate = code.trim();
  if (!/^\d+$/.test(candidate) || candidate.length !== config.digits) {
    return { valid: false, step: null };
  }

  const secret = decodeBase32(secretBase32);
  const current = totpStep(atMs, config.stepSeconds);
  for (let offset = -config.window; offset <= config.window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    if (afterStep !== null && step <= afterStep) continue;
    const expected = hotp(secret, step, config.algorithm, config.digits);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return { valid: true, step };
    }
  }
  return { valid: false, step: null };
}

/**
 * The `otpauth://` provisioning URI an authenticator app scans. Carries the
 * secret, so it is returned exactly once at enrolment and never stored.
 */
export function buildOtpAuthUri(params: {
  readonly issuer: string;
  readonly account: string;
  readonly secretBase32: string;
  readonly config?: TotpConfig;
}): string {
  const config = params.config ?? DEFAULT_TOTP_CONFIG;
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: config.algorithm.toUpperCase(),
    digits: String(config.digits),
    period: String(config.stepSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
