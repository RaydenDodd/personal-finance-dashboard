import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import TransactionSplits from '@models/transaction-splits.model';
import { countTransactions, findTransactions, updateTransactions } from '@models/transactions-query';
import { hasSettledStatus } from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Op, QueryTypes, Transaction } from 'sequelize';

import { cents, money } from './calculations';
import { getCashFlows, getFinanceAccounts } from './index';
import {
  cashFlowIdFromNote,
  isRecordedDate,
  isReturnOrAwardDescription,
  matchPrincipalEvidence,
  normalizePrincipalDescription,
  PRINCIPAL_AUTOMATION_START,
  principalRecordFingerprintInput,
  sameReferencedPrincipalMovement,
  selectPrincipalTransferRule,
} from './principal-matching';
import type {
  PrincipalImportRecord,
  PrincipalImportResult,
  PrincipalStoredFlow,
  PrincipalTransferRule,
} from './principal-types';
import type { FinanceAccount, FinanceCashFlow } from './types';

const read = <T>(sql: string, replacements: Record<string, unknown> = {}, transaction?: Transaction): Promise<T[]> =>
  connection.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction, logging: false });
const execute = (sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction, logging: false });
function fail(message: string): never {
  throw new ValidationError({ message });
}
const fingerprint = (record: PrincipalImportRecord) =>
  createHash('sha256')
    .update(JSON.stringify(principalRecordFingerprintInput(record)))
    .digest('hex');
const flowRow = (row: PrincipalStoredFlow): FinanceCashFlow => ({
  ...row,
  date: String(row.date),
  amount: money(Number(row.amountCents)),
  createdAt: new Date(row.createdAt).toISOString(),
});
const localDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const lockUser = <T>(userId: number, work: (transaction: Transaction) => Promise<T>) =>
  connection.sequelize.transaction(async (transaction: Transaction) => {
    await execute('SELECT pg_advisory_xact_lock(71403,:userId)', { userId }, transaction);
    return work(transaction);
  });
const audit = async (userId: number, action: string, entityId: string, details: unknown, transaction: Transaction) =>
  execute(
    'INSERT INTO "PersonalFinanceAudit" (id,"userId",action,"entityId",details) VALUES (:id,:userId,:action,:entityId,CAST(:details AS jsonb))',
    { id: randomUUID(), userId, action, entityId, details: JSON.stringify(details) },
    transaction,
  );

async function review(userId: number, reviewKey: string, reason: string, details: unknown, transaction?: Transaction) {
  await execute(
    `INSERT INTO "PersonalFinancePrincipalReviews" (id,"userId","reviewKey",reason,details) VALUES (:id,:userId,:reviewKey,:reason,CAST(:details AS jsonb))
    ON CONFLICT ("userId","reviewKey") DO UPDATE SET reason=EXCLUDED.reason,details=EXCLUDED.details,"resolvedAt"=CASE WHEN "PersonalFinancePrincipalReviews".reason=EXCLUDED.reason AND "PersonalFinancePrincipalReviews".details=EXCLUDED.details THEN "PersonalFinancePrincipalReviews"."resolvedAt" ELSE NULL END`,
    { id: randomUUID(), userId, reviewKey, reason, details: JSON.stringify(details) },
    transaction,
  );
}
export async function recordPrincipalReview(
  userId: number,
  data: { reviewKey: string; reason: string; details: Record<string, unknown> },
) {
  return lockUser(userId, async (transaction) => {
    await review(userId, data.reviewKey, data.reason, data.details, transaction);
    return { recorded: true };
  });
}
export async function acknowledgePrincipalHistory(
  userId: number,
  data: { basis: Array<{ id: string; validThrough?: string }>; reviewIds: string[]; undatedFlowIds?: string[] },
) {
  return lockUser(userId, async (transaction) => {
    const own = await read<PrincipalStoredFlow>(
      'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId AND "supersededAt" IS NULL',
      { userId },
      transaction,
    );
    for (const acceptance of data.basis) {
      const flow = own.find((f) => f.id === acceptance.id && f.opening);
      if (!flow) fail('An accepted opening basis must belong to this account owner');
      const evidence = {
        ...flow.evidence,
        ownerAccepted: true,
        ownerAcceptedLegacy: true,
        ownerAcceptedAt: new Date().toISOString(),
        ...(acceptance.validThrough ? { principalValidThrough: acceptance.validThrough } : {}),
      };
      await execute(
        'UPDATE "PersonalFinanceCashFlows" SET evidence=CAST(:evidence AS jsonb) WHERE id=:id AND "userId"=:userId',
        { userId, id: flow.id, evidence: JSON.stringify(evidence) },
        transaction,
      );
      await audit(
        userId,
        'principal.legacy-amounts-accepted',
        flow.id,
        { before: flow.evidence, after: evidence, datesNotCertified: true },
        transaction,
      );
    }
    for (const id of data.undatedFlowIds ?? []) {
      const flow = own.find((f) => f.id === id && !f.opening);
      if (!flow) fail('Legacy contribution must belong to this owner');
      const evidence = {
        ...flow.evidence,
        dateUnknown: true,
        dateVerified: false,
        ownerAccepted: true,
        acceptedAsUndatedAt: new Date().toISOString(),
      };
      await execute(
        'UPDATE "PersonalFinanceCashFlows" SET evidence=CAST(:evidence AS jsonb) WHERE id=:id AND "userId"=:userId',
        { id, userId, evidence: JSON.stringify(evidence) },
        transaction,
      );
      await audit(
        userId,
        'principal.legacy-date-uncertainty-recorded',
        id,
        { before: flow.evidence, after: evidence },
        transaction,
      );
    }
    if (data.reviewIds.length) {
      await execute(
        'UPDATE "PersonalFinancePrincipalReviews" SET "resolvedAt"=COALESCE("resolvedAt",NOW()) WHERE "userId"=:userId AND id IN (:ids)',
        { userId, ids: data.reviewIds },
        transaction,
      );
      await audit(userId, 'principal.reviews-archived', 'legacy', { reviewIds: data.reviewIds }, transaction);
    }
    return { accepted: data.basis.length, archived: data.reviewIds.length };
  });
}

function validateRecord(record: PrincipalImportRecord, accounts: FinanceAccount[]) {
  if (!record.sourceId?.trim() || !record.sourceKey?.trim() || !isRecordedDate(record.date))
    fail('Principal records require a source identity and an actual effective date');
  const account = accounts.find((row) => row.id === record.accountId);
  if (!account) fail('Principal account not found');
  cents(record.amount);
  if (record.type !== 'adjustment' && record.amount <= 0) fail('Principal movements require a positive amount');
  if (record.opening && !['contribution', 'adjustment'].includes(record.type))
    fail('A principal checkpoint must be an opening contribution or adjustment');
  if (record.type === 'transfer') {
    const destination = accounts.find((row) => row.id === record.toAccountId);
    if (!destination || destination.id === account.id || destination.currencyCode !== account.currencyCode)
      fail('Principal transfers require another owned account in the same currency');
  } else if (record.toAccountId) fail('A destination is only valid for a principal transfer');
}

async function references(userId: number, cashFlowId: string, record: PrincipalImportRecord, transaction: Transaction) {
  const refs = [
    { namespace: `principal-source:${record.sourceId}`, key: record.sourceKey },
    ...(record.transactionIds ?? []).map((key) => ({ namespace: 'transaction', key })),
  ];
  for (const reference of refs) {
    const existing = await read<{ cashFlowId: string }>(
      'SELECT "cashFlowId" FROM "PersonalFinancePrincipalReferences" WHERE "userId"=:userId AND namespace=:namespace AND key=:key',
      { userId, ...reference },
      transaction,
    );
    if (existing[0] && existing[0].cashFlowId !== cashFlowId)
      fail('Principal evidence is already linked to another contribution');
    await execute(
      `INSERT INTO "PersonalFinancePrincipalReferences" ("userId",namespace,key,"cashFlowId") VALUES (:userId,:namespace,:key,:cashFlowId)
      ON CONFLICT ("userId",namespace,key) DO UPDATE SET "cashFlowId"=EXCLUDED."cashFlowId"`,
      { userId, cashFlowId, ...reference },
      transaction,
    );
  }
}

async function writeRecord(
  userId: number,
  record: PrincipalImportRecord,
  transaction: Transaction,
  previous?: PrincipalStoredFlow,
) {
  const id = randomUUID();
  if (previous)
    await execute(
      'UPDATE "PersonalFinanceCashFlows" SET "supersededAt"=NOW() WHERE id=:id AND "userId"=:userId AND "supersededAt" IS NULL',
      { id: previous.id, userId },
      transaction,
    );
  await execute(
    `INSERT INTO "PersonalFinanceCashFlows" (id,"userId","accountId",date,"amountCents",type,"toAccountId",description,opening,"idempotencyKey",source,"sourceId","sourceKey","sourceFingerprint","transactionId","contributionKind",verified,evidence,"supersedesId")
    VALUES (:id,:userId,:accountId,:date,:amountCents,:type,:toAccountId,:description,:opening,:idempotencyKey,:source,:sourceId,:sourceKey,:sourceFingerprint,:transactionId,:contributionKind,:verified,CAST(:evidence AS jsonb),:supersedesId)`,
    {
      ...record,
      id,
      userId,
      amountCents: cents(record.amount),
      toAccountId: record.toAccountId ?? null,
      description: record.description ?? '',
      opening: record.opening ?? false,
      idempotencyKey: `principal:${id}`,
      sourceFingerprint: fingerprint(record),
      transactionId: record.transactionIds?.[0] ?? previous?.transactionId ?? null,
      contributionKind: record.contributionKind ?? 'unspecified',
      supersedesId: previous?.id ?? null,
      evidence: JSON.stringify({ ...record.evidence, ...(record.note ? { originalNote: record.note } : {}) }),
    },
    transaction,
  );
  if (previous)
    await execute(
      'UPDATE "PersonalFinancePrincipalReferences" SET "cashFlowId"=:id WHERE "userId"=:userId AND "cashFlowId"=:previous',
      { id, userId, previous: previous.id },
      transaction,
    );
  await references(userId, id, record, transaction);
  await audit(
    userId,
    previous ? 'principal.corrected' : 'principal.recorded',
    id,
    {
      sourceId: record.sourceId,
      sourceKey: record.sourceKey,
      previousId: previous?.id ?? null,
      transactionIds: record.transactionIds ?? [],
    },
    transaction,
  );
  return id;
}

/** Verified source cells and bank movements share the existing cash-flow ledger.
 * Revisions append; source and transaction references prevent feedback duplicates. */
export async function importPrincipalRecords(
  userId: number,
  records: PrincipalImportRecord[],
): Promise<PrincipalImportResult> {
  return lockUser(userId, async (transaction) => {
    const accounts = await getFinanceAccounts(userId, transaction);
    const result: PrincipalImportResult = { inserted: 0, duplicate: 0, corrected: 0, linked: 0, conflicts: [] };
    const seen = new Set<string>();
    for (const incoming of records) {
      const award =
        incoming.source === 'google-sheets' &&
        incoming.type === 'contribution' &&
        /\b(?:free\s+stock|stock\s+award)\b/i.test(`${incoming.note ?? ''} ${incoming.description ?? ''}`);
      const record: PrincipalImportRecord = award
        ? {
            ...incoming,
            type: 'adjustment',
            evidence: { ...incoming.evidence, basisKind: 'non-cash-award', originalSourceType: 'contribution' },
          }
        : incoming;
      validateRecord(record, accounts);
      const identity = `${record.sourceId}:${record.sourceKey}`;
      if (seen.has(identity)) fail('Duplicate principal source identity in one import');
      seen.add(identity);
      const conflict = async (reason: string, cashFlowId?: string) => {
        result.conflicts.push({
          sourceId: record.sourceId,
          sourceKey: record.sourceKey,
          reason,
          ...(cashFlowId ? { cashFlowId } : {}),
        });
        await review(
          userId,
          `source:${identity}`,
          reason,
          { incoming: record, cashFlowId: cashFlowId ?? null },
          transaction,
        );
      };
      if (!record.verified) {
        await conflict('Unverified contribution evidence');
        continue;
      }
      if (
        record.type === 'contribution' &&
        isReturnOrAwardDescription(`${record.note ?? ''} ${record.description ?? ''}`)
      ) {
        await conflict('A return, reinvestment or award is not an external cash contribution');
        continue;
      }
      if (record.transactionIds?.length) {
        const owned = await findTransactions({
          access: { accountOwner: userId },
          planned: 'exclude',
          balanceAdjustments: 'exclude',
          transfers: 'include',
          completeness: 'all',
          where: { id: { [Op.in]: record.transactionIds } },
          transaction,
        });
        const outgoing = owned.filter((row) => row.transactionType === TRANSACTION_TYPES.expense);
        const incoming = owned.filter((row) => row.transactionType === TRANSACTION_TYPES.income);
        const sumsMatch = [outgoing, incoming]
          .filter((rows) => rows.length)
          .every((rows) => rows.reduce((sum, row) => sum + row.amount.toCents(), 0) === cents(record.amount));
        if (
          owned.length !== new Set(record.transactionIds).size ||
          !sumsMatch ||
          owned.some(
            (row) =>
              row.currencyCode !== accounts.find((a) => a.id === record.accountId)!.currencyCode ||
              !hasSettledStatus({ tx: row }) ||
              row.externalData?.hold === true ||
              row.refundLinked,
          )
        )
          fail(
            'Principal transaction evidence must refer to settled, owned transactions whose directional totals match the contribution',
          );
      }
      const referenced = await read<PrincipalStoredFlow>(
        `SELECT f.* FROM "PersonalFinancePrincipalReferences" r JOIN "PersonalFinanceCashFlows" f ON f.id=r."cashFlowId" WHERE r."userId"=:userId AND r.namespace=:namespace AND r.key=:key AND f."supersededAt" IS NULL`,
        { userId, namespace: `principal-source:${record.sourceId}`, key: record.sourceKey },
        transaction,
      );
      const previous =
        referenced[0] ??
        (
          await read<PrincipalStoredFlow>(
            'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId AND "sourceId"=:sourceId AND "sourceKey"=:sourceKey AND "supersededAt" IS NULL',
            { userId, sourceId: record.sourceId, sourceKey: record.sourceKey },
            transaction,
          )
        )[0];
      if (previous) {
        if (previous.sourceFingerprint === fingerprint(record)) {
          await references(userId, previous.id, record, transaction);
          result.duplicate++;
          continue;
        }
        if (
          previous.source !== record.source ||
          previous.sourceId !== record.sourceId ||
          previous.sourceKey !== record.sourceKey
        ) {
          const matched = sameReferencedPrincipalMovement(record, flowRow(previous));
          if (matched) {
            await references(userId, previous.id, record, transaction);
            result.linked++;
            continue;
          }
          await conflict('Source changed after another source or a manual correction', previous.id);
          continue;
        }
        await writeRecord(userId, record, transaction, previous);
        result.corrected++;
        continue;
      }
      const noteId = cashFlowIdFromNote(record.note);
      const txReferenced = record.transactionIds?.length
        ? await read<PrincipalStoredFlow>(
            `SELECT DISTINCT f.* FROM "PersonalFinancePrincipalReferences" r JOIN "PersonalFinanceCashFlows" f ON f.id=r."cashFlowId" WHERE r."userId"=:userId AND r.namespace='transaction' AND r.key IN (:ids) AND f."supersededAt" IS NULL`,
            { userId, ids: record.transactionIds },
            transaction,
          )
        : [];
      const noteReferenced = noteId
        ? await read<PrincipalStoredFlow>(
            'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId AND id=:id AND "supersededAt" IS NULL',
            { userId, id: noteId },
            transaction,
          )
        : [];
      const exactRefs = [...new Map([...txReferenced, ...noteReferenced].map((flow) => [flow.id, flow])).values()];
      if (exactRefs.length > 1) {
        await conflict('Transaction evidence refers to different principal records');
        continue;
      }
      if (exactRefs.length === 1) {
        const existing = flowRow(exactRefs[0]!);
        const matched = sameReferencedPrincipalMovement(record, existing);
        const identical =
          existing.accountId === record.accountId &&
          existing.date === record.date &&
          cents(existing.amount) === cents(record.amount) &&
          existing.type === record.type &&
          existing.toAccountId === (record.toAccountId ?? null) &&
          existing.opening === Boolean(record.opening);
        if (!matched && !identical) {
          await conflict('Referenced principal amount, account or date conflicts', existing.id);
          continue;
        }
        await references(userId, existing.id, record, transaction);
        result.linked++;
        continue;
      }
      const flows = await getCashFlows(userId, transaction);
      const alreadyClaimed = await read<{ cashFlowId: string }>(
        'SELECT "cashFlowId" FROM "PersonalFinancePrincipalReferences" WHERE "userId"=:userId AND namespace=:namespace',
        { userId, namespace: `principal-source:${record.sourceId}` },
        transaction,
      );
      const claimedIds = new Set(alreadyClaimed.map((row) => row.cashFlowId));
      const matched = matchPrincipalEvidence(
        record,
        flows.filter((flow) => !claimedIds.has(flow.id)),
      );
      if (matched.ambiguous) {
        await conflict('Multiple same-amount contributions fall within the posting-date window');
        continue;
      }
      if (matched.match) {
        await references(userId, matched.match.id, record, transaction);
        result.linked++;
        continue;
      }
      if (record.opening && flows.some((flow) => flow.accountId === record.accountId && flow.opening)) {
        await conflict('An opening principal checkpoint already exists');
        continue;
      }
      await writeRecord(userId, record, transaction);
      result.inserted++;
      await execute(
        'UPDATE "PersonalFinancePrincipalReviews" SET "resolvedAt"=NOW() WHERE "userId"=:userId AND "reviewKey"=:reviewKey',
        { userId, reviewKey: `source:${identity}` },
        transaction,
      );
    }
    return result;
  });
}

export async function correctPrincipalRecord(
  userId: number,
  data: {
    cashFlowId: string;
    date: string;
    amount: number;
    description?: string;
    contributionKind?: 'employee' | 'employer' | 'unspecified';
    principalValidThrough?: string | null;
  },
) {
  return lockUser(userId, async (transaction) => {
    const previous = (
      await read<PrincipalStoredFlow>(
        'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId AND id=:id AND "supersededAt" IS NULL FOR UPDATE',
        { userId, id: data.cashFlowId },
        transaction,
      )
    )[0];
    if (!previous) fail('Active principal record not found');
    const record: PrincipalImportRecord = {
      accountId: previous.accountId,
      type: previous.type,
      toAccountId: previous.toAccountId,
      opening: previous.opening,
      date: data.date,
      amount: data.amount,
      description: data.description ?? previous.description,
      contributionKind: data.contributionKind ?? previous.contributionKind,
      source: 'manual',
      sourceId: previous.sourceId ?? 'manual-correction',
      sourceKey: previous.sourceKey ?? previous.id,
      verified: true,
      evidence: {
        ...previous.evidence,
        ...(data.principalValidThrough !== undefined ? { principalValidThrough: data.principalValidThrough } : {}),
        manualCorrectionOf: previous.id,
        previousAmountCents: Number(previous.amountCents),
        previousOriginalNote: previous.evidence?.originalNote ?? '',
        originalEvidence: previous.evidence ?? {},
      },
    };
    validateRecord(record, await getFinanceAccounts(userId, transaction));
    return { id: await writeRecord(userId, record, transaction, previous) };
  });
}

export async function savePrincipalTransferRule(userId: number, data: Omit<PrincipalTransferRule, 'id'>) {
  return lockUser(userId, async (transaction) => {
    const accounts = await getFinanceAccounts(userId, transaction);
    const destination = accounts.find((a) => a.id === data.destinationAccountId);
    const native = await read<{ id: string; currencyCode: string }>(
      'SELECT id,"currencyCode" FROM "Accounts" WHERE "userId"=:userId AND id=:id',
      { userId, id: data.sourceNativeAccountId },
      transaction,
    );
    if (
      !destination ||
      !native[0] ||
      destination.currencyCode !== native[0].currencyCode ||
      destination.balanceKind !== 'asset'
    )
      fail('Transfer rules require owned source and destination accounts in the same currency');
    if (!data.exactDescription.trim() || isReturnOrAwardDescription(data.exactDescription))
      fail('A contribution rule requires an explicit funding description, not a return or award');
    if (!isRecordedDate(data.effectiveFrom) || data.effectiveFrom < PRINCIPAL_AUTOMATION_START)
      fail('Automatic principal matching starts November 5, 2026; use the reconciliation import for older evidence');
    const canonicalDescription = normalizePrincipalDescription(data.exactDescription);
    const existing = await read<PrincipalTransferRule>(
      'SELECT * FROM "PersonalFinancePrincipalTransferRules" WHERE "userId"=:userId AND "sourceNativeAccountId"=:sourceNativeAccountId AND LOWER(BTRIM("exactDescription"))=:canonicalDescription ORDER BY id',
      { userId, sourceNativeAccountId: data.sourceNativeAccountId, canonicalDescription },
      transaction,
    );
    if (existing.some((rule) => rule.destinationAccountId !== data.destinationAccountId))
      fail('This funding description is already confirmed for another principal account, including case variants');
    const id = existing[0]?.id ?? randomUUID();
    if (existing.length) {
      await execute(
        'UPDATE "PersonalFinancePrincipalTransferRules" SET "effectiveFrom"=:effectiveFrom,"isEnabled"=:isEnabled WHERE "userId"=:userId AND id IN (:ids)',
        { userId, ids: existing.map((rule) => rule.id), effectiveFrom: data.effectiveFrom, isEnabled: data.isEnabled },
        transaction,
      );
    } else {
      await execute(
        'INSERT INTO "PersonalFinancePrincipalTransferRules" (id,"userId","sourceNativeAccountId","destinationAccountId","exactDescription","effectiveFrom","isEnabled") VALUES (:id,:userId,:sourceNativeAccountId,:destinationAccountId,:exactDescription,:effectiveFrom,:isEnabled)',
        { ...data, exactDescription: data.exactDescription.trim(), id, userId },
        transaction,
      );
    }
    await audit(userId, 'principal.transfer-rule-confirmed', id, data, transaction);
    return (
      await read<PrincipalTransferRule>(
        'SELECT * FROM "PersonalFinancePrincipalTransferRules" WHERE "userId"=:userId AND id=:id',
        { userId, id },
        transaction,
      )
    )[0]!;
  });
}

export async function getPrincipalState(userId: number) {
  const [entries, rules, reviews] = await Promise.all([
    getCashFlows(userId),
    read<PrincipalTransferRule>(
      'SELECT * FROM "PersonalFinancePrincipalTransferRules" WHERE "userId"=:userId ORDER BY "createdAt",id',
      { userId },
    ),
    read(
      'SELECT id,reason,details,"createdAt" FROM "PersonalFinancePrincipalReviews" WHERE "userId"=:userId AND "resolvedAt" IS NULL ORDER BY "createdAt",id',
      { userId },
    ),
  ]);
  return { entries, rules, reviews, automaticFrom: PRINCIPAL_AUTOMATION_START };
}

export async function reconcileFinanceTransfers(userId: number, transactionIds?: string[]) {
  const accounts = await getFinanceAccounts(userId);
  const rules = await read<PrincipalTransferRule>(
    'SELECT * FROM "PersonalFinancePrincipalTransferRules" WHERE "userId"=:userId AND "isEnabled"',
    { userId },
  );
  const nativeMappings = await read<{
    bankHistoryMappings: Array<{ sourceAccountIds: string[]; nativeAccountIds: string[] }>;
  }>('SELECT "bankHistoryMappings" FROM "PersonalFinanceSettings" WHERE "userId"=:userId', { userId });
  const nativeCategories = await read<{ id: string; accountCategory: string }>(
    'SELECT id,"accountCategory" FROM "Accounts" WHERE "userId"=:userId',
    { userId },
  );
  const map = new Map<string, Set<string>>();
  const add = (nativeId: string, reportingId: string) =>
    map.set(nativeId, (map.get(nativeId) ?? new Set()).add(reportingId));
  for (const account of accounts) for (const nativeId of account.nativeAccountIds ?? []) add(nativeId, account.id);
  for (const mapping of nativeMappings[0]?.bankHistoryMappings ?? [])
    for (const nativeId of mapping.nativeAccountIds)
      for (const reportingId of mapping.sourceAccountIds) add(nativeId, reportingId);
  const txs = await findTransactions({
    access: { accountOwner: userId },
    planned: 'exclude',
    balanceAdjustments: 'exclude',
    transfers: 'include',
    completeness: 'all',
    where: { time: { [Op.gte]: new Date('2026-10-28T00:00:00Z') } },
    order: [['time', 'ASC']],
  });
  const pairs = new Map<string, typeof txs>();
  for (const tx of txs) if (tx.transferId) pairs.set(tx.transferId, [...(pairs.get(tx.transferId) ?? []), tx]);
  const records: PrincipalImportRecord[] = [];
  let pending = 0;
  for (const tx of txs.filter((row) => row.transactionType === TRANSACTION_TYPES.expense)) {
    if (nativeCategories.find((account) => account.id === tx.accountId)?.accountCategory === 'credit-card') continue;
    if (
      !hasSettledStatus({ tx }) ||
      tx.externalData?.hold === true ||
      tx.refundLinked ||
      tx.paymentParentId ||
      isReturnOrAwardDescription(tx.note ?? '')
    )
      continue;
    const date = localDate(new Date(tx.time));
    const legs = tx.transferId ? (pairs.get(tx.transferId) ?? []) : [];
    const opposite =
      legs.length === 2
        ? legs.find(
            (row) =>
              row.id !== tx.id &&
              row.transactionType === TRANSACTION_TYPES.income &&
              row.currencyCode === tx.currencyCode &&
              row.amount.toCents() === tx.amount.toCents() &&
              hasSettledStatus({ tx: row }) &&
              row.externalData?.hold !== true &&
              !row.refundLinked &&
              !row.paymentParentId,
          )
        : undefined;
    const effectiveDate = opposite ? localDate(new Date(opposite.time)) : date;
    if (
      effectiveDate < PRINCIPAL_AUTOMATION_START ||
      (transactionIds && !transactionIds.includes(tx.id) && (!opposite || !transactionIds.includes(opposite.id)))
    )
      continue;
    const selectedRule = selectPrincipalTransferRule(rules, tx.accountId, tx.note ?? '', effectiveDate);
    if (selectedRule.conflicting) {
      await review(
        userId,
        `transaction:${tx.id}`,
        'Conflicting case variants of the confirmed funding description need review',
        {
          transactionId: tx.id,
          sourceNativeAccountId: tx.accountId,
          exactDescription: tx.note ?? '',
          amount: tx.amount.toNumber(),
          date: effectiveDate,
          currencyCode: tx.currencyCode,
        },
      );
      pending++;
      continue;
    }
    const rule = selectedRule.rule;
    if (opposite && !rule) {
      if (nativeCategories.find((account) => account.id === opposite.accountId)?.accountCategory === 'credit-card')
        continue;
      const ids = [...(map.get(tx.accountId) ?? []), ...(map.get(opposite.accountId) ?? [])];
      if (
        !ids.some((id) =>
          accounts.some((a) => a.id === id && ['savings', 'investments', 'retirement'].includes(a.categoryId)),
        )
      )
        continue;
    }
    if (!rule && !opposite) {
      const trackedSource = [...(map.get(tx.accountId) ?? [])].some((id) =>
        accounts.some((a) => a.id === id && ['savings', 'investments', 'retirement'].includes(a.categoryId)),
      );
      if (
        tx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer &&
        (trackedSource ||
          /^(?:M1|PUBLIC(?:\.COM)?|ROBINHOOD(?: FINANCIAL| SECURITIES)?)$|^(?:Withdrawal to|Deposit from).*(?:Fund|Saving)/i.test(
            tx.note ?? '',
          ))
      ) {
        await review(
          userId,
          `transaction:${tx.id}`,
          'An unpaired own-account transfer needs a confirmed principal destination',
          {
            transactionId: tx.id,
            sourceNativeAccountId: tx.accountId,
            exactDescription: tx.note ?? '',
            amount: tx.amount.toNumber(),
            date: effectiveDate,
            currencyCode: tx.currencyCode,
            sourceAccountIds: [...(map.get(tx.accountId) ?? [])],
            destinationAccountIds: [],
          },
        );
        pending++;
      }
      continue;
    }
    if (
      await TransactionSplits.count({
        where: { transactionId: { [Op.in]: [tx.id, ...(opposite ? [opposite.id] : [])] } },
      })
    )
      continue;
    if (
      await countTransactions({
        access: { accountOwner: userId },
        planned: 'include',
        balanceAdjustments: 'include',
        transfers: 'include',
        where: { paymentParentId: { [Op.in]: [tx.id, ...(opposite ? [opposite.id] : [])] } },
      })
    )
      continue;
    const sourceIds = [...(map.get(tx.accountId) ?? [])];
    const destinationIds = rule ? [rule.destinationAccountId] : [...(map.get(opposite!.accountId) ?? [])];
    if (
      !sourceIds.length &&
      ['saving', 'investment', 'crypto'].includes(
        nativeCategories.find((account) => account.id === tx.accountId)?.accountCategory ?? '',
      )
    ) {
      await review(
        userId,
        `transaction:${tx.id}`,
        'An owned savings or investment source needs a reporting-account mapping before principal can move',
        {
          transactionId: tx.id,
          sourceNativeAccountId: tx.accountId,
          exactDescription: tx.note ?? '',
          amount: tx.amount.toNumber(),
          date: effectiveDate,
          currencyCode: tx.currencyCode,
          sourceAccountIds: sourceIds,
          destinationAccountIds: destinationIds,
        },
      );
      pending++;
      continue;
    }
    if (sourceIds.length > 1 || destinationIds.length !== 1) {
      await review(
        userId,
        `transaction:${tx.id}`,
        'A combined or unmapped destination needs a confirmed principal account',
        {
          transactionId: tx.id,
          sourceNativeAccountId: tx.accountId,
          exactDescription: tx.note ?? '',
          amount: tx.amount.toNumber(),
          date: effectiveDate,
          currencyCode: tx.currencyCode,
          sourceAccountIds: sourceIds,
          destinationAccountIds: destinationIds,
        },
      );
      pending++;
      continue;
    }
    const source = accounts.find((a) => a.id === sourceIds[0]);
    const destination = accounts.find((a) => a.id === destinationIds[0]);
    if (!destination || destination.currencyCode !== tx.currencyCode || destination.balanceKind !== 'asset') continue;
    if (source?.id === destination.id) continue;
    const sourceTracked = source && ['savings', 'investments', 'retirement'].includes(source.categoryId);
    const destinationTracked = ['savings', 'investments', 'retirement'].includes(destination.categoryId);
    if (!sourceTracked && !destinationTracked) continue;
    const amount = tx.amount.toNumber();
    const transactionRefs = [tx.id, ...(opposite ? [opposite.id] : [])];
    const record: PrincipalImportRecord = {
      accountId: sourceTracked ? source.id : destination.id,
      toAccountId: sourceTracked && destinationTracked ? destination.id : null,
      type: sourceTracked ? (destinationTracked ? 'transfer' : 'withdrawal') : 'contribution',
      date: effectiveDate,
      amount,
      source: 'bank-transfer',
      sourceId: 'verified-bank-transfers',
      sourceKey: tx.transferId ?? tx.id,
      transactionIds: transactionRefs,
      verified: true,
      contributionKind: 'unspecified',
      description: 'Verified movement between owned accounts; no balance or opposite transaction was invented.',
      evidence: {
        sourceNativeAccountId: tx.accountId,
        destinationNativeAccountId: opposite?.accountId ?? null,
        confirmedRuleId: rule?.id ?? null,
        nativeTransferId: tx.transferId,
        initiationDate: date,
        destinationDate: opposite ? localDate(new Date(opposite.time)) : null,
      },
    };
    if (rule && tx.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer) {
      await updateTransactions({
        access: { accountOwner: userId },
        planned: 'exclude',
        balanceAdjustments: 'exclude',
        transfers: 'exclude',
        where: { id: tx.id, transferId: null, refundLinked: false, paymentParentId: null },
        values: { transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet },
      });
    }
    records.push(record);
    await execute(
      'UPDATE "PersonalFinancePrincipalReviews" SET "resolvedAt"=NOW() WHERE "userId"=:userId AND "reviewKey"=:reviewKey',
      { userId, reviewKey: `transaction:${tx.id}` },
    );
  }
  const result = records.length
    ? await importPrincipalRecords(userId, records)
    : { inserted: 0, duplicate: 0, corrected: 0, linked: 0, conflicts: [] };
  return { ...result, pending };
}

export async function reconcileAllFinanceTransfers() {
  const users = await read<{ userId: number }>('SELECT DISTINCT "userId" FROM "PersonalFinanceAccounts"');
  for (const { userId } of users) await reconcileFinanceTransfers(userId);
}
