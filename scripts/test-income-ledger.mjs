import assert from 'node:assert/strict';

import {
  parseIncomeCsv,
  parsePaystubText,
  blankPaycheck,
} from '../packages/backend/src/services/income-management/import.ts';
import {
  reconcileIncome,
  validatePaycheckLinks,
  partitionIncomeImport,
} from '../packages/backend/src/services/income-management/ledger.ts';

let count = 0;
const check = (name, fn) => {
  fn();
  count++;
  console.log('PASS ' + name);
};
const bank = { id: 'bank-1', date: '2026-11-13', amount: 100, accountId: 'account', description: 'Employer payroll' };
const paycheck = {
  ...blankPaycheck('employer'),
  id: 'pay-1',
  date: '2026-11-13',
  gross: 150,
  net: 100,
  withholdingComplete: true,
  federal: 20,
  nativeTransactionId: 'bank-1',
};
const doc = (paychecks) => ({ revision: 0, employers: [], plans: [], paychecks });
const summary = (records, banks = [bank], from = '2026-01-01', through = '2026-12-31', period = 'monthly') =>
  reconcileIncome(doc(records), banks, from, through, period);
check('linked paycheck and bank deposit counted once', () => {
  const result = summary([paycheck]);
  assert.equal(result.currentBehavior.actualIncome, 100);
  assert.equal(result.periods[0].gross, 150);
  assert.equal(result.periods[0].federal, 20);
});
check('bank-only gross, taxes and contributions are unavailable', () => {
  const result = summary([]);
  assert.equal(result.periods[0].gross, null);
  assert.equal(result.periods[0].federal, null);
  assert.equal(result.periods[0].bonus, null);
  assert.equal(result.periods[0].employerContributions, null);
});
check('possible unlinked duplicate held until reviewed', () => {
  const result = summary([{ ...paycheck, nativeTransactionId: null }]);
  assert.equal(result.currentBehavior.actualIncome, 100);
  assert.equal(result.currentBehavior.heldForReconciliation, 1);
});
check('unmatched manual net adds without inventing gross', () => {
  const result = summary([{ ...paycheck, net: 50, gross: null, nativeTransactionId: null }]);
  assert.equal(result.currentBehavior.actualIncome, 150);
  assert.equal(result.currentBehavior.grossKnown, null);
});
check('estimated paychecks never added to actual', () =>
  assert.equal(
    summary([{ ...paycheck, evidence: 'estimated', nativeTransactionId: null }], []).currentBehavior.actualIncome,
    0,
  ),
);
check('linked paycheck details align to bank posting date across years', () => {
  const result = summary(
    [{ ...paycheck, date: '2026-12-31' }],
    [{ ...bank, date: '2027-01-02' }],
    '2027-01-01',
    '2027-12-31',
  );
  assert.equal(result.periods[0].date, '2027-01-01');
  assert.equal(result.periods[0].gross, 150);
  assert.equal(result.currentBehavior.actualIncome, 100);
});
check('one deposit cannot back two paychecks', () =>
  assert.ok(validatePaycheckLinks([paycheck, { ...paycheck, id: 'pay-2' }], [bank])),
);
check('foreign or missing deposits rejected', () => assert.ok(validatePaycheckLinks([paycheck], [])));
check('net mismatch rejected', () => assert.ok(validatePaycheckLinks([{ ...paycheck, net: 101 }], [bank])));
check('distant posting date rejected', () =>
  assert.ok(validatePaycheckLinks([{ ...paycheck, date: '2026-01-01' }], [bank])),
);
check('yearly grouping reconciles all deposited net', () => {
  const result = summary(
    [],
    [bank, { ...bank, id: 'bank-2', date: '2026-12-03' }],
    '2026-01-01',
    '2026-12-31',
    'yearly',
  );
  assert.equal(result.periods.length, 1);
  assert.equal(result.periods[0].actualNet, 200);
});
check('biweekly grouping preserves totals without fabricated observations', () => {
  const result = summary(
    [],
    [bank, { ...bank, id: 'bank-2', date: '2026-12-03' }],
    '2026-01-01',
    '2026-12-31',
    'biweekly',
  );
  assert.equal(
    result.periods.reduce((s, p) => s + p.actualNet, 0),
    200,
  );
  assert.equal(result.periods.length, 2);
});
check('same CSV can be reimported without duplicates', () => {
  const parsed = parseIncomeCsv('date,gross,net\n2026-11-13,150,100\n', 'employer');
  const partition = partitionIncomeImport(parsed.records, parsed.records);
  assert.equal(partition.accepted.length, 0);
  assert.equal(partition.duplicates, 1);
});
check('changed source observation held as conflict, not duplicate income', () => {
  const partition = partitionIncomeImport([paycheck], [{ ...paycheck, gross: 155 }]);
  assert.equal(partition.conflicts, 1);
  assert.equal(partition.accepted.length, 0);
});
check('actual and projected records remain separate', () => {
  const partition = partitionIncomeImport([paycheck], [{ ...paycheck, evidence: 'projected' }]);
  assert.equal(partition.accepted.length, 1);
});
check('invalid dates rejected in CSV', () => {
  const parsed = parseIncomeCsv('date,net\n2026-02-30,100\n', 'employer');
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.issues.length, 1);
});
check('PDF parser does not take YTD as current gross', () => {
  const parsed = parsePaystubText('Pay date: 11/13/2026\nYTD Gross Pay: $45000.00\nNet Pay: $100.00', 'employer');
  assert.equal(parsed.record.gross, null);
  assert.equal(parsed.record.net, 100);
  assert.equal(parsed.record.withholdingComplete, false);
  assert.ok(parsed.requiresReview);
});
check('current-period PDF values stay review drafts', () => {
  const parsed = parsePaystubText(
    'Pay date: 11/13/2026\nGross Pay: $150.00\nNet Pay: $100.00\nFederal Tax: $20.00',
    'employer',
  );
  assert.equal(parsed.record.gross, 150);
  assert.equal(parsed.record.federal, 20);
  assert.equal(parsed.record.nativeTransactionId, null);
  assert.ok(parsed.requiresReview);
});
console.log(JSON.stringify({ incomeLedgerTests: count, passed: true }));
