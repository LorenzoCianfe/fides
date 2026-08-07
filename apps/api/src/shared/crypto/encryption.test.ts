import { describe, expect, it } from 'vitest';
import {
  KeyringEncryption,
  generateEncryptionKey,
  isEncrypted,
  parseKeyring,
  totpSecretContext,
} from './encryption';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

function boxWith(spec: string): KeyringEncryption {
  return new KeyringEncryption(parseKeyring(spec));
}

describe('parseKeyring', () => {
  it('takes the first entry as primary and keeps the rest usable', () => {
    const ring = parseKeyring(`k1:${KEY_A}, k2:${KEY_B}`);
    expect(ring.primaryKeyId).toBe('k1');
    expect([...ring.keys.keys()]).toEqual(['k1', 'k2']);
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    // A truncated key would otherwise boot fine and fail at first sign-in.
    expect(() => parseKeyring(`k1:${Buffer.alloc(16, 1).toString('base64')}`)).toThrow(/32 bytes/);
  });

  it('rejects an entry without a key id', () => {
    expect(() => parseKeyring(KEY_A)).toThrow(/keyId:base64Key/);
  });

  it('rejects a duplicated key id', () => {
    expect(() => parseKeyring(`k1:${KEY_A},k1:${KEY_B}`)).toThrow(/more than once/);
  });

  it('rejects an empty specification', () => {
    expect(() => parseKeyring('  ')).toThrow(/At least one encryption key/);
  });

  it('accepts a freshly generated key', () => {
    expect(() => parseKeyring(`k1:${generateEncryptionKey()}`)).not.toThrow();
  });
});

describe('KeyringEncryption', () => {
  const context = totpSecretContext('019fd68d-abef-7388-aa6a-072056f0ec20');

  it('round-trips a value', () => {
    const box = boxWith(`k1:${KEY_A}`);
    expect(box.decrypt(box.encrypt('JBSWY3DPEHPK3PXP', context), context)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a self-describing envelope naming its key', () => {
    const envelope = boxWith(`k1:${KEY_A}`).encrypt('secret', context);
    expect(envelope.split('$').slice(0, 3)).toEqual(['fenc', 'v1', 'k1']);
    expect(isEncrypted(envelope)).toBe(true);
    expect(envelope).not.toContain('secret');
  });

  it('never repeats a ciphertext for the same input', () => {
    // A fresh nonce per call; a repeated one would be catastrophic under GCM.
    const box = boxWith(`k1:${KEY_A}`);
    expect(box.encrypt('same', context)).not.toBe(box.encrypt('same', context));
  });

  it('refuses a ciphertext moved to another admin row', () => {
    // The whole point of binding the context: an attacker with database write
    // access must not be able to graft one admin's second factor onto another.
    const box = boxWith(`k1:${KEY_A}`);
    const envelope = box.encrypt('JBSWY3DPEHPK3PXP', totpSecretContext('admin-a'));
    expect(() => box.decrypt(envelope, totpSecretContext('admin-b'))).toThrow(/authentication/);
  });

  it('refuses a tampered ciphertext', () => {
    const box = boxWith(`k1:${KEY_A}`);
    const parts = box.encrypt('JBSWY3DPEHPK3PXP', context).split('$');
    const body = Buffer.from(parts[5]!, 'base64url');
    body[0] = body[0]! ^ 0xff;
    parts[5] = body.toString('base64url');
    expect(() => box.decrypt(parts.join('$'), context)).toThrow(/authentication/);
  });

  it('refuses a ciphertext sealed under a different key', () => {
    const envelope = boxWith(`k1:${KEY_A}`).encrypt('secret', context);
    // Same key id, different material — the ring cannot tell until the tag fails.
    expect(() => boxWith(`k1:${KEY_B}`).decrypt(envelope, context)).toThrow(/authentication/);
  });

  it('decrypts under a rotated ring while writing with the new primary', () => {
    const old = boxWith(`k1:${KEY_A}`);
    const sealed = old.encrypt('JBSWY3DPEHPK3PXP', context);

    // k2 leads, so it encrypts; k1 stays in the ring, so old rows still read.
    const rotated = boxWith(`k2:${KEY_B},k1:${KEY_A}`);
    expect(rotated.decrypt(sealed, context)).toBe('JBSWY3DPEHPK3PXP');
    expect(rotated.encrypt('new', context).split('$')[2]).toBe('k2');
  });

  it('raises when the envelope names a key the ring no longer holds', () => {
    const sealed = boxWith(`k1:${KEY_A}`).encrypt('secret', context);
    expect(() => boxWith(`k2:${KEY_B}`).decrypt(sealed, context)).toThrow(/No encryption key "k1"/);
  });

  it('raises on a malformed envelope rather than reading it as plaintext', () => {
    const box = boxWith(`k1:${KEY_A}`);
    expect(() => box.decrypt('JBSWY3DPEHPK3PXP', context)).toThrow(/Malformed/);
    expect(() => box.decrypt('fenc$v9$k1$a$b$c', context)).toThrow(/Malformed/);
  });
});

describe('isEncrypted', () => {
  it('distinguishes an envelope from a legacy plaintext base32 secret', () => {
    expect(isEncrypted('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(isEncrypted(boxWith(`k1:${KEY_A}`).encrypt('x', 'ctx'))).toBe(true);
  });
});
