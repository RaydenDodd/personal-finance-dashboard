import { LockedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { connection, runOutsideTransaction } from '@models/connection';
import { QueryTypes, type Transaction } from 'sequelize';

// Reserve a separate advisory-lock namespace from read-model admission.
// These two IDs must stay stable across backend and worker processes.
const LOCK_NAMESPACE = 17428820;
const JOB_IDS = { 'read-model': 1, 'daily-history': 2 } as const;
type Job = keyof typeof JOB_IDS;

/**
 * Hold a PostgreSQL transaction-scoped advisory lock on a dedicated pooled
 * connection. PostgreSQL releases it when the session/transaction ends,
 * including process death. No Redis TTL, cache eviction or manual key removal.
 * Actual financial work runs outside the lock transaction: it keeps its
 * existing transaction boundaries and does not hold a long data snapshot.
 */
export function withInvestmentJobLock<TArgs extends unknown[], TResult>(
  job: Job,
  work: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args) =>
    runOutsideTransaction(() =>
      connection.sequelize.transaction(async (transaction: Transaction) => {
        const rows: { acquired: boolean }[] = await connection.sequelize.query(
          'SELECT pg_try_advisory_xact_lock(:namespace, :jobId) AS acquired',
          {
            replacements: { namespace: LOCK_NAMESPACE, jobId: JOB_IDS[job] },
            type: QueryTypes.SELECT,
            transaction,
          },
        );
        if (!rows[0]?.acquired) {
          throw new LockedError({ message: `Investment job already running: ${job}` });
        }
        logger.info('Investment job advisory lock acquired', { job });
        try {
          return await runOutsideTransaction(() => work(...args));
        } finally {
          // The managed transaction commits or rolls back immediately after
          // this callback. Never unlock a session owned by another process.
          logger.info('Investment job advisory lock scope finished', { job });
        }
      }),
    );
}
