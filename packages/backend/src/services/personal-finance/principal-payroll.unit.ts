jest.mock('@models/index', () => ({
  connection: {
    sequelize: {
      transaction: jest.fn(async (work) => work({})),
      query: jest.fn(async () => []),
    },
  },
}));
jest.mock('@models/transaction-splits.model', () => ({}));
jest.mock('@models/transactions-query', () => ({
  countTransactions: jest.fn(),
  findTransactions: jest.fn(),
  updateTransactions: jest.fn(),
}));
jest.mock('@services/bank-data-providers/enablebanking/utils/transaction-metadata', () => ({
  hasSettledStatus: jest.fn(),
}));
jest.mock('./index', () => ({ getCashFlows: jest.fn(), getFinanceAccounts: jest.fn() }));

import { connection } from '@models/index';

import { getCashFlows, getFinanceAccounts } from './index';
import { importPrincipalRecords, principalStateHash } from './principal';
import type { PrincipalImportRecord, PrincipalStoredFlow } from './principal-types';
import type { FinanceAccount } from './types';

const account = { id: 'account', currencyCode: 'USD' } as FinanceAccount;
const existing = (): PrincipalStoredFlow => ({
  id: '11111111-1111-4111-8111-111111111111',
  userId: 1,
  accountId: account.id,
  date: '2026-05-29',
  amount: 13,
  amountCents: 1300,
  type: 'contribution',
  toAccountId: null,
  opening: true,
  description: 'Retained original sheet contribution',
  createdAt: '2026-11-19T00:00:00Z',
  source: 'google-sheets',
  sourceId: 'sheet',
  sourceKey: 'original-cell',
  sourceFingerprint: 'original',
  contributionKind: 'unspecified',
  verified: true,
  supersededAt: null,
  supersedesId: null,
  evidence: { principalValidThrough: '2026-05-29', originalNote: 'retained' },
});
const record = (): PrincipalImportRecord => ({
  accountId: account.id,
  date: '2026-05-29',
  amount: 13,
  type: 'contribution',
  opening: true,
  source: 'payroll',
  sourceId: 'payroll:employment',
  sourceKey: 'pay-date:2026-05-29',
  note: `MoneyMatter cash-flow: ${existing().id}`,
  contributionKind: 'unspecified',
  verified: true,
  evidence: {
    verifiedComponents: true,
    employeeAmount: 10,
    employerAmount: 3,
    employerMatchAmount: 2,
    employerOtherAmount: 1,
    payrollStatementIds: ['statement'],
    payrollEmploymentId: 'employment',
  },
});
const query = connection.sequelize.query as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (getFinanceAccounts as jest.Mock).mockResolvedValue([account]);
  (getCashFlows as jest.Mock).mockResolvedValue([existing()]);
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM "PersonalFinanceCashFlows"') && sql.includes('id=:id')) return [existing()];
    return [];
  });
});

describe('canonical principal payroll integrity guards', () => {
  it('rejects a stale preview under the principal user lock before writes', async () => {
    await expect(importPrincipalRecords(1, [record()], { expectedStateHash: 'stale' })).rejects.toThrow(
      /changed after the preview/,
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT') || sql.includes('UPDATE'))).toBe(false);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock(71403');
  });

  it('links exact verified components without inserting or modifying financial amounts', async () => {
    const result = await importPrincipalRecords(1, [record()], { expectedStateHash: principalStateHash([existing()]) });
    expect(result).toMatchObject({ inserted: 0, linked: 1, corrected: 0, conflicts: [] });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO "PersonalFinanceCashFlows"'))).toBe(false);
    const updates = query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE "PersonalFinanceCashFlows"'));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).not.toContain('amount');
    expect(JSON.parse(updates[0][1].replacements.evidence)).toMatchObject({
      originalNote: 'retained',
      verifiedComponents: true,
      employeeAmount: 10,
      employerAmount: 3,
    });
    expect(
      query.mock.calls.some(([, options]) => options.replacements?.action === 'principal.payroll-components-linked'),
    ).toBe(true);
  });

  it('does not overwrite different previously verified employee/employer components', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT * FROM "PersonalFinanceCashFlows"') && sql.includes('id=:id')
        ? [{ ...existing(), evidence: { verifiedComponents: true, employeeAmount: 9, employerAmount: 4 } }]
        : [],
    );
    await expect(importPrincipalRecords(1, [record()])).rejects.toThrow(
      /Previously verified principal components differ/,
    );
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE "PersonalFinanceCashFlows"'))).toBe(false);
  });

  it('advances verified coverage with an audit entry while preserving the checkpoint amount', async () => {
    const result = await importPrincipalRecords(1, [], {
      expectedStateHash: principalStateHash([existing()]),
      coverageExtension: {
        cashFlowId: existing().id,
        from: '2026-05-29',
        through: '2026-06-12',
        proof: { synthetic: true },
      },
    });
    expect(result.inserted).toBe(0);
    const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE "PersonalFinanceCashFlows"'));
    expect(update![0]).not.toContain('amount');
    expect(JSON.parse(update![1].replacements.evidence)).toMatchObject({
      principalValidThrough: '2026-06-12',
      originalNote: 'retained',
    });
    expect(
      query.mock.calls.some(([, options]) => options.replacements?.action === 'principal.payroll-coverage-verified'),
    ).toBe(true);
  });

  it('refuses to change coverage if another edit changed the original coverage date', async () => {
    await expect(
      importPrincipalRecords(1, [], {
        coverageExtension: { cashFlowId: existing().id, from: '2026-05-28', through: '2026-06-12', proof: {} },
      }),
    ).rejects.toThrow(/coverage changed/);
  });

  it('includes amount/provenance changes in stable preview fingerprints', () => {
    const initial = principalStateHash([existing()]);
    expect(principalStateHash([{ ...existing(), amount: 14 }])).not.toBe(initial);
    expect(
      principalStateHash([{ ...existing(), evidence: { ...existing().evidence, verifiedComponents: true } }]),
    ).not.toBe(initial);
    expect(
      principalStateHash([
        { ...existing(), evidence: { originalNote: 'retained', principalValidThrough: '2026-05-29' } },
      ]),
    ).toBe(initial);
  });
});
