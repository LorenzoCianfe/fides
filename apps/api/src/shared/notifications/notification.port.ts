/**
 * Outbound notification port. Mocked today (console/log capture); a real email
 * or push provider plugs in later without touching callers (ADR-0001).
 */
export interface NotificationPort {
  /** Deliver an email-verification code to the given address. */
  sendEmailVerification(to: string, code: string): Promise<void>;
}
