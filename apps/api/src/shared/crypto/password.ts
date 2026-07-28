import { InternalError } from '@fides/domain';
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// Typed explicitly: promisify resolves to the 3-argument overload, which drops
// the options object carrying the work factors.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** scrypt work factors. Raising them is safe: every hash records its own. */
export interface ScryptParams {
  /** CPU/memory cost; a power of two. */
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly keyLength: number;
}

/**
 * Phase 1 parameters (ADR-0025): ~32 MB and ~100 ms per hash on commodity
 * hardware. Argon2id is the noted later hardening; it needs a native dependency
 * that `node:crypto` does not provide.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  cost: 32_768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
};

const SALT_BYTES = 16;
const SCHEME = 'scrypt';

/** Node errors when 128 * cost * blockSize exceeds maxmem; keep clear headroom. */
function maxmemFor(params: ScryptParams): number {
  return 256 * params.cost * params.blockSize;
}

async function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, params.keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
    maxmem: maxmemFor(params),
  });
}

/**
 * Hash a password to a self-describing `scrypt$cost$r$p$salt$hash` string
 * (base64url fields). Storing the parameters alongside the digest means the work
 * factors can be raised without a migration — old hashes still verify against
 * the parameters they were made with.
 */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return [
    SCHEME,
    params.cost,
    params.blockSize,
    params.parallelization,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against an encoded hash in constant time. A malformed
 * stored hash is a data-integrity fault, not a failed login, so it raises
 * rather than quietly reading as a wrong password.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) {
    throw new InternalError('Malformed password hash');
  }
  const [, cost, blockSize, parallelization, saltPart, keyPart] = parts;
  const params: ScryptParams = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
    keyLength: Buffer.from(keyPart!, 'base64url').length,
  };
  if (
    !Number.isInteger(params.cost) ||
    !Number.isInteger(params.blockSize) ||
    !Number.isInteger(params.parallelization) ||
    params.keyLength === 0
  ) {
    throw new InternalError('Malformed password hash parameters');
  }

  const expected = Buffer.from(keyPart!, 'base64url');
  const actual = await derive(password, Buffer.from(saltPart!, 'base64url'), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
