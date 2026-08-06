import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { currentStack } from './stack';

/**
 * Recovers the six-digit email verification code for a user.
 *
 * The code is delivered out of band and **only its SHA-256 is stored**, so
 * there is nothing to read out of the database directly. Rather than adding a
 * test-only endpoint — a production surface that exists solely for tests, and
 * the kind that gets left enabled — the harness inverts the hash by exhausting
 * the code space. A six-digit code is one million candidates, about a second of
 * SHA-256 in Node.
 *
 * That this is feasible at all is precisely why the real system rate-limits
 * verification attempts and expires the codes: the entropy is low by design,
 * and the controls around it are what make it safe. Here it is simply the
 * cheapest way to learn a value the user would have read from an email.
 */
const CODE_DIGITS = 6;

let table: Map<string, string> | undefined;

/** Hash → code, for every six-digit code. Built once and reused across specs. */
function rainbowTable(): Map<string, string> {
  if (table) return table;
  const built = new Map<string, string>();
  const space = 10 ** CODE_DIGITS;
  for (let value = 0; value < space; value++) {
    const code = value.toString().padStart(CODE_DIGITS, '0');
    built.set(createHash('sha256').update(code).digest('hex'), code);
  }
  table = built;
  return built;
}

/**
 * The pending verification code for an email address.
 *
 * Takes the most recently issued unconsumed row, so a resend supersedes the
 * original exactly as it does for a real user.
 */
export async function verificationCodeFor(email: string): Promise<string> {
  const sql = postgres(currentStack().databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ code_hash: string }[]>`
      SELECT v.code_hash
      FROM email_verifications v
      JOIN users u ON u.id = v.user_id
      WHERE u.email = ${email.toLowerCase()}
        AND v.consumed_at IS NULL
      ORDER BY v.created_at DESC
      LIMIT 1
    `;

    const hash = rows[0]?.code_hash;
    if (!hash) throw new Error(`No pending verification code for ${email}`);

    const code = rainbowTable().get(hash);
    if (!code) {
      throw new Error(
        `Could not invert the verification hash for ${email}. ` +
          'The code is no longer a plain six-digit SHA-256 — update this harness.',
      );
    }
    return code;
  } finally {
    await sql.end();
  }
}
