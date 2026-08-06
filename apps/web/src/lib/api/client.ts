import type { ErrorResponseDto } from '@fides/contracts';

/**
 * Browser API client for the cookie transport (ADR-0027).
 *
 * Every request goes out with `credentials: 'include'`, because the session
 * lives entirely in httpOnly cookies this code cannot read. The only cookie it
 * *can* read is the CSRF token, which it echoes back on state-changing calls —
 * that asymmetry is the whole point of the mode.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const TOKEN_TRANSPORT_HEADER = 'X-Fides-Token-Transport';
const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE = 'fides_csrf';

/** A failed call, carrying the server's canonical error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly category: string;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(status: number, body: ErrorResponseDto) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.category = body.category;
    this.details = body.details;
    this.correlationId = body.correlationId;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /**
   * Ask the API to deliver the session as cookies. Set only on the three routes
   * that mint or rotate a session; everywhere else it is meaningless.
   */
  cookieTransport?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Read the readable half of the double-submit pair. */
export function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const segment of document.cookie.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 1) continue;
    if (segment.slice(0, separator).trim() !== CSRF_COOKIE) continue;
    const value = decodeURIComponent(segment.slice(separator + 1).trim());
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers({ Accept: 'application/json' });

  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookieTransport) headers.set(TOKEN_TRANSPORT_HEADER, 'cookie');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  // The server exempts safe methods, but sending it unconditionally on writes
  // keeps the rule in one place rather than at each call site.
  if (isStateChanging(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, payload as ErrorResponseDto);
  }
  return payload as T;
}

/**
 * An `Idempotency-Key` for a money-moving request. Generated once per user
 * intent and reused across retries — that is what makes a retry a replay
 * rather than a second payment.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
