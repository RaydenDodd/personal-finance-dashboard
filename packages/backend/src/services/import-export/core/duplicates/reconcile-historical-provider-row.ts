import { TRANSACTION_TYPES, type HistoricalTransactionSource } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { findOneTransaction, findTransactions, updateTransactions } from '@models/transactions-query';
import { Op, literal } from 'sequelize';

import { lockHistoricalAccount } from './historical-account-lock';
import { reconcileHistoricalRows } from './reconcile-historical-rows';

/** Called inside canonical createTransaction's ambient transaction. Claim a unique
 * historical row before a later live sync can append another copy. Ambiguity fails
 * visibly and leaves both the existing record and the provider cursor intact. */
export async function reconcileHistoricalProviderRow({
  accountId,
  userId,
  originalId,
  amount,
  transactionType,
  time,
  description,
  externalData,
}: {
  accountId: string;
  userId: number;
  originalId: string;
  amount: Money;
  transactionType: TRANSACTION_TYPES;
  time: Date;
  description: string;
  externalData?: Record<string, unknown>;
}) {
  await lockHistoricalAccount({ accountId });
  const exact = await findOneTransaction({
    access: { accountOwner: userId },
    planned: 'exclude',
    balanceAdjustments: 'exclude',
    where: { accountId, originalId },
    paranoid: false,
  });
  if (exact) return exact;
  const near = await findTransactions({
    access: { accountOwner: userId },
    planned: 'exclude',
    balanceAdjustments: 'exclude',
    completeness: 'all',
    where: {
      accountId,
      originalId: { [Op.like]: 'history:%' },
      amount,
      time: { [Op.between]: [new Date(time.valueOf() - 4 * 86_400_000), new Date(time.valueOf() + 4 * 86_400_000)] },
      [Op.and]: [literal(`"Transactions"."externalData"->'historicalSources' IS NOT NULL`)],
    },
  });
  if (!near.length) return null;
  const date = time.toISOString().slice(0, 10);
  const [decision] = reconcileHistoricalRows({
    rows: [
      {
        accountId,
        date,
        signedAmountCents: amount.toCents() * (transactionType === TRANSACTION_TYPES.income ? 1 : -1),
        description,
        source: {
          key: `simplefin:${originalId}`,
          bankId: originalId,
          fileName: 'SimpleFIN',
          fileHash: 'provider',
          sheet: 'sync',
          row: 1,
          institution: 'SimpleFIN',
          transactionDate: date,
        },
      },
    ],
    candidates: near.map((tx) => ({
      id: tx.id,
      accountId: tx.accountId,
      date: new Date(tx.time).toISOString().slice(0, 10),
      signedAmountCents: tx.amount.toCents() * (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1),
      description: tx.note ?? '',
      originalId: tx.originalId,
      sources: tx.externalData.historicalSources as HistoricalTransactionSource[],
    })),
  });
  if (decision?.action === 'review') throw new ConflictError({ message: t({ key: 'historicalImport.syncConflict' }) });
  if (decision?.action !== 'existing') return null;
  const matched = near.find((tx) => tx.id === decision.transactionId)!;
  const nonblank = Object.fromEntries(
    Object.entries(externalData ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  const updatedExternalData = { ...matched.externalData, ...nonblank };
  await updateTransactions({
    access: { accountOwner: userId },
    planned: 'exclude',
    balanceAdjustments: 'exclude',
    where: { id: matched.id, accountId },
    values: { originalId, externalData: updatedExternalData },
    individualHooks: false,
  });
  matched.setDataValue('originalId', originalId);
  matched.setDataValue('externalData', updatedExternalData);
  return matched;
}
