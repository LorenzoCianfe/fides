import { describe, expect, it } from 'vitest';
import { parseCookieHeader, readCookie } from './cookies';

describe('parseCookieHeader', () => {
  it('reads a single pair and a whitespace-separated list', () => {
    expect(parseCookieHeader('a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('tolerates missing and irregular whitespace', () => {
    expect(parseCookieHeader('a=1;b=2;   c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(parseCookieHeader('  a = 1 ; b = 2 ')).toEqual({ a: '1', b: '2' });
  });

  it('keeps `=` inside a value', () => {
    // base64url never emits '=' padding, but a value is opaque to the parser.
    expect(parseCookieHeader('token=abc=def=')).toEqual({ token: 'abc=def=' });
  });

  it('strips surrounding double quotes', () => {
    expect(parseCookieHeader('a="quoted"')).toEqual({ a: 'quoted' });
    // A lone quote is part of the value, not a delimiter.
    expect(parseCookieHeader('a="unbalanced')).toEqual({ a: '"unbalanced' });
  });

  it('percent-decodes, and keeps the raw value when the escape is malformed', () => {
    expect(parseCookieHeader('a=one%20two')).toEqual({ a: 'one two' });
    expect(parseCookieHeader('a=100%')).toEqual({ a: '100%' });
    expect(parseCookieHeader('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });

  it('resolves duplicate names to the first occurrence, as browsers do', () => {
    expect(parseCookieHeader('a=first; a=second')).toEqual({ a: 'first' });
  });

  it('skips segments that carry no name', () => {
    expect(parseCookieHeader('=novalue; a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader('novalue; a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader(';;; a=1 ;;')).toEqual({ a: '1' });
  });

  it('returns an empty jar for absent or empty headers', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('never lets a parsed name reach the prototype', () => {
    const jar = parseCookieHeader('__proto__=polluted; constructor=nope; a=1');

    // The dangerous case: on a plain object literal this assignment would set
    // the prototype instead of creating an own property.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(jar)).toBeNull();
    expect(jar['__proto__']).toBe('polluted');
    expect(jar['a']).toBe('1');
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
});
