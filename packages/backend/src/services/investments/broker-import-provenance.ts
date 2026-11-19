import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';

export function brokerImportMarker(sourceRowId: string): string {
  if (!/^[a-f0-9]{64}$/.test(sourceRowId))
    throw new ValidationError({ message: 'Invalid broker source row identifier.' });
  return `[broker-row:${sourceRowId}]`;
}

/** Manual notes stay editable while their import identity survives a rename. */
export function preserveBrokerImportMarker({ previous, next }: { previous: string | null; next: string }): string {
  const marker = previous?.match(/^\[broker-row:[a-f0-9]{64}\]/)?.[0];
  if (!marker) return next;
  return `${marker} ${next.replace(/^\[broker-row:[a-f0-9]{64}\]\s*/, '')}`.slice(0, 2000);
}

/** Called inside withTransaction so concurrent retries cannot apply one source row twice. */
export async function lockBrokerImportRow({
  userId,
  portfolioId,
  sourceRowId,
}: {
  userId: number;
  portfolioId: string;
  sourceRowId: string;
}): Promise<string> {
  const marker = brokerImportMarker(sourceRowId);
  await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key: `broker-import:${userId}:${portfolioId}:${sourceRowId}` },
  });
  return marker;
}
