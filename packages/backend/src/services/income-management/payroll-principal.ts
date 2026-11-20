import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { getCashFlows, getFinanceAccounts } from '@services/personal-finance';
import { importPrincipalRecords, principalStateHash } from '@services/personal-finance/principal';
import type { Transaction } from 'sequelize';

import { getPayrollDocument } from './payroll';
import { buildPayrollPrincipalPlan } from './payroll-principal-plan';

export async function reconcilePayrollPrincipal(
  userId: number,
  input: {
    employmentId: string;
    accountId: string;
    previewOnly: boolean;
    previewToken?: string;
  },
) {
  // Hold payroll stable while canonical principal writes acquire their existing separate user lock.
  return connection.sequelize.transaction(async (transaction: Transaction) => {
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(71419,:userId)', {
      replacements: { userId },
      transaction,
      logging: false,
    });
    const document = await getPayrollDocument(userId, transaction);
    const [accounts, flows] = await Promise.all([
      getFinanceAccounts(userId, transaction),
      getCashFlows(userId, transaction),
    ]);
    const stateHash = principalStateHash(flows);
    let plan;
    try {
      plan = buildPayrollPrincipalPlan(document, accounts, flows, input.employmentId, input.accountId, stateHash);
    } catch (error) {
      throw new ValidationError({
        message: error instanceof Error ? error.message : 'Invalid payroll principal mapping',
      });
    }
    const { records, coverageExtension, ...preview } = plan;
    if (input.previewOnly) return { ...preview, previewOnly: true };
    if (!input.previewToken || input.previewToken !== preview.previewToken)
      throw new ValidationError({
        message: 'Payroll or principal changed. Preview the reconciliation again before applying.',
      });
    const reviews = plan.actions
      .filter((a) => ['covered', 'conflict'].includes(a.status))
      .map((a) => ({
        reviewKey: `payroll:${input.employmentId}:${input.accountId}:${a.date}`,
        reason: a.reason!,
        details: { employmentId: input.employmentId, accountId: input.accountId, ...a },
      }));
    const result = await importPrincipalRecords(userId, records, {
      expectedStateHash: stateHash,
      reviews,
      coverageExtension,
    });
    return { ...preview, previewOnly: false, result };
  });
}
