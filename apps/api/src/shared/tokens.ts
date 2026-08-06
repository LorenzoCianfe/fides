/**
 * DI tokens for the shared platform services. The implementations are plain,
 * framework-free classes; these symbols bind them into the NestJS container.
 */

/** Platform IdGenerator (UUID v7). */
export const ID_GENERATOR = Symbol('ID_GENERATOR');

/** Platform EventClock. */
export const CLOCK = Symbol('CLOCK');

/** Outbound NotificationPort (console adapter in development). */
export const NOTIFICATIONS = Symbol('NOTIFICATIONS');

/** Field-level EncryptionPort (local keyring adapter; KMS-shaped, ADR-0028). */
export const ENCRYPTION = Symbol('ENCRYPTION');
