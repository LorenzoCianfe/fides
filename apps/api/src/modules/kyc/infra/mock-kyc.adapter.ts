import type { IdGenerator } from '@fides/domain';
import {
  KycOutcome,
  type KycApplicant,
  type KycDecision,
  type KycPort,
} from '../application/kyc.port';

/**
 * Scripted KYC adapter for development: auto-approves every applicant. The real
 * pipeline (document capture, liveness, sanctions/PEP screening, risk scoring)
 * arrives in Phase 3 behind the same port.
 */
export class MockKycAdapter implements KycPort {
  constructor(private readonly ids: IdGenerator) {}

  async submit(_applicant: KycApplicant): Promise<KycDecision> {
    return Promise.resolve({ outcome: KycOutcome.Approved, reference: `kyc_${this.ids.next()}` });
  }
}
