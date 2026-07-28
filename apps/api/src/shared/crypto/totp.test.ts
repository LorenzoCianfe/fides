import { describe, expect, it } from 'vitest';
import {
  buildOtpAuthUri,
  decodeBase32,
  encodeBase32,
  generateTotp,
  generateTotpSecret,
  hotp,
  totpStep,
  verifyTotp,
  type TotpAlgorithm,
  type TotpConfig,
} from './totp';

const DEFAULT_STEP_MS = 30_000;

/** RFC 4226 Appendix D / RFC 6238 Appendix B seeds, as ASCII. */
const SEED_SHA1 = '12345678901234567890';
const SEED_SHA256 = '12345678901234567890123456789012';
const SEED_SHA512 = '1234567890123456789012345678901234567890123456789012345678901234';

function base32Of(ascii: string): string {
  return encodeBase32(Buffer.from(ascii, 'ascii'));
}

describe('base32 (RFC 4648)', () => {
  it('matches the published test vectors', () => {
    expect(encodeBase32(Buffer.from('', 'ascii'))).toBe('');
    expect(encodeBase32(Buffer.from('f', 'ascii'))).toBe('MY');
    expect(encodeBase32(Buffer.from('fo', 'ascii'))).toBe('MZXQ');
    expect(encodeBase32(Buffer.from('foo', 'ascii'))).toBe('MZXW6');
    expect(encodeBase32(Buffer.from('foob', 'ascii'))).toBe('MZXW6YQ');
    expect(encodeBase32(Buffer.from('fooba', 'ascii'))).toBe('MZXW6YTB');
    expect(encodeBase32(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI');
  });

  it('round-trips arbitrary bytes and tolerates padding, spaces, and lower case', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x3c, 0x91]);
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    expect(decodeBase32('mzxw 6ytb-oi'.replace('-', ''))).toEqual(Buffer.from('foobar', 'ascii'));
    expect(decodeBase32('MZXW6YTBOI======')).toEqual(Buffer.from('foobar', 'ascii'));
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase32('MZXW6YTB!!')).toThrow(/base32/i);
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];

  it.each(expected.map((code, counter) => ({ counter, code })))(
    'counter $counter yields $code',
    ({ counter, code }) => {
      expect(hotp(Buffer.from(SEED_SHA1, 'ascii'), counter)).toBe(code);
    },
  );
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  const vectors: ReadonlyArray<{
    seconds: number;
    algorithm: TotpAlgorithm;
    code: string;
  }> = [
    { seconds: 59, algorithm: 'sha1', code: '94287082' },
    { seconds: 59, algorithm: 'sha256', code: '46119246' },
    { seconds: 59, algorithm: 'sha512', code: '90693936' },
    { seconds: 1_111_111_109, algorithm: 'sha1', code: '07081804' },
    { seconds: 1_111_111_109, algorithm: 'sha256', code: '68084774' },
    { seconds: 1_111_111_109, algorithm: 'sha512', code: '25091201' },
    { seconds: 1_111_111_111, algorithm: 'sha1', code: '14050471' },
    { seconds: 1_111_111_111, algorithm: 'sha256', code: '67062674' },
    { seconds: 1_111_111_111, algorithm: 'sha512', code: '99943326' },
    { seconds: 1_234_567_890, algorithm: 'sha1', code: '89005924' },
    { seconds: 1_234_567_890, algorithm: 'sha256', code: '91819424' },
    { seconds: 1_234_567_890, algorithm: 'sha512', code: '93441116' },
    { seconds: 2_000_000_000, algorithm: 'sha1', code: '69279037' },
    { seconds: 2_000_000_000, algorithm: 'sha256', code: '90698825' },
    { seconds: 2_000_000_000, algorithm: 'sha512', code: '38618901' },
    { seconds: 20_000_000_000, algorithm: 'sha1', code: '65353130' },
    { seconds: 20_000_000_000, algorithm: 'sha256', code: '77737706' },
    { seconds: 20_000_000_000, algorithm: 'sha512', code: '47863826' },
  ];

  const seedFor: Record<TotpAlgorithm, string> = {
    sha1: SEED_SHA1,
    sha256: SEED_SHA256,
    sha512: SEED_SHA512,
  };

  it.each(vectors)('$algorithm at T=$seconds yields $code', ({ seconds, algorithm, code }) => {
    const config: TotpConfig = { algorithm, digits: 8, stepSeconds: 30, window: 1 };
    expect(generateTotp(base32Of(seedFor[algorithm]), seconds * 1000, config)).toBe(code);
  });

  it('derives the time step the RFC tabulates', () => {
    // T = 0x0000000000000001 at 59 s, 0x00000000023523EC at 1111111109 s.
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(1_111_111_109_000)).toBe(0x023523ec);
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code and reports its step', () => {
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toEqual({ valid: true, step: totpStep(now) });
  });

  it('accepts one step of clock skew either way, but not two', () => {
    const stepMs = DEFAULT_STEP_MS;
    expect(verifyTotp(secret, generateTotp(secret, now - stepMs), now).valid).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now + stepMs), now).valid).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now - 2 * stepMs), now).valid).toBe(false);
    expect(verifyTotp(secret, generateTotp(secret, now + 2 * stepMs), now).valid).toBe(false);
  });

  it('rejects a replayed code even inside its own validity window', () => {
    const step = totpStep(now);
    const code = generateTotp(secret, now);
    // First use records the step; a second use at the same step must not match.
    expect(verifyTotp(secret, code, now, undefined, null).valid).toBe(true);
    expect(verifyTotp(secret, code, now, undefined, step).valid).toBe(false);
    // A later step is still accepted after the guard advances.
    const next = generateTotp(secret, now + DEFAULT_STEP_MS);
    expect(verifyTotp(secret, next, now + DEFAULT_STEP_MS, undefined, step).valid).toBe(true);
  });

  it('rejects malformed and wrong-length codes without throwing', () => {
    expect(verifyTotp(secret, '12345', now).valid).toBe(false);
    expect(verifyTotp(secret, '1234567', now).valid).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now).valid).toBe(false);
    expect(verifyTotp(secret, '', now).valid).toBe(false);
  });

  it('rejects a code minted from a different secret', () => {
    expect(verifyTotp(secret, generateTotp(generateTotpSecret(), now), now).valid).toBe(false);
  });
});

describe('buildOtpAuthUri', () => {
  it('encodes an authenticator-scannable provisioning URI', () => {
    const uri = buildOtpAuthUri({
      issuer: 'Fides',
      account: 'ops@fides.example',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    });
    expect(uri).toContain('otpauth://totp/Fides:ops%40fides.example?');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
