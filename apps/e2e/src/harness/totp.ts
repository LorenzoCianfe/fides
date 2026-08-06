import { createHmac } from 'node:crypto';

/**
 * TOTP code generation for the back-office sign-ins this suite drives.
 *
 * Deliberately a local implementation of RFC 6238 rather than an import of the
 * API's internals: `apps/api` publishes no entry point for its crypto helpers,
 * and reaching into another package's `src` would couple the harness to a file
 * path. It is standard HMAC-SHA1 / 6 digits / 30-second step — the defaults in
 * `apps/api/src/shared/crypto/totp.ts`.
 *
 * A divergence cannot pass silently: the server verifies every code this
 * produces, so the very first admin sign-in fails if the two ever disagree.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const STEP_SECONDS = 30;

function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`Malformed base32 secret: ${value}`);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secretBase32)).update(message).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}
