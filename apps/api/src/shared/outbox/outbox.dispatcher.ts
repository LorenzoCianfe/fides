import { and, asc, eq } from 'drizzle-orm';
import type { Database, DatabaseTx } from '../../database/db.types';
import { outbox } from '../../database/schema/outbox';

/** Handles one outbox event within the dispatcher's transaction. */
export type OutboxHandler = (tx: DatabaseTx, payload: unknown) => Promise<void>;

export interface DispatchResult {
  readonly processed: number;
  /** Rows a concurrent dispatcher had already claimed. */
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Relays pending transactional-outbox rows to registered handlers.
 *
 * Each row is processed in its own transaction: the row is re-locked with
 * `FOR UPDATE SKIP LOCKED` (so multiple dispatchers can run concurrently), the
 * handler runs, and the row is marked `dispatched` — all atomically. Handlers
 * must be idempotent because delivery is at-least-once. A handler failure bumps
 * the attempt count and leaves the row `pending` for retry until `maxAttempts`,
 * after which it is parked as `failed`.
 */
export class OutboxDispatcher {
  constructor(
    private readonly db: Database,
    private readonly handlers: Readonly<Record<string, OutboxHandler>>,
    private readonly maxAttempts = 5,
  ) {}

  async dispatchPending(batchSize = 100): Promise<DispatchResult> {
    const candidates = await this.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(eq(outbox.status, 'pending'))
      .orderBy(asc(outbox.createdAt), asc(outbox.id))
      .limit(batchSize);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const { id } of candidates) {
      try {
        const outcome = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(outbox)
            .where(and(eq(outbox.id, id), eq(outbox.status, 'pending')))
            .for('update', { skipLocked: true })
            .limit(1);
          if (!row) return 'skip' as const;

          const handler = this.handlers[row.type];
          if (handler) await handler(tx, row.payload);
          await tx.update(outbox).set({ status: 'dispatched' }).where(eq(outbox.id, id));
          return 'ok' as const;
        });
        if (outcome === 'ok') processed++;
        else skipped++;
      } catch {
        failed++;
        await this.markFailure(id);
      }
    }

    return { processed, skipped, failed };
  }

  private async markFailure(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ attempts: outbox.attempts })
        .from(outbox)
        .where(eq(outbox.id, id))
        .limit(1);
      const attempts = (row?.attempts ?? 0) + 1;
      await tx
        .update(outbox)
        .set({ attempts, status: attempts >= this.maxAttempts ? 'failed' : 'pending' })
        .where(eq(outbox.id, id));
    });
  }
}
