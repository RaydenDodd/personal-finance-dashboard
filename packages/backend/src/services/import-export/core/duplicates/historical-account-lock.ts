import { connection } from '@models/connection';

/** Shared by historical execution and SimpleFIN's canonical create path.
 * Call only inside withTransaction; sorted account order avoids cross-file deadlocks. */
export async function lockHistoricalAccount({ accountId }: { accountId: string }): Promise<void> {
  await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:accountId, 817231))', {
    replacements: { accountId },
    logging: false,
  });
}
