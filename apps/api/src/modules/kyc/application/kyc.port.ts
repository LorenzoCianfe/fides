export interface KycApplicant {
  readonly userId: string;
  readonly givenName: string;
  readonly familyName: string;
  /** ISO 8601 date of birth (YYYY-MM-DD). */
  readonly dateOfBirth: string;
  /** ISO 3166-1 alpha-2 country of residence. */
  readonly country: string;
}

export const KycOutcome = {
  Approved: 'approved',
  Rejected: 'rejected',
  Review: 'review',
} as const;

export type KycOutcome = (typeof KycOutcome)[keyof typeof KycOutcome];

export interface KycDecision {
  readonly outcome: KycOutcome;
  /** Provider-side reference for the decision. */
  readonly reference: string;
}

/**
 * Identity-verification port (KYC/AML). Mocked today; a provider such as Onfido
 * or Sumsub plugs in later behind this interface (ADR-0001, ADR-0008).
 */
export interface KycPort {
  submit(applicant: KycApplicant): Promise<KycDecision>;
}

/** DI token binding the active KycPort adapter. */
export const KYC_PORT = Symbol('KYC_PORT');
