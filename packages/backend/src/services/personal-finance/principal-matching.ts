import { cents } from './calculations';
import type { PrincipalImportRecord } from './principal-types';
import type { FinanceCashFlow } from './types';

export const PRINCIPAL_AUTOMATION_START = '2026-11-05';
export const PRINCIPAL_POSTING_WINDOW_DAYS = 7;

export function isRecordedDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function principalRecordFingerprintInput(record: PrincipalImportRecord) {
  return {
    accountId: record.accountId,
    date: record.date,
    amountCents: cents(record.amount),
    type: record.type,
    toAccountId: record.toAccountId ?? null,
    opening: record.opening ?? false,
    contributionKind: record.contributionKind ?? 'unspecified',
    verified: record.verified,
    description: record.description ?? '',
    note: record.note ?? '',
    evidence: record.evidence ?? {},
  };
}

/** Only cross-source records can be matched by amount/date. Two equal deposits
 * in the same source remain two deposits. Ambiguous candidates require review. */
export function matchPrincipalEvidence(record: PrincipalImportRecord, flows: FinanceCashFlow[]) {
  const candidates = flows.filter(
    (flow) =>
      !record.opening &&
      !flow.opening &&
      flow.accountId === record.accountId &&
      flow.type === record.type &&
      (flow.toAccountId ?? null) === (record.toAccountId ?? null) &&
      cents(flow.amount) === cents(record.amount) &&
      flow.source !== record.source &&
      flow.verified !== false &&
      Math.abs(Date.parse(flow.date) - Date.parse(record.date)) <= PRINCIPAL_POSTING_WINDOW_DAYS * 86400000 &&
      (flow.contributionKind ?? 'unspecified') === (record.contributionKind ?? 'unspecified'),
  );
  const possibleCombined = flows.filter(
    (flow) =>
      !flow.opening &&
      flow.accountId === record.accountId &&
      flow.type === record.type &&
      (flow.toAccountId ?? null) === (record.toAccountId ?? null) &&
      flow.source !== record.source &&
      flow.verified !== false &&
      Math.abs(Date.parse(flow.date) - Date.parse(record.date)) <= PRINCIPAL_POSTING_WINDOW_DAYS * 86400000,
  );
  const combinedMatch =
    possibleCombined.length > 1 &&
    possibleCombined.reduce((sum, flow) => sum + cents(flow.amount), 0) === cents(record.amount);
  return {
    match: candidates.length === 1 && !combinedMatch ? candidates[0]! : null,
    ambiguous: candidates.length > 1 || combinedMatch,
  };
}

export function sameReferencedPrincipalMovement(record: PrincipalImportRecord, flow: FinanceCashFlow): boolean {
  return (
    flow.accountId === record.accountId &&
    flow.type === record.type &&
    (flow.toAccountId ?? null) === (record.toAccountId ?? null) &&
    cents(flow.amount) === cents(record.amount) &&
    flow.opening === Boolean(record.opening) &&
    (flow.contributionKind ?? 'unspecified') === (record.contributionKind ?? 'unspecified') &&
    Math.abs(Date.parse(flow.date) - Date.parse(record.date)) <=
      (flow.opening ? 0 : PRINCIPAL_POSTING_WINDOW_DAYS * 86400000)
  );
}

export function cashFlowIdFromNote(note: string | undefined): string | null {
  return (
    /MoneyMatter cash-flow:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s|$)/i.exec(
      note ?? '',
    )?.[1] ?? null
  );
}

/** Non-cash awards, interest and reinvested distributions must never become a
 * new external cash contribution from transaction matching. */
export function isReturnOrAwardDescription(note: string): boolean {
  return /\b(?:dividend|reinvest(?:ment|ed)?|interest|free\s+stock|stock\s+award|reward|cashback)\b/i.test(note);
}
