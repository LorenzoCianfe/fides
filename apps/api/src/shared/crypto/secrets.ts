import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Hex-encoded SHA-256 of `input`. Used to store one-time codes/tokens at rest. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * An opaque bearer token: 256 bits of randomness, base64url-encoded, carrying a
 * type prefix for debuggability (e.g. `fat_…` access, `frt_…` refresh). Only
 * the SHA-256 of the full string is ever stored.
 */
export function generateToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

/** A cryptographically-random zero-padded numeric code of `digits` length. */
export function generateNumericCode(digits = 6): string {
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
}
