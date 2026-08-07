/**
 * Test-run configuration that every suite needs and none should have to repeat.
 *
 * `ENCRYPTION_KEYS` is required with no default (ADR-0028) precisely so a
 * deployment cannot silently fall back to plaintext, which means the test run
 * has to supply one. Setting it here rather than in each `beforeAll` keeps that
 * requirement in one obvious place, and the key below is a fixed, all-zeros
 * value that is self-evidently not a secret.
 */
const TEST_KEY = Buffer.alloc(32, 0).toString('base64');

process.env.ENCRYPTION_KEYS ??= `test:${TEST_KEY}`;
