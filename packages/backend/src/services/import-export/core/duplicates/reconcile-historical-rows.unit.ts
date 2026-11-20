import type { HistoricalMatchCandidate, HistoricalTransactionRow } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { normalizeHistoricalDescription, reconcileHistoricalRows } from './reconcile-historical-rows';

const row = (overrides: Partial<HistoricalTransactionRow> = {}): HistoricalTransactionRow => ({
  accountId: 'card',
  date: '2024-12-31',
  signedAmountCents: -1250,
  description: 'TST* River Cafe',
  source: {
    key: 'purchase-1',
    fileName: 'card.csv',
    fileHash: 'a'.repeat(64),
    sheet: 'CSV',
    row: 2,
    institution: 'Bank',
    transactionDate: '2024-12-31',
  },
  ...overrides,
});
const candidate = (overrides: Partial<HistoricalMatchCandidate> = {}): HistoricalMatchCandidate => ({
  id: 'existing',
  accountId: 'card',
  date: '2024-12-31',
  signedAmountCents: -1250,
  description: 'River Cafe',
  ...overrides,
});
const decide = ({
  rows = [row()],
  candidates = [],
}: { rows?: HistoricalTransactionRow[]; candidates?: HistoricalMatchCandidate[] } = {}) =>
  reconcileHistoricalRows({ rows, candidates });

describe('historical reconciliation', () => {
  it('normalizes processor prefixes and preserves meaningful merchant digits', () => {
    expect(normalizeHistoricalDescription({ description: 'TST* 622 North' })).toBe('622 north');
    expect(normalizeHistoricalDescription({ description: 'SQ *9:30 Club' })).toBe('9 30 club');
  });
  it('matches a bank record while retaining its identity', () =>
    expect(decide({ candidates: [candidate()] })[0]).toMatchObject({ action: 'existing', transactionId: 'existing' }));
  it('does not merge accounts', () =>
    expect(decide({ candidates: [candidate({ accountId: 'other' })] })[0]?.action).toBe('new'));
  it('does not merge opposite signs', () =>
    expect(decide({ candidates: [candidate({ signedAmountCents: 1250 })] })[0]?.action).toBe('new'));
  it('holds same-amount different-merchant records', () =>
    expect(decide({ candidates: [candidate({ description: 'Book Shop' })] })[0]?.action).toBe('review'));
  it('holds a pending versus posted conflict', () =>
    expect(decide({ candidates: [candidate({ isPending: true })] })[0]?.reason).toBe('pending-versus-posted'));
  it('holds multiple indistinguishable candidates', () =>
    expect(decide({ candidates: [candidate(), candidate({ id: 'second' })] })[0]?.action).toBe('review'));
  it('uses the exact transaction day before a nearby repeated purchase', () =>
    expect(
      decide({ candidates: [candidate(), candidate({ id: 'next-day', date: '2025-01-01' })] })[0]?.transactionId,
    ).toBe('existing'));
  it('accepts a reasonable posting-date difference across a year boundary', () =>
    expect(decide({ candidates: [candidate({ date: '2025-01-02' })] })[0]?.action).toBe('existing'));
  it('does not match outside the posting window', () =>
    expect(decide({ candidates: [candidate({ date: '2025-01-05' })] })[0]?.action).toBe('new'));
  it('prefers a reliable identifier, while holding conflicting amounts', () => {
    const input = row();
    input.source.bankId = 'bank-1';
    expect(
      decide({
        rows: [input],
        candidates: [candidate({ originalId: 'bank-1', description: 'Different bank abbreviation' })],
      })[0]?.action,
    ).toBe('existing');
    expect(
      decide({ rows: [input], candidates: [candidate({ originalId: 'bank-1', signedAmountCents: -2000 })] })[0]?.reason,
    ).toBe('identifier-financial-conflict');
  });
  it('preserves two same-day purchases with distinct reliable identifiers', () => {
    const first = row();
    first.source.bankId = 'bank-1';
    const second = row({ source: { ...first.source, key: 'purchase-2', bankId: 'bank-2', row: 3 } });
    expect(decide({ rows: [first, second] }).map((decision) => decision.action)).toEqual(['new', 'new']);
  });
  it('preserves source multiplicity without transaction identifiers', () => {
    const first = row();
    const second = row({ source: { ...first.source, key: 'purchase-2', row: 3 } });
    expect(decide({ rows: [first, second], candidates: [candidate()] }).map((decision) => decision.action)).toEqual([
      'existing',
      'new',
    ]);
  });
  it('reconciles overlapping CSV and XLSX sources to one proposed record', () => {
    const first = row();
    const overlapping = row({
      source: {
        ...first.source,
        key: 'different-export-key',
        fileName: 'card.xlsx',
        fileHash: 'b'.repeat(64),
        sheet: 'Details',
      },
    });
    expect(decide({ rows: [first, overlapping] }).map((decision) => decision.action)).toEqual([
      'new',
      'source-duplicate',
    ]);
  });
  it('does not count the identical source row twice', () =>
    expect(decide({ rows: [row(), row()] }).map((decision) => decision.action)).toEqual(['new', 'source-duplicate']));
  it('matches a substantial statement-name prefix, preserving ambiguous short names', () => {
    expect(
      decide({
        rows: [row({ description: 'CHIPOTLE 3295' })],
        candidates: [candidate({ description: 'CHIPOTLE 3295 DULLES VA' })],
      })[0]?.action,
    ).toBe('existing');
    expect(
      decide({ rows: [row({ description: 'UBER' })], candidates: [candidate({ description: 'UBER EATS' })] })[0]
        ?.action,
    ).toBe('review');
  });
  it('creates zero additional rows on a repeated import', () => {
    const input = [row(), row({ source: { ...row().source, key: 'second', row: 3 } })];
    const first = decide({ rows: input });
    const inserted = first
      .filter((decision) => decision.action === 'new')
      .map((decision) => candidate({ id: `saved-${decision.rowIndex}`, sources: [input[decision.rowIndex]!.source] }));
    expect(decide({ rows: input, candidates: inserted }).filter((decision) => decision.action === 'new')).toHaveLength(
      0,
    );
  });
});
