/**
 * Test-run configuration that every suite needs and none should have to repeat.
 *
 * `ENCRYPTION_KEYS` (ADR-0028) and `AUDIT_ANCHOR_KEYS` (ADR-0031) are both
 * required with no default, precisely so a deployment cannot silently fall back
 * to plaintext or to publishing no anchors — which means the test run has to
 * supply them. Setting them here rather than in each `beforeAll` keeps that
 * requirement in one obvious place, and both values below are fixed, all-zeros
 * keys that are self-evidently not secrets.
 */
const TEST_KEY = Buffer.alloc(32, 0).toString('base64');

/** A PKCS8-wrapped all-zeros Ed25519 seed: the DER prefix plus 32 zero bytes. */
const TEST_SIGNING_KEY = Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'),
  Buffer.alloc(32, 0),
]).toString('base64');

process.env.ENCRYPTION_KEYS ??= `test:${TEST_KEY}`;
process.env.AUDIT_ANCHOR_KEYS ??= `test:${TEST_SIGNING_KEY}`;
