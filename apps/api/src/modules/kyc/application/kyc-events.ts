/** Event type emitted when a user's KYC application is approved. */
export const KYC_APPROVED_EVENT = 'kyc.approved';

/**
 * Payload of {@link KYC_APPROVED_EVENT}. Emitted by onboarding on approval and
 * consumed by account provisioning (Slice 4) to create the user's account,
 * wallet, and backing ledger account.
 */
export interface KycApprovedPayload {
  readonly userId: string;
  /** Provider-side reference for the KYC decision. */
  readonly reference: string;
}
