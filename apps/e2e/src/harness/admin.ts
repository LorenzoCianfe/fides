import { randomUUID } from 'node:crypto';
import { API_URL, BOOTSTRAP_ADMIN } from './stack';
import { generateTotp } from './totp';

/**
 * Drives the back office over HTTP.
 *
 * Funding is the only way a customer wallet gets money since Slice 7 retired
 * the dev faucet, and it is admin-only under four-eyes — so the suite has to
 * arrange a maker and a checker before a transfer can move anything. That is
 * driven through the API rather than a UI because `apps/admin` is deliberately
 * still a shell: the admin interface belongs to Phase 2.
 *
 * The segregation of duties is real here rather than simulated. `super_admin`
 * holds the approve half and is *denied* the request half (ADR-0025), so the
 * bootstrapped account cannot fund anyone by itself; it must staff a
 * `compliance_officer` to propose.
 */

interface AdminSession {
  readonly adminId: string;
  readonly token: string;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Admin API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text}`,
    );
  }
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

/**
 * The real two-step sign-in: password, then TOTP — enrolling a second factor
 * first when the admin has none, exactly as an operator does on their first
 * sign-in. No session is issued until a factor exists.
 */
async function signIn(email: string, password: string): Promise<AdminSession> {
  const login = await call<{ challengeToken: string; mfaEnrolled: boolean }>(
    '/v1/admin/auth/login',
    { method: 'POST', body: { email, password } },
  );

  let secret: string | undefined;
  if (!login.mfaEnrolled) {
    const enrolled = await call<{ secret: string }>('/v1/admin/auth/mfa/enrol', {
      method: 'POST',
      body: { challengeToken: login.challengeToken },
    });
    secret = enrolled.secret;
  }
  if (!secret) throw new Error(`${email} already has a second factor; its secret is unrecoverable`);

  const verified = await call<{ adminId: string; token: string }>('/v1/admin/auth/mfa/verify', {
    method: 'POST',
    body: { challengeToken: login.challengeToken, code: generateTotp(secret) },
  });

  return { adminId: verified.adminId, token: verified.token };
}

/**
 * Maker and checker, signed in once per run.
 *
 * Cached because the API rejects a TOTP code whose time step is not strictly
 * greater than the last one accepted for that admin (the replay guard,
 * ADR-0025). Signing the same admin in twice inside one 30-second window would
 * fail on the second, and the enrolment secret is returned exactly once anyway.
 */
let operators: Promise<{ maker: AdminSession; checker: AdminSession }> | undefined;

function backOffice(): Promise<{ maker: AdminSession; checker: AdminSession }> {
  operators ??= (async () => {
    const checker = await signIn(BOOTSTRAP_ADMIN.email, BOOTSTRAP_ADMIN.password);

    const makerCredentials = {
      email: `maker-${randomUUID()}@fides.local`,
      password: 'e2e-maker-password-not-a-secret',
    };
    await call('/v1/admin/admins', {
      method: 'POST',
      token: checker.token,
      body: { ...makerCredentials, role: 'compliance_officer' },
    });

    const maker = await signIn(makerCredentials.email, makerCredentials.password);
    return { maker, checker };
  })();

  return operators;
}

/**
 * Credit a customer wallet through the full four-eyes path: the maker proposes,
 * the checker approves, and only the approval posts to the ledger.
 */
export async function fundCustomer(
  userId: string,
  amountMinor: string,
  currency = 'EUR',
): Promise<void> {
  const { maker, checker } = await backOffice();

  const action = await call<{ id: string }>('/v1/admin/funding-requests', {
    method: 'POST',
    token: maker.token,
    body: {
      userId,
      amount: { amount: amountMinor, currency },
      reason: 'E2E: opening balance for the transfer journey',
    },
  });

  await call(`/v1/admin/funding-requests/${action.id}/approve`, {
    method: 'POST',
    token: checker.token,
    idempotencyKey: randomUUID(),
    body: { reason: 'E2E: approved by the checker' },
  });
}

/** The customer's user id, looked up the way an operator would. */
export async function findCustomerId(email: string): Promise<string> {
  const { checker } = await backOffice();
  const page = await call<{ items: { id: string; email: string }[] }>(
    `/v1/admin/customers?email=${encodeURIComponent(email)}`,
    { token: checker.token },
  );

  const customer = page.items.find((entry) => entry.email === email.toLowerCase());
  if (!customer) throw new Error(`No back-office customer record for ${email}`);
  return customer.id;
}
