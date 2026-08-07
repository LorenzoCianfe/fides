import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Ed25519Signing,
  generateSigningKey,
  parseSigningKeyring,
  type SigningPort,
} from './signing';

/** A PKCS8-wrapped Ed25519 seed: the fixed DER prefix plus 32 bytes. */
function seededKey(fill: number): string {
  return Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.alloc(32, fill),
  ]).toString('base64');
}

const KEY_A = seededKey(1);
const KEY_B = seededKey(2);

function signing(spec: string): SigningPort {
  return new Ed25519Signing(parseSigningKeyring(spec));
}

describe('parseSigningKeyring', () => {
  it('takes the first pair as the primary and keeps the rest usable', () => {
    const keyring = parseSigningKeyring(`k2:${KEY_B}, k1:${KEY_A}`);
    expect(keyring.primaryKeyId).toBe('k2');
    expect([...keyring.keys.keys()]).toEqual(['k2', 'k1']);
  });

  it('rejects malformed entries rather than deferring the failure to first use', () => {
    // A bad key in configuration must fail at boot. Deferred, it would surface
    // hours later inside a background pass whose failure is only logged.
    expect(() => parseSigningKeyring('no-separator')).toThrow(/keyId:base64Pkcs8/);
    expect(() => parseSigningKeyring('k1:not-base64-der')).toThrow(/valid base64 PKCS8/);
    expect(() => parseSigningKeyring('')).toThrow(/At least one signing key/);
    expect(() => parseSigningKeyring(`k1:${KEY_A},k1:${KEY_B}`)).toThrow(/more than once/);
  });

  it('rejects a key that is not Ed25519', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsa = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(() => parseSigningKeyring(`k1:${rsa}`)).toThrow(/must be Ed25519/);
  });
});

describe('Ed25519Signing', () => {
  it('round-trips a signature over the payload', () => {
    const port = signing(`k1:${KEY_A}`);
    const payload = '{"hash":"abc","seq":41}';
    expect(port.verify(payload, port.sign(payload))).toBe(true);
  });

  it('produces a self-describing envelope naming the key that made it', () => {
    // The same property the ADR-0028 ciphertext has, for the same reason: a
    // value carries what is needed to read it, so rotation needs no migration.
    const envelope = signing(`k1:${KEY_A}`).sign('payload');
    const [scheme, version, keyId] = envelope.split('$');
    expect([scheme, version, keyId]).toEqual(['fsig', 'v1', 'k1']);
  });

  it('rejects a payload that changed after signing', () => {
    // The whole point: an anchor claiming seq 41 cannot be re-pointed at 12.
    const port = signing(`k1:${KEY_A}`);
    const envelope = port.sign('{"hash":"abc","seq":41}');
    expect(port.verify('{"hash":"abc","seq":12}', envelope)).toBe(false);
  });

  it('rejects a forged or truncated signature without raising', () => {
    const port = signing(`k1:${KEY_A}`);
    const forged = `fsig$v1$k1$${Buffer.alloc(64, 9).toString('base64url')}`;
    expect(port.verify('payload', forged)).toBe(false);
    // A structurally impossible signature is what a forgery attempt looks like,
    // so it is a failed verification rather than a fault.
    expect(port.verify('payload', 'fsig$v1$k1$AAAA')).toBe(false);
  });

  it('still verifies an anchor signed before the key rotated', () => {
    const older = signing(`k1:${KEY_A}`);
    const envelope = older.sign('payload');

    // k2 is now primary; k1 stays in the ring purely so its anchors keep working.
    const rotated = signing(`k2:${KEY_B},k1:${KEY_A}`);
    expect(rotated.primaryKeyId).toBe('k2');
    expect(rotated.verify('payload', envelope)).toBe(true);
    expect(rotated.sign('payload').split('$')[2]).toBe('k2');
  });

  it('raises rather than reporting a forgery when the envelope cannot be read', () => {
    // Reporting these as "invalid signature" would send an operator hunting for
    // tampering that never happened.
    const port = signing(`k1:${KEY_A}`);
    expect(() => port.verify('payload', 'not-an-envelope')).toThrow(/Malformed signature envelope/);
    expect(() => port.verify('payload', `fsig$v2$k1$AAAA`)).toThrow(/Malformed signature envelope/);
    expect(() => port.verify('payload', `fsig$v1$gone$AAAA`)).toThrow(/No signing key "gone"/);
  });

  it('rejects a signature made by a key outside the ring', () => {
    const outsider = signing(`k1:${KEY_B}`).sign('payload');
    // Same key id, different key material — the substitution an attacker who
    // could not reach the real key would attempt.
    expect(signing(`k1:${KEY_A}`).verify('payload', outsider)).toBe(false);
  });

  it('publishes a public key that verifies anchors off-host, holding nothing secret', () => {
    // This is why the port is asymmetric at all: an auditor reading a log
    // archive can confirm an anchor while holding nothing that could mint one.
    const port = signing(`k1:${KEY_A}`);
    const payload = '{"hash":"abc","seq":41}';
    const signature = port.sign(payload).split('$')[3]!;

    const publicKey = createPublicKey({
      key: Buffer.from(port.publicKey(), 'base64'),
      format: 'der',
      type: 'spki',
    });
    const verified = cryptoVerify(
      null,
      Buffer.from(payload, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    expect(verified).toBe(true);
  });

  it('exports the public key of a named non-primary key, and raises for an unknown one', () => {
    const port = signing(`k2:${KEY_B},k1:${KEY_A}`);
    expect(port.publicKey('k1')).not.toBe(port.publicKey('k2'));
    expect(() => port.publicKey('gone')).toThrow(/No signing key "gone"/);
  });

  it('generates keys the keyring accepts', () => {
    const port = signing(`fresh:${generateSigningKey()}`);
    expect(port.verify('payload', port.sign('payload'))).toBe(true);
  });
});
