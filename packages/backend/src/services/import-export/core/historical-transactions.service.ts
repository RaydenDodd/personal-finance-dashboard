import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  ImportSource,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type HistoricalMatchCandidate,
  type HistoricalTransactionRow,
  type HistoricalTransactionSource,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { createTransaction } from '@services/transactions/create-transaction';
import { createSingleRefund } from '@services/tx-refunds/create-single-refund.service';
import { createHash, randomUUID } from 'node:crypto';

import { lockHistoricalAccount } from './duplicates/historical-account-lock';
import { reconcileHistoricalRows } from './duplicates/reconcile-historical-rows';
import { withImportBatchRecord, type OpenImportBatch } from './import-batch-record';

export const historicalCandidate = ({ transaction: tx }: { transaction: Transactions }): HistoricalMatchCandidate => ({
  id: tx.id,
  accountId: tx.accountId,
  date: new Date(tx.time).toISOString().slice(0, 10),
  postedDate:
    typeof tx.externalData?.posted === 'number' && tx.externalData.posted > 0
      ? new Date(tx.externalData.posted * 1000).toISOString().slice(0, 10)
      : undefined,
  signedAmountCents: tx.amount.toCents() * (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1),
  description: tx.note ?? '',
  originalId: tx.originalId,
  isPending: Boolean(tx.externalData?.hold),
  sources: Array.isArray(tx.externalData?.historicalSources)
    ? (tx.externalData.historicalSources as HistoricalTransactionSource[])
    : [],
});

const prepareHistoricalImport = async ({ userId, rows }: { userId: number; rows: HistoricalTransactionRow[] }) => {
  const accountIds = [...new Set(rows.map((row) => row.accountId))].toSorted((left, right) =>
    left.localeCompare(right),
  );
  const accounts = accountIds.length ? await Accounts.findAll({ where: { userId, id: accountIds } }) : [];
  const allowedCategories = [ACCOUNT_CATEGORIES.cash, ACCOUNT_CATEGORIES.saving, ACCOUNT_CATEGORIES.creditCard];
  if (
    accounts.length !== accountIds.length ||
    accounts.some(
      (account) => account.type !== ACCOUNT_TYPES.simplefin || !allowedCategories.includes(account.accountCategory),
    )
  ) {
    throw new ValidationError({ message: t({ key: 'historicalImport.invalidAccounts' }) });
  }
  const categoryIds = [...new Set(rows.flatMap((row) => (row.categoryId ? [row.categoryId] : [])))];
  if (categoryIds.length && (await Categories.count({ where: { userId, id: categoryIds } })) !== categoryIds.length) {
    throw new ValidationError({ message: t({ key: 'historicalImport.invalidCategories' }) });
  }
  const transactions = accountIds.length
    ? await findTransactions({
        access: { accountOwner: userId },
        planned: 'exclude',
        balanceAdjustments: 'exclude',
        completeness: 'all',
        where: { accountId: accountIds, paymentParentId: null },
        order: [['id', 'ASC']],
      })
    : [];
  const candidates = transactions.map((transaction) => historicalCandidate({ transaction }));
  const decisions = reconcileHistoricalRows({ rows, candidates });
  for (const decision of decisions) {
    const reason = rows[decision.rowIndex]!.reviewReason;
    if (reason) {
      decision.action = 'review';
      decision.reason = reason;
    }
  }
  const rowBySource = new Map(rows.map((row, index) => [row.source.key, { row, decision: decisions[index]! }]));
  for (const decision of decisions) {
    const row = rows[decision.rowIndex]!;
    if (decision.action !== 'new' || !row.isRefund) continue;
    const sourceTarget = row.refundForSourceKey ? rowBySource.get(row.refundForSourceKey) : undefined;
    const existingTarget = row.refundForTransactionId
      ? candidates.find((candidate) => candidate.id === row.refundForTransactionId)
      : undefined;
    if (
      (row.refundForSourceKey &&
        (!sourceTarget ||
          sourceTarget.decision.action === 'review' ||
          sourceTarget.row.signedAmountCents >= 0 ||
          sourceTarget.row.accountId !== row.accountId)) ||
      (row.refundForTransactionId &&
        (!existingTarget || existingTarget.signedAmountCents >= 0 || existingTarget.accountId !== row.accountId))
    ) {
      decision.action = 'review';
      decision.reason = 'refund-original-unresolved';
    }
  }
  const heldProposals = new Set(
    decisions
      .filter((item) => item.action === 'review' && item.transactionId?.startsWith('proposed:'))
      .map((item) => item.transactionId),
  );
  for (const decision of decisions) {
    if (decision.action !== 'review' && heldProposals.has(decision.transactionId)) {
      decision.action = 'review';
      decision.reason = 'source-duplicate-of-held-record';
    }
  }
  const previewToken = createHash('sha256')
    .update(JSON.stringify({ userId, rows, candidates, decisions }))
    .digest('hex');
  const counts = { new: 0, existing: 0, 'source-duplicate': 0, review: 0 };
  decisions.forEach((decision) => counts[decision.action]++);
  return { accounts, transactions, decisions, counts, previewToken };
};

/** No writes, no source parsing, no account creation, and no balance reconciliation. */
export const previewHistoricalImport = async (params: { userId: number; rows: HistoricalTransactionRow[] }) => {
  const { decisions, counts, previewToken } = await prepareHistoricalImport(params);
  return { decisions, counts, previewToken };
};

/** Uses the existing batch audit and canonical create service. Only SimpleFIN cash,
 * savings and card accounts qualify: their existing hooks leave balances untouched. */
export const executeHistoricalImport = withTransaction(
  withImportBatchRecord(
    async ({
      userId,
      rows,
      previewToken,
      openImportBatch,
    }: {
      userId: number;
      rows: HistoricalTransactionRow[];
      previewToken: string;
      openImportBatch: OpenImportBatch;
    }) => {
      for (const accountId of [...new Set(rows.map((row) => row.accountId))].toSorted((left, right) =>
        left.localeCompare(right),
      ))
        await lockHistoricalAccount({ accountId });
      const plan = await prepareHistoricalImport({ userId, rows });
      if (plan.previewToken !== previewToken)
        throw new ConflictError({ message: t({ key: 'historicalImport.stalePreview' }) });
      const batchId = randomUUID();
      const importDetails = { batchId, source: ImportSource.csv, importedAt: new Date().toISOString() };
      await openImportBatch({ userId, importDetails });
      const defaultCategoryId = await getUserDefaultCategory({ id: userId });
      const resolved = new Map<string, Transactions>(
        plan.transactions.map((transaction) => [transaction.id, transaction]),
      );
      const createdIds: string[] = [];
      const matchedIds = new Set<string>();
      const sourceTransactions = new Map<string, Transactions>();
      for (const decision of plan.decisions) {
        if (decision.action === 'review') continue;
        const row = rows[decision.rowIndex]!;
        if (decision.action === 'new') {
          const [transaction] = await createTransaction({
            userId,
            accountId: row.accountId,
            accountType: ACCOUNT_TYPES.simplefin,
            amount: Money.fromCents(Math.abs(row.signedAmountCents)),
            transactionType: row.signedAmountCents > 0 ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
            time: new Date(`${row.date}T12:00:00.000Z`),
            note: row.description,
            payeeId: row.payeeId,
            originalId: `history:${row.source.key}`,
            categoryId: row.categoryId ?? defaultCategoryId,
            // Existing user/payee/subscription rules keep priority over source suggestions.
            categoryIdIsExplicit: false,
            transferNature: row.isTransfer
              ? TRANSACTION_TRANSFER_NATURE.transfer_out_wallet
              : TRANSACTION_TRANSFER_NATURE.not_transfer,
            externalData: {
              importDetails,
              historicalSources: [row.source],
              ...(row.mcc ? { mcc: row.mcc } : {}),
              ...(row.merchantName ? { payee: row.merchantName } : {}),
            },
            matchPlanned: false,
          });
          resolved.set(decision.transactionId!, transaction);
          sourceTransactions.set(row.source.key, transaction);
          createdIds.push(transaction.id);
        } else {
          const transaction = resolved.get(decision.transactionId!);
          if (!transaction) throw new Error('Historical reconciliation target was not resolved');
          const sources = historicalCandidate({ transaction }).sources!;
          if (
            !sources.some(
              (source) =>
                source.fileHash === row.source.fileHash &&
                source.sheet === row.source.sheet &&
                source.row === row.source.row &&
                source.key === row.source.key,
            )
          ) {
            // Preserve every bank field, original id, category, correction, and import batch.
            const externalData = { ...transaction.externalData, historicalSources: [...sources, row.source] };
            // Provenance alone has no balance effect. Avoid rerunning financial
            // hooks on a cached instance already updated by another source row.
            await updateTransactions({
              access: { accountOwner: userId },
              planned: 'exclude',
              balanceAdjustments: 'exclude',
              where: { id: transaction.id, accountId: row.accountId },
              values: { externalData },
              individualHooks: false,
            });
            transaction.setDataValue('externalData', externalData);
          }
          matchedIds.add(transaction.id);
          sourceTransactions.set(row.source.key, transaction);
        }
      }
      // Resolve after every row exists: exports usually list the refund before the
      // original purchase. Never manufacture a missing purchase to close a pair.
      for (const decision of plan.decisions.filter((item) => item.action === 'new')) {
        const row = rows[decision.rowIndex]!;
        if (!row.isRefund) continue;
        const refund = sourceTransactions.get(row.source.key)!;
        const original = row.refundForTransactionId
          ? resolved.get(row.refundForTransactionId)
          : row.refundForSourceKey
            ? sourceTransactions.get(row.refundForSourceKey)
            : undefined;
        await createSingleRefund({ userId, refundTxId: refund.id, originalTxId: original?.id ?? null });
      }
      return {
        batchId,
        counts: plan.counts,
        createdIds,
        matchedIds: [...matchedIds],
        review: plan.decisions.filter((decision) => decision.action === 'review'),
      };
    },
  ),
);
