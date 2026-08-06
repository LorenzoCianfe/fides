import type { ErrorResponseDto, SessionResponseDto } from '@fides/contracts';
import { API_BASE_URL } from '../config';
import { clearSession, readSession, saveSession, type SessionTokens } from '../auth/session-store';

/**
 * Device API client on the bearer transport (ADR-0027).
 *
 * The cookie mode added in Wave A is for browsers, which cannot hold a token
 * out of reach of script. A native app can, so mobile keeps the original bearer
 * contract and stores the pair in the platform keystore.
 */

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

/** Raised when the session is gone and the user has to sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Skip the bearer header and the refresh-and-retry. Used by the auth routes. */
  anonymous?: boolean;
}

/**
 * The tokens, cached in memory so the common path does not hit the keystore on
 * every request. `undefined` means "not loaded yet", `null` means "loaded, and
 * there is no session" — the distinction is what keeps a signed-out app from
 * re-reading the keystore before each call.
 */
let cached: SessionTokens | null | undefined;

async function currentTokens(): Promise<SessionTokens | null> {
  if (cached === undefined) cached = await readSession();
  return cached;
}

export async function setSession(tokens: SessionTokens): Promise<void> {
  cached = tokens;
  await saveSession(tokens);
}

export async function forgetSession(): Promise<void> {
  cached = null;
  await clearSession();
}

export async function hasSession(): Promise<boolean> {
  return (await currentTokens()) !== null;
}

/**
 * In-flight refresh, shared by every caller that races into a 401.
 *
 * This is load-bearing rather than an optimization. Refresh tokens rotate and
 * the server treats a second use of a rotated token as theft, revoking the
 * whole session (ADR-0020). Two concurrent requests both refreshing would do
 * exactly that to a legitimate user, so all of them await one rotation.
 */
let refreshInFlight: Promise<SessionTokens> | null = null;

async function refreshTokens(): Promise<SessionTokens> {
  refreshInFlight ??= (async () => {
    try {
      const tokens = await currentTokens();
      if (!tokens) throw new SessionExpiredError();

      const response = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      if (!response.ok) {
        // The refresh token is spent, expired, or revoked. Nothing to retry.
        await forgetSession();
        throw new SessionExpiredError();
      }

      const session = (await response.json()) as SessionResponseDto;
      if (!session.accessToken || !session.refreshToken) {
        await forgetSession();
        throw new SessionExpiredError();
      }

      const next = { accessToken: session.accessToken, refreshToken: session.refreshToken };
      await setSession(next);
      return next;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function send(path: string, options: RequestOptions, token?: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiError(response.status, payload as ErrorResponseDto);
  return payload as T;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.anonymous) return parse<T>(await send(path, options));

  const tokens = await currentTokens();
  if (!tokens) throw new SessionExpiredError();

  const first = await send(path, options, tokens.accessToken);
  if (first.status !== 401) return parse<T>(first);

  // One refresh-and-retry. If the retry also 401s the session is genuinely
  // gone, and retrying again would only spend another rotation.
  const refreshed = await refreshTokens();
  const second = await send(path, options, refreshed.accessToken);
  if (second.status === 401) {
    await forgetSession();
    throw new SessionExpiredError();
  }
  return parse<T>(second);
}

/**
 * An `Idempotency-Key` for a money-moving request. Generated once per user
 * intent and reused across retries — that is what makes a retry a replay rather
 * than a second payment.
 */
export function newIdempotencyKey(): string {
  // `crypto.randomUUID` is not in React Native's Hermes runtime. This is used
  // only to correlate a retry with its original request, never as a secret, so
  // a v4-shaped value from Math.random is adequate here and nowhere else.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
