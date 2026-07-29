/**
 * Minimal RFC 6265 §5.4 `Cookie:` header reader.
 *
 * Express parses cookies only with `cookie-parser`; writing them is built in.
 * Rather than take two dependencies (`cookie` ships no types) to read three
 * known names, this follows the precedent set by the in-house TOTP and scrypt
 * helpers (ADR-0025) and keeps the dependency surface flat.
 *
 * The result is a null-prototype object on purpose: assigning a parsed name
 * like `__proto__` onto a plain `{}` would mutate the prototype rather than
 * create an own property, which is an attacker-controlled write.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return jar;

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    // `< 1` also rejects a leading '=', which would yield an empty name.
    if (separator < 1) continue;

    const name = segment.slice(0, separator).trim();
    // First occurrence wins, matching how browsers resolve duplicate names.
    if (!name || name in jar) continue;

    jar[name] = decodeCookieValue(segment.slice(separator + 1).trim());
  }

  return jar;
}

/** Read one cookie, treating an empty value as absent. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  const value = parseCookieHeader(header)[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function decodeCookieValue(raw: string): string {
  const unquoted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  if (!unquoted.includes('%')) return unquoted;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    // A malformed escape is not a reason to fail the request: the value simply
    // will not match any token we hold, and the caller rejects it as unknown.
    return unquoted;
  }
}
