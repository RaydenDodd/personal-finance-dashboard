import type { BankIncomeRow, IncomeDocument, IncomePaycheck, IncomePeriod } from '@bt/shared/types/income-management';
import { createHash } from 'node:crypto';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const emptyIncomeDocument = (): IncomeDocument => ({ revision: 0, employers: [], paychecks: [], plans: [] });
export function reconcileIncome(
  document: IncomeDocument,
  bankIncome: BankIncomeRow[],
  from: string,
  through: string,
  granularity: 'biweekly' | 'monthly' | 'yearly' | 'daily' = 'monthly',
) {
  const effectiveDate = (p: IncomePaycheck) =>
    bankIncome.find((bank) => bank.id === p.nativeTransactionId)?.date ?? p.date;
  const actual = document.paychecks.filter(
    (p) => p.evidence === 'actual' && effectiveDate(p) >= from && effectiveDate(p) <= through,
  );
  const claimed = new Set(document.paychecks.map((p) => p.nativeTransactionId).filter(Boolean));
  const reconciliation = actual
    .filter((p) => !p.nativeTransactionId)
    .map((p) => ({
      paycheckId: p.id,
      candidates: bankIncome.filter(
        (b) =>
          !claimed.has(b.id) &&
          Math.round(b.amount * 100) === Math.round(p.net * 100) &&
          Math.abs(Date.parse(b.date) - Date.parse(p.date)) <= 7 * 86_400_000,
      ),
    }));
  const held = new Set(reconciliation.filter((p) => p.candidates.length > 0).map((p) => p.paycheckId));
  const unmatched = actual.filter((p) => !p.nativeTransactionId && !held.has(p.id));
  const periods = new Map<string, IncomePeriod>();
  const period = (date: string) => {
    const key =
      granularity === 'daily'
        ? date
        : granularity === 'yearly'
          ? date.slice(0, 4) + '-01-01'
          : granularity === 'monthly'
            ? date.slice(0, 7) + '-01'
            : new Date(
                Date.UTC(1970, 0, 5) +
                  Math.floor((Date.parse(date) - Date.UTC(1970, 0, 5)) / (14 * 86_400_000)) * 14 * 86_400_000,
              )
                .toISOString()
                .slice(0, 10);
    if (!periods.has(key))
      periods.set(key, {
        date: key,
        bankNet: 0,
        manualNet: 0,
        actualNet: 0,
        gross: 0,
        bonus: 0,
        employerContributions: 0,
        federal: 0,
        state: 0,
        local: 0,
        socialSecurity: 0,
        medicare: 0,
        unknownGrossCount: 0,
      });
    return periods.get(key)!;
  };
  for (const bank of bankIncome) {
    if (bank.date < from || bank.date > through) continue;
    const p = period(bank.date);
    p.bankNet += bank.amount;
    if (!actual.some((paycheck) => paycheck.nativeTransactionId === bank.id && paycheck.gross !== null))
      p.unknownGrossCount++;
    if (!actual.some((paycheck) => paycheck.nativeTransactionId === bank.id && paycheck.withholdingComplete)) {
      for (const key of ['federal', 'state', 'local', 'socialSecurity', 'medicare'] as const) p[key] = null;
    }
  }
  for (const paycheck of actual) {
    const p = period(effectiveDate(paycheck));
    if (unmatched.some((entry) => entry.id === paycheck.id)) p.manualNet += paycheck.net;
    if (!held.has(paycheck.id)) {
      if (paycheck.gross === null) p.unknownGrossCount++;
      else p.gross = (p.gross ?? 0) + paycheck.gross;
      for (const key of ['bonus', 'employerContributions'] as const) p[key] = (p[key] ?? 0) + paycheck[key];
      for (const key of ['federal', 'state', 'local', 'socialSecurity', 'medicare'] as const)
        p[key] = !paycheck.withholdingComplete || p[key] === null ? null : p[key]! + paycheck[key];
    }
  }
  const result = [...periods.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({
      ...p,
      actualNet: round(p.bankNet + p.manualNet),
      bankNet: round(p.bankNet),
      manualNet: round(p.manualNet),
      gross: p.unknownGrossCount ? null : round(p.gross ?? 0),
      bonus: p.unknownGrossCount ? null : p.bonus,
      employerContributions: p.unknownGrossCount ? null : p.employerContributions,
    }));
  const bankNetIncome = round(
    bankIncome.filter((b) => b.date >= from && b.date <= through).reduce((sum, b) => sum + b.amount, 0),
  );
  const unmatchedManualNet = round(unmatched.reduce((sum, p) => sum + p.net, 0));
  return {
    reconciliation,
    periods: result,
    currentBehavior: {
      basis:
        'Posted native income, excluding transfers, linked refunds and excluded accounts; linked paychecks are counted once on the bank posting date. Source paycheck dates remain preserved. Gross salary and withholding cannot be inferred from bank deposits.',
      from,
      through,
      bankNetIncome,
      actualIncome: round(bankNetIncome + unmatchedManualNet),
      unmatchedManualNet,
      heldForReconciliation: held.size,
      grossKnown: result.some((p) => p.gross === null)
        ? null
        : round(result.reduce((sum, p) => sum + (p.gross ?? 0), 0)),
    },
  };
}
export function validatePaycheckLinks(paychecks: IncomePaycheck[], bankIncome: BankIncomeRow[]): string | null {
  const used = new Set<string>();
  for (const paycheck of paychecks) {
    if (!paycheck.nativeTransactionId) continue;
    if (used.has(paycheck.nativeTransactionId)) return 'A bank deposit cannot be linked to two paychecks';
    used.add(paycheck.nativeTransactionId);
    const bank = bankIncome.find((row) => row.id === paycheck.nativeTransactionId);
    if (!bank) return 'The linked deposit must be a posted, non-transfer income transaction owned by you';
    if (Math.round(bank.amount * 100) !== Math.round(paycheck.net * 100))
      return 'Linked deposit and paycheck net amount must match';
    if (Math.abs(Date.parse(bank.date) - Date.parse(paycheck.date)) > 7 * 86_400_000)
      return 'Linked deposit must post within seven days of the paycheck';
    if (paycheck.evidence !== 'actual') return 'Only actual paychecks may be linked to a bank deposit';
  }
  return null;
}
export function paycheckFingerprint(
  paycheck: Pick<IncomePaycheck, 'employerId' | 'date' | 'net' | 'gross' | 'bonus' | 'sourceKey' | 'evidence'>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        paycheck.employerId,
        paycheck.evidence,
        paycheck.date,
        Math.round(paycheck.net * 100),
        paycheck.gross === null ? null : Math.round(paycheck.gross * 100),
        Math.round(paycheck.bonus * 100),
        paycheck.sourceKey,
      ]),
    )
    .digest('hex');
}
export function partitionIncomeImport(existing: IncomePaycheck[], incoming: IncomePaycheck[]) {
  const exact = new Set(existing.map(paycheckFingerprint));
  const key = (p: IncomePaycheck) =>
    [p.employerId, p.evidence, p.sourceKey ? 'external:' + p.sourceKey : p.date + ':' + Math.round(p.net * 100)].join(
      ':',
    );
  const identities = new Set(existing.map(key));
  const accepted: IncomePaycheck[] = [];
  let duplicates = 0,
    conflicts = 0;
  for (const record of incoming) {
    const hash = paycheckFingerprint(record);
    if (exact.has(hash)) {
      duplicates++;
      continue;
    }
    if (identities.has(key(record))) {
      conflicts++;
      continue;
    }
    exact.add(hash);
    identities.add(key(record));
    accepted.push(record);
  }
  return { accepted, duplicates, conflicts };
}
