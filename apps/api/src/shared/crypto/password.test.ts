import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRYPT_PARAMS, hashPassword, verifyPassword } from './password';

/** Cheap parameters keep the unit suite fast; the format is what is under test. */
const FAST = { cost: 1024, blockSize: 8, parallelization: 1, keyLength: 64 };

describe('scrypt password hashing', () => {
  it('encodes the scheme and its parameters alongside the digest', async () => {
    const encoded = await hashPassword('correct horse battery staple', FAST);
    const [scheme, cost, blockSize, parallelization, salt, key] = encoded.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(cost)).toBe(FAST.cost);
    expect(Number(blockSize)).toBe(FAST.blockSize);
    expect(Number(parallelization)).toBe(FAST.parallelization);
    expect(Buffer.from(salt!, 'base64url')).toHaveLength(16);
    expect(Buffer.from(key!, 'base64url')).toHaveLength(FAST.keyLength);
  });

  it('salts every hash, so the same password never yields the same string', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password', FAST),
      hashPassword('same-password', FAST),
    ]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('same-password', first!)).toBe(true);
    expect(await verifyPassword('same-password', second!)).toBe(true);
  });

  it('accepts the right password and rejects wrong ones', async () => {
    const encoded = await hashPassword('s3cret-passphrase', FAST);
    expect(await verifyPassword('s3cret-passphrase', encoded)).toBe(true);
    expect(await verifyPassword('s3cret-passphras', encoded)).toBe(false);
    expect(await verifyPassword('S3cret-passphrase', encoded)).toBe(false);
    expect(await verifyPassword('', encoded)).toBe(false);
  });

  it('verifies against the parameters recorded in the hash, not the current defaults', async () => {
    // A hash made with old (cheaper) parameters must still verify after the
    // defaults are raised — that is the point of the self-describing format.
    const legacy = await hashPassword('legacy-secret', { ...FAST, cost: 512 });
    expect(legacy).toContain('$512$');
    expect(await verifyPassword('legacy-secret', legacy)).toBe(true);
  });

  it('normalizes unicode so an equivalent passphrase still verifies', async () => {
    const composed = 'passwörd'; // o-with-diaeresis as one code point
    const decomposed = 'passwörd'; // o + combining diaeresis
    expect(composed).not.toBe(decomposed);
    const encoded = await hashPassword(composed, FAST);
    expect(await verifyPassword(decomposed, encoded)).toBe(true);
  });

  it('raises on a malformed stored hash rather than reading it as a bad password', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).rejects.toThrow(/Malformed password hash/);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$aa$bb')).rejects.toThrow(
      /Malformed password hash/,
    );
    await expect(verifyPassword('x', 'scrypt$x$8$1$aa$bb')).rejects.toThrow(/Malformed password/);
  });

  it('uses production parameters by default', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({
      cost: 32_768,
      blockSize: 8,
      parallelization: 1,
      keyLength: 64,
    });
  });
});
