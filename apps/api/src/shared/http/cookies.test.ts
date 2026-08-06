import { describe, expect, it } from 'vitest';
import { parseCookieHeader, readCookie } from './cookies';

/** Compare a jar by content, without asserting the container type at each site. */
function entries(header: string | undefined): Record<string, string> {
  return Object.fromEntries(parseCookieHeader(header));
}

describe('parseCookieHeader', () => {
  it('reads a single pair and a whitespace-separated list', () => {
    expect(entries('a=1')).toEqual({ a: '1' });
    expect(entries('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('tolerates missing and irregular whitespace', () => {
    expect(entries('a=1;b=2;   c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(entries('  a = 1 ; b = 2 ')).toEqual({ a: '1', b: '2' });
  });

  it('keeps `=` inside a value', () => {
    // base64url never emits '=' padding, but a value is opaque to the parser.
    expect(entries('token=abc=def=')).toEqual({ token: 'abc=def=' });
  });

  it('strips surrounding double quotes', () => {
    expect(entries('a="quoted"')).toEqual({ a: 'quoted' });
    // A lone quote is part of the value, not a delimiter.
    expect(entries('a="unbalanced')).toEqual({ a: '"unbalanced' });
  });

  it('percent-decodes, and keeps the raw value when the escape is malformed', () => {
    expect(entries('a=one%20two')).toEqual({ a: 'one two' });
    expect(entries('a=100%')).toEqual({ a: '100%' });
    expect(entries('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });

  it('resolves duplicate names to the first occurrence, as browsers do', () => {
    expect(entries('a=first; a=second')).toEqual({ a: 'first' });
  });

  it('skips segments that carry no name', () => {
    expect(entries('=novalue; a=1')).toEqual({ a: '1' });
    expect(entries('novalue; a=1')).toEqual({ a: '1' });
    expect(entries(';;; a=1 ;;')).toEqual({ a: '1' });
  });

  it('returns an empty jar for absent or empty headers', () => {
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader('').size).toBe(0);
  });

  it('keeps a hostile name as data rather than reaching the prototype', () => {
    const jar = parseCookieHeader('__proto__=polluted; constructor=nope; a=1');

    // The dangerous case: assigning this name onto an object literal would set
    // the prototype instead of creating an own property. A Map has no prototype
    // chain to reach, so the name is only ever a key.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(jar.get('__proto__')).toBe('polluted');
    expect(jar.get('constructor')).toBe('nope');
    expect(jar.get('a')).toBe('1');
  });
});

describe('readCookie', () => {
  it('returns the named value', () => {
    expect(readCookie('fides_at=fat_abc; fides_csrf=fcs_xyz', 'fides_at')).toBe('fat_abc');
  });

  it('treats an absent or empty cookie as undefined', () => {
    expect(readCookie('fides_at=fat_abc', 'fides_rt')).toBeUndefined();
    expect(readCookie('fides_at=', 'fides_at')).toBeUndefined();
    expect(readCookie(undefined, 'fides_at')).toBeUndefined();
  });

  it('does not resolve inherited names', () => {
    // `readCookie(h, 'toString')` on an object-backed jar would return a
    // function from the prototype rather than undefined.
    expect(readCookie('a=1', 'toString')).toBeUndefined();
    expect(readCookie('a=1', 'constructor')).toBeUndefined();
  });
});
