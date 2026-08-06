/**
 * Minimal RFC 6265 §5.4 `Cookie:` header reader.
 *
 * Express parses cookies only with `cookie-parser`; writing them is built in.
 * Rather than take two dependencies (`cookie` ships no types) to read three
 * known names, this follows the precedent set by the in-house TOTP and scrypt
 * helpers (ADR-0025) and keeps the dependency surface flat.
 *
 * A `Map` rather than an object, because every name here comes from a request
 * header an attacker controls. An object turns `__proto__` into a write against
 * the prototype instead of an own property; `Object.create(null)` avoids that,
 * but only as long as nobody later "tidies" it into a literal. A `Map` has no
 * prototype chain to reach at all, so the hazard is gone structurally rather
 * than by a guard a future edit could quietly drop.
 */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    // `< 1` also rejects a leading '=', which would yield an empty name.
    if (separator < 1) continue;

    const name = segment.slice(0, separator).trim();
    // First occurrence wins, matching how browsers resolve duplicate names.
    if (!name || jar.has(name)) continue;

    jar.set(name, decodeCookieValue(segment.slice(separator + 1).trim()));
  }

  return jar;
}

/** Read one cookie, treating an empty value as absent. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  const value = parseCookieHeader(header).get(name);
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
