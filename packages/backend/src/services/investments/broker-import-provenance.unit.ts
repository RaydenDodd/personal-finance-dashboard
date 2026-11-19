import { connection } from '@models/connection';

import { brokerImportMarker, lockBrokerImportRow, preserveBrokerImportMarker } from './broker-import-provenance';

jest.mock('@models/connection', () => ({ connection: { sequelize: { query: jest.fn().mockResolvedValue([]) } } }));

describe('broker import provenance', () => {
  const sourceRowId = 'a'.repeat(64);

  it('rejects invalid import identities before issuing a lock', async () => {
    jest.mocked(connection.sequelize.query).mockClear();
    expect(() => brokerImportMarker('not-a-hash')).toThrow();
    await expect(lockBrokerImportRow({ userId: 1, portfolioId: 'portfolio', sourceRowId: 'bad' })).rejects.toThrow();
    expect(connection.sequelize.query).not.toHaveBeenCalled();
  });

  it('scopes retry serialization to the owner, portfolio and source row', async () => {
    jest.mocked(connection.sequelize.query).mockClear();
    expect(await lockBrokerImportRow({ userId: 7, portfolioId: 'portfolio-a', sourceRowId })).toBe(
      brokerImportMarker(sourceRowId),
    );
    expect(connection.sequelize.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `broker-import:7:portfolio-a:${sourceRowId}` },
    });
  });

  it('retains the original identity during a manual note change or attempted marker replacement', () => {
    const original = brokerImportMarker(sourceRowId);
    expect(preserveBrokerImportMarker({ previous: `${original} old`, next: 'Corrected note' })).toBe(
      `${original} Corrected note`,
    );
    expect(
      preserveBrokerImportMarker({
        previous: `${original} old`,
        next: `${brokerImportMarker('b'.repeat(64))} New note`,
      }),
    ).toBe(`${original} New note`);
    expect(preserveBrokerImportMarker({ previous: 'A manual row', next: 'A manual correction' })).toBe(
      'A manual correction',
    );
    expect(preserveBrokerImportMarker({ previous: original, next: 'x'.repeat(2001) })).toHaveLength(2000);
  });
});
