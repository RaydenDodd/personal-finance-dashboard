import type { IncomePaycheck } from '@bt/shared/types/income-management';
import type { PayrollImportResult, PayrollManagementInput, PayrollStatement } from '@bt/shared/types/payroll';
import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { extractTextFromFile } from '@services/import-export/statement-parser/text-extractor';
import { createHash, randomUUID } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';

import { parsePaystubText } from './import';
import { getBankIncome } from './index';
import { validateAnnualEvidence } from './payroll-annual-evidence';
import {
  buildPayrollDashboard,
  emptyPayrollDocument,
  payrollToday,
  type PayrollLedgerDocument,
} from './payroll-derivations';
import { extractAdpStatements, normalizeAdpStatement, payrollHash, payrollSourceRecord } from './payroll-normalize';

const select = <T>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<T[]> =>
  connection.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction, logging: false });
const execute = (sql: string, replacements: Record<string, unknown>, transaction: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction, logging: false });
const fail = (message: string): never => {
  throw new ValidationError({ message });
};
const asUsdAmount = (amountValue: number) => ({ amountValue, currencyCode: 'USD' });
export async function getPayrollDocument(userId: number, transaction?: Transaction): Promise<PayrollLedgerDocument> {
  const rows = await select<{ document: PayrollLedgerDocument }>(
    'SELECT document FROM "PayrollLedger" WHERE "userId"=:userId',
    { userId },
    transaction,
  );
  return rows[0]?.document ?? emptyPayrollDocument();
}
async function save(
  userId: number,
  document: PayrollLedgerDocument,
  action: string,
  audit: unknown,
  transaction: Transaction,
) {
  document.revision++;
  await execute(
    'INSERT INTO "PayrollLedger" ("userId",document) VALUES (:userId,CAST(:document AS jsonb)) ON CONFLICT ("userId") DO UPDATE SET document=EXCLUDED.document,"updatedAt"=NOW()',
    { userId, document: JSON.stringify(document) },
    transaction,
  );
  await execute(
    'INSERT INTO "PayrollLedgerAudit" (id,"userId",action,details) VALUES (:id,:userId,:action,CAST(:details AS jsonb))',
    { id: randomUUID(), userId, action, details: JSON.stringify(audit) },
    transaction,
  );
  return document.revision;
}
async function locked<T>(
  userId: number,
  callback: (document: PayrollLedgerDocument, transaction: Transaction) => Promise<T>,
) {
  return connection.sequelize.transaction(async (transaction: Transaction) => {
    await execute('SELECT pg_advisory_xact_lock(71419,:userId)', { userId }, transaction);
    return callback(await getPayrollDocument(userId, transaction), transaction);
  });
}
const checkRevision = (document: PayrollLedgerDocument, revision: number) => {
  if (revision !== document.revision) fail('Payroll data changed in another window. Reload and preview again.');
};
export async function getPayrollDashboard(
  userId: number,
  options: {
    from?: string;
    through?: string;
    aggregation?: 'paycheck' | 'monthly' | 'quarterly' | 'yearly';
    employmentId?: string;
  } = {},
) {
  const [document, bank] = await Promise.all([getPayrollDocument(userId), getBankIncome(userId)]),
    today = payrollToday();
  if (options.employmentId && !document.employments.some((e) => e.id === options.employmentId))
    fail('Employment was not found');
  return buildPayrollDashboard(document, bank, {
    ...options,
    from: options.from ?? today.slice(0, 4) + '-01-01',
    through: options.through ?? today,
  });
}
export async function savePayrollManagement(userId: number, input: PayrollManagementInput) {
  return locked(userId, async (document, transaction) => {
    checkRevision(document, input.revision);
    if (
      new Set(input.employments.map((e) => e.id)).size !== input.employments.length ||
      new Set(input.manualSalaryEvents.map((e) => e.id)).size !== input.manualSalaryEvents.length
    )
      fail('Employment and salary IDs must be unique');
    const ids = new Set(input.employments.map((e) => e.id));
    if (document.statements.some((s) => !ids.has(s.employmentId)))
      fail('An employment with payroll statements cannot be removed. Retain it as previous employment.');
    if (input.manualSalaryEvents.some((e) => !ids.has(e.employmentId)))
      fail('Salary events must reference an existing employment');
    if (input.annualEvidence) {
      if (input.annualEvidence.some((e) => !ids.has(e.employmentId)))
        fail('Historical evidence must reference an existing employment');
      const error = validateAnnualEvidence(input.annualEvidence, document.statements);
      if (error) fail(error);
    }
    const before = {
      employments: document.employments,
      manualSalaryEvents: document.manualSalaryEvents,
      settings: document.settings,
      annualEvidence: document.annualEvidence ?? [],
    };
    if (input.settings.reminderDays !== document.settings.reminderDays)
      input.settings = { ...input.settings, reminderDismissed: false };
    document.employments = input.employments;
    document.manualSalaryEvents = input.manualSalaryEvents.map((e) => ({ ...e, source: 'manual' }));
    document.settings = input.settings;
    if (input.annualEvidence) document.annualEvidence = input.annualEvidence;
    await save(
      userId,
      document,
      'payroll.management',
      {
        before,
        after: {
          employments: document.employments,
          manualSalaryEvents: document.manualSalaryEvents,
          settings: document.settings,
          annualEvidence: document.annualEvidence ?? [],
        },
      },
      transaction,
    );
    return { revision: document.revision };
  });
}
/** Statement identity is source + employment + provider statement ID, not paycheck date. */
export function partitionPayrollImport(
  document: PayrollLedgerDocument,
  rawStatements: Record<string, unknown>[],
  employmentId: string,
  source: string,
  now = new Date().toISOString(),
) {
  const employment = document.employments.find((e) => e.id === employmentId);
  if (!employment) fail('Create or select the verified employment before importing payroll');
  const accepted: { statement: PayrollStatement; raw: Record<string, unknown>; previous?: PayrollStatement }[] = [],
    issues: string[] = [];
  let duplicates = 0,
    rejected = 0;
  const identities = new Map<string, Record<string, unknown>[]>();
  for (const raw of rawStatements) {
    const key = typeof raw.statementId === 'string' ? raw.statementId.trim() : '';
    identities.set(key, [...(identities.get(key) ?? []), raw]);
  }
  for (const group of identities.values()) {
    if (new Set(group.map((r) => payrollHash(payrollSourceRecord(r)))).size > 1) {
      rejected += group.length;
      issues.push('Conflicting versions of one statement occur in this file. Import a verified current version.');
      continue;
    }
    const raw = group[0]!;
    // A full MyADP export can contain several employments; never copy already-associated statements into the selected employer.
    if (
      document.statements.some(
        (s) =>
          s.source === source &&
          s.statementId === String(raw.statementId ?? '').trim() &&
          s.employmentId !== employmentId,
      )
    ) {
      duplicates += group.length;
      issues.push('Previously associated statements for another employment were left with their verified employer');
      continue;
    }
    try {
      const normalized = normalizeAdpStatement(raw, employment!, source, now);
      const previous = document.statements.find(
        (s) => s.employmentId === employmentId && s.source === source && s.statementId === normalized.statementId,
      );
      if (previous?.sourceHash === normalized.sourceHash) duplicates += group.length;
      else {
        if (previous) {
          normalized.id = previous.id;
          normalized.version = previous.version + 1;
          normalized.depositIds = [...previous.depositIds];
        }
        accepted.push({ statement: normalized, raw: payrollSourceRecord(raw), previous });
        duplicates += group.length - 1;
      }
    } catch (error) {
      rejected += group.length;
      issues.push(error instanceof Error ? error.message : 'Invalid payroll statement');
    }
  }
  return { accepted, duplicates, rejected, issues: [...new Set(issues)] };
}
export async function importPayroll(
  userId: number,
  input: { employmentId: string; source: string; content: string; revision: number; previewOnly: boolean },
): Promise<PayrollImportResult> {
  let raw: Record<string, unknown>[];
  try {
    raw = extractAdpStatements(input.content);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid payroll file');
  }
  return locked(userId, async (document, transaction) => {
    checkRevision(document, input.revision);
    const now = new Date().toISOString(),
      partition = partitionPayrollImport(document, raw, input.employmentId, input.source, now);
    const inserted = partition.accepted.filter((s) => !s.previous).length,
      updated = partition.accepted.length - inserted;
    const result: PayrollImportResult = {
      inserted,
      updated,
      duplicates: partition.duplicates,
      rejected: partition.rejected,
      issues: partition.issues,
      previewOnly: input.previewOnly,
      revision: document.revision,
      statements: partition.accepted.map((s) => s.statement),
    };
    if (input.previewOnly) return result;
    // Complete input rejection cannot reset the reminder or create a successful import history.
    if (!partition.accepted.length && !partition.duplicates)
      fail(partition.issues.join('; ') || 'No valid payroll statements were found');
    const bank = await getBankIncome(userId, transaction);
    for (const row of partition.accepted) {
      if (row.previous) {
        document.revisions.push({
          statementId: row.previous.id,
          replacedAt: now,
          statement: row.previous,
          raw: document.sources[row.previous.id] ?? {},
        });
        const linked = bank.filter((b) => row.statement.depositIds.includes(b.id));
        if (
          linked.length !== row.statement.depositIds.length ||
          Math.round(linked.reduce((sum, b) => sum + b.amount, 0) * 100) !== Math.round(row.statement.totals.net * 100)
        ) {
          row.statement.depositIds = [];
          row.statement.issues.push(
            'A corrected net amount requires deposit reconciliation again; prior links remain in revision history',
          );
        }
        document.statements[document.statements.findIndex((s) => s.id === row.previous!.id)] = row.statement;
      } else document.statements.push(row.statement);
      document.sources[row.statement.id] = row.raw;
    }
    if (document.statements.length > 10000) fail('Payroll record limit reached');
    const run = {
      id: randomUUID(),
      at: now,
      source: input.source,
      employmentId: input.employmentId,
      inserted,
      updated,
      duplicates: partition.duplicates,
      rejected: partition.rejected,
      issues: partition.issues,
      fileHash: payrollHash(raw.map(payrollSourceRecord)),
    };
    document.imports.push(run);
    // A partially rejected import is recorded, but does not claim successful completeness.
    if (!partition.rejected) document.settings = { ...document.settings, snoozedUntil: null, reminderDismissed: false };
    result.revision = await save(userId, document, 'payroll.import', run, transaction);
    return result;
  });
}
export async function linkPayrollDeposits(
  userId: number,
  input: { revision: number; statementId: string; depositIds: string[] },
) {
  return locked(userId, async (document, transaction) => {
    checkRevision(document, input.revision);
    const statement = document.statements.find((s) => s.id === input.statementId);
    if (!statement) fail('Payroll statement was not found');
    if (new Set(input.depositIds).size !== input.depositIds.length) fail('Deposit IDs must be unique');
    const used = new Set(document.statements.filter((s) => s.id !== input.statementId).flatMap((s) => s.depositIds));
    if (input.depositIds.some((id) => used.has(id))) fail('A bank deposit cannot explain more than one paycheck');
    const bank = await getBankIncome(userId, transaction),
      deposits = bank.filter((b) => input.depositIds.includes(b.id));
    if (deposits.length !== input.depositIds.length)
      fail('Select only your own posted non-transfer USD income transactions');
    if (
      deposits.length &&
      (deposits.some((b) => Math.abs(Date.parse(b.date) - Date.parse(statement!.payDate)) > 7 * 86400000) ||
        Math.round(deposits.reduce((sum, b) => sum + b.amount, 0) * 100) !== Math.round(statement!.totals.net * 100))
    )
      fail('Linked deposits must total the paycheck net and post within seven days');
    const before = [...statement!.depositIds];
    statement!.depositIds = input.depositIds;
    await save(
      userId,
      document,
      'payroll.deposits',
      { statementId: statement!.id, before, after: input.depositIds },
      transaction,
    );
    return { revision: document.revision };
  });
}
export async function updatePayrollReminder(userId: number, action: 'snooze' | 'dismiss') {
  return locked(userId, async (document, transaction) => {
    if (action === 'snooze') document.settings.snoozedUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    else document.settings.reminderDismissed = true;
    await save(userId, document, 'payroll.reminder', { action }, transaction);
    return { revision: document.revision, settings: document.settings };
  });
}
/** Local draft extraction only; a human must verify the current-period fields before saving. */
export async function parsePayrollPdf(userId: number, employmentId: string, content: string) {
  const document = await getPayrollDocument(userId);
  if (!document.employments.some((e) => e.id === employmentId)) fail('Employment was not found');
  const buffer = Buffer.from(content, 'base64');
  if (buffer.length > 6_000_000 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
    fail('Provide a PDF of at most 6 MB');
  const extracted = await extractTextFromFile({ buffer, fileType: 'pdf' });
  if (!extracted.success || !extracted.text)
    fail('This PDF has no locally extractable text. Enter a reviewed paycheck manually or use ADP JSON.');
  const parsed = parsePaystubText(extracted.text!, employmentId);
  return {
    ...parsed,
    text: undefined,
    documentHash: createHash('sha256').update(buffer).digest('hex'),
    revision: document.revision,
  };
}
export async function importReviewedPayroll(
  userId: number,
  input: {
    employmentId: string;
    revision: number;
    record: IncomePaycheck;
    documentHash: string | null;
    previewOnly: boolean;
    reviewConfirmed: boolean;
  },
): Promise<PayrollImportResult> {
  if (!input.reviewConfirmed) fail('Review the current-period fields against the source before importing');
  if (input.record.gross === null)
    fail('Enter verified current gross pay before saving. Do not substitute a YTD amount.');
  if (input.record.evidence !== 'actual') fail('Projected paychecks belong in Projected Income');
  return locked(userId, async (document, transaction) => {
    checkRevision(document, input.revision);
    const employment = document.employments.find((e) => e.id === input.employmentId);
    if (!employment) fail('Employment was not found');
    const record = input.record,
      source = record.source === 'pdf' ? 'pdf-reviewed' : 'manual-reviewed';
    if (source === 'pdf-reviewed' && !input.documentHash) fail('PDF imports require the original document fingerprint');
    const statementId = record.sourceKey || input.documentHash || record.id;
    const previous = document.statements.find(
      (s) => s.employmentId === input.employmentId && s.source === source && s.statementId === statementId,
    );
    const supplied = { record, documentHash: input.documentHash },
      sourceHash = payrollHash(supplied);
    const similar = document.statements.find(
      (s) =>
        s.employmentId === input.employmentId &&
        s.id !== previous?.id &&
        s.payDate === record.date &&
        s.totals.gross === record.gross &&
        s.totals.net === record.net,
    );
    if (similar)
      fail(
        'A paycheck with this employer, date, gross and net is already present. Review the existing statement instead of duplicating it.',
      );
    const taxNames = {
      federal: 'Federal Income Tax',
      state: 'State Income Tax',
      local: 'Local Income Tax',
      socialSecurity: 'Social Security Tax',
      medicare: 'Medicare Tax',
    };
    const raw = {
      statementId,
      payDate: record.date,
      payPeriod: { startDate: record.periodStart, endDate: record.periodEnd },
      grossPayAmount: asUsdAmount(record.gross!),
      netPayAmount: asUsdAmount(record.net),
      earnings: [{ earningCodeName: 'Reviewed earnings', earningAmount: asUsdAmount(record.gross!) }],
      deductions: [
        ...Object.entries(taxNames).map(([key, CodeName]) => ({
          CodeName,
          deductionAmount: asUsdAmount(-record[key as keyof typeof taxNames]),
        })),
        ...record.deductions.map((d) => ({
          CodeName: d.name,
          deductionAmount: asUsdAmount(-d.amount),
          preTaxIndicator: d.treatment === 'pre-tax',
          deductionCategoryCodeName: /401|retire/i.test(d.name) ? 'Retirement' : 'Other',
        })),
      ],
    };
    const statement = normalizeAdpStatement(raw, employment!, source);
    statement.sourceHash = sourceHash;
    statement.totals.bonus = record.bonus;
    statement.totals.employerRetirement = record.employerContributions;
    statement.totals.totalCompensation = record.gross! + record.employerContributions;
    statement.allocations.employerRetirement = record.employerContributions;
    statement.incompleteFields = ['regularRate', 'regularEarnings', 'employerContributionSplit'];
    if (!record.withholdingComplete) statement.incompleteFields.push('withholding');
    statement.issues.push(
      'Manually reviewed payroll; missing detail is not evidence of zero. Employer retirement split and regular pay rate remain unavailable.',
    );
    if (record.notes) statement.issues.push(record.notes.slice(0, 2000));
    if (previous) {
      statement.id = previous.id;
      statement.version = previous.version + 1;
      statement.depositIds = [...previous.depositIds];
    }
    const duplicate = previous?.sourceHash === sourceHash;
    const result: PayrollImportResult = {
      inserted: !previous ? 1 : 0,
      updated: previous && !duplicate ? 1 : 0,
      duplicates: duplicate ? 1 : 0,
      rejected: 0,
      issues: statement.issues,
      previewOnly: input.previewOnly,
      revision: document.revision,
      statements: duplicate ? [] : [statement],
    };
    if (input.previewOnly) return result;
    if (!duplicate) {
      if (statement.depositIds.length) {
        const bank = await getBankIncome(userId, transaction);
        const linked = bank.filter((b) => statement.depositIds.includes(b.id));
        if (
          linked.length !== statement.depositIds.length ||
          Math.round(linked.reduce((sum, b) => sum + b.amount, 0) * 100) !== Math.round(statement.totals.net * 100)
        ) {
          statement.depositIds = [];
          statement.issues.push('Corrected net pay requires bank deposit reconciliation again');
        }
      }
      if (previous) {
        document.revisions.push({
          statementId: previous.id,
          replacedAt: new Date().toISOString(),
          statement: previous,
          raw: document.sources[previous.id] ?? {},
        });
        document.statements[document.statements.findIndex((s) => s.id === previous.id)] = statement;
      } else document.statements.push(statement);
      document.sources[statement.id] = { ...supplied, reviewConfirmed: true };
    }
    if (document.statements.length > 10000) fail('Payroll record limit reached');
    const run = {
      id: randomUUID(),
      at: new Date().toISOString(),
      source,
      employmentId: input.employmentId,
      inserted: result.inserted,
      updated: result.updated,
      duplicates: result.duplicates,
      rejected: 0,
      issues: statement.issues,
      fileHash: input.documentHash ?? sourceHash,
    };
    document.imports.push(run);
    result.revision = await save(userId, document, 'payroll.reviewed-import', run, transaction);
    return result;
  });
}
