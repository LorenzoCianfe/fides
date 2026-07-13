import { ValidationError } from '@fides/domain';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Read and validate the required `Idempotency-Key` header. Money-moving requests
 * must carry one (documentation.md §6); a missing or over-long key is a 400
 * rather than silently proceeding without the exactly-once guarantee.
 */
export function requireIdempotencyKey(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = raw?.trim();
  if (!key) {
    throw new ValidationError('The Idempotency-Key header is required');
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationError('The Idempotency-Key header is too long', {
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    });
  }
  return key;
}
