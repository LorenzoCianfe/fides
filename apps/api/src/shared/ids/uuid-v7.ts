import type { IdGenerator } from '@fides/domain';
import { uuidv7 } from 'uuidv7';

/**
 * UUID v7 (time-ordered) identifier generator. Time-ordered ids give good index
 * locality for append-heavy ledger tables while remaining globally unique.
 */
export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
