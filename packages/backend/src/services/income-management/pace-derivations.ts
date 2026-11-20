import { calculateIncomePlan } from '@bt/shared/finance-income';
import type { IncomeDocument, IncomePlanPace } from '@bt/shared/types/income-management';
import { isReturnOrAwardDescription } from '@services/personal-finance/principal-matching';
import type { FinanceAccount } from '@services/personal-finance/types';
export interface FundingAccount {
  id: string;
  name: string;
  category: string;
  excluded: boolean;
}
export interface FundingTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  type: string;
  note: string;
  transferId: string | null;
  nature: string;
}
export interface FundingEvent {
  id: string;
  date: string;
  amount: number;
  accountId: string;
  description: string;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const saving = (category: string) =>
  ['saving', 'savings', 'investment', 'investments', 'crypto', 'retirement'].includes(category);
/** Count money crossing the savings/investment boundary, never both bank legs or a purchase inside it. */
export function buildFundingEvents(
  accounts: FundingAccount[],
  reporting: Pick<FinanceAccount, 'categoryId' | 'nativeAccountId' | 'nativeAccountIds' | 'included'>[],
  txs: FundingTransaction[],
): FundingEvent[] {
  const eligible = new Set(accounts.filter((a) => !a.excluded && saving(a.category)).map((a) => a.id));
  const boundary = new Set(accounts.filter((a) => saving(a.category)).map((a) => a.id));
  for (const a of reporting.filter((a) => a.included && saving(a.categoryId)))
    for (const id of [...(a.nativeAccountIds ?? []), ...(a.nativeAccountId ? [a.nativeAccountId] : [])])
      if (!accounts.find((n) => n.id === id)?.excluded) {
        eligible.add(id);
        boundary.add(id);
      }
  const valid = txs.filter(
    (t) =>
      t.nature !== 'not_transfer' &&
      !accounts.find((a) => a.id === t.accountId)?.category.includes('credit-card') &&
      !/\b(?:rollover|401\(?k\)?|pension)\b/i.test(
        t.note + ' ' + (accounts.find((a) => a.id === t.accountId)?.name ?? ''),
      ) &&
      !isReturnOrAwardDescription(t.note) &&
      !/\b(?:buy|bought|purchase|sell|sold|sale|fee|commission)\b/i.test(t.note),
  );
  const suffix = (note: string, ownAccountId?: string) =>
    accounts.find((a) => {
      if (a.id === ownAccountId) return false;
      const n = /\((\d{4})\)\s*$/.exec(a.name)?.[1];
      return n && new RegExp('(?:X+|\\b)' + n + '\\b', 'i').test(note);
    });
  const target = (note: string, ownAccountId: string) => {
    const exact = suffix(note, ownAccountId);
    if (exact) return exact.id;
    const merchant = /^(M1|ROBINHOOD(?: FINANCIAL| SECURITIES)?|PUBLIC(?:\.COM)?)$/i
      .exec(note.trim())?.[1]
      ?.toLowerCase()
      .split(' ')[0]
      ?.replace(/\.com$/, '');
    if (!merchant) return null;
    const candidates = accounts.filter(
      (a) => boundary.has(a.id) && a.name.toLowerCase().includes(merchant) && !/crypto/i.test(a.name),
    );
    return candidates.length === 1 ? candidates[0]!.id : candidates.length ? null : 'provider:' + merchant;
  };
  const events: FundingEvent[] = [];
  const used = new Set<string>();
  for (const t of valid) {
    if (used.has(t.id) || t.type !== 'expense') continue;
    const linked = t.transferId
      ? valid.find((o) => o.id !== t.id && o.transferId === t.transferId && o.type === 'income')
      : undefined;
    const to = linked?.accountId ?? target(t.note, t.accountId);
    if (!to) continue;
    const fromSaved = boundary.has(t.accountId),
      toSaved = boundary.has(to) || to.startsWith('provider:');
    const opposite =
      linked ??
      valid
        .filter(
          (o) =>
            !used.has(o.id) &&
            o.type === 'income' &&
            o.accountId === to &&
            Math.round(o.amount * 100) === Math.round(t.amount * 100) &&
            Math.abs(Date.parse(o.date) - Date.parse(t.date)) <= 7 * 86400000 &&
            (!suffix(o.note, o.accountId) || suffix(o.note, o.accountId)?.id === t.accountId),
        )
        .toSorted(
          (a, b) =>
            Math.abs(Date.parse(a.date) - Date.parse(t.date)) - Math.abs(Date.parse(b.date) - Date.parse(t.date)) ||
            a.id.localeCompare(b.id),
        )[0];
    if (opposite) used.add(opposite.id);
    used.add(t.id);
    if (
      fromSaved === toSaved ||
      (fromSaved && !eligible.has(t.accountId)) ||
      (toSaved && !eligible.has(to) && !to.startsWith('provider:'))
    )
      continue;
    events.push({
      id: t.id,
      date: opposite?.date ?? t.date,
      amount: round(t.amount * (toSaved ? 1 : -1)),
      accountId: toSaved ? to : t.accountId,
      description: t.note,
    });
  }
  for (const t of valid) {
    if (used.has(t.id) || !eligible.has(t.accountId)) continue;
    if (t.type === 'income' && /\b(?:deposit|transfer|contribution|funding)\b/i.test(t.note)) {
      if (boundary.has(suffix(t.note, t.accountId)?.id ?? '')) continue;
      events.push({ id: t.id, date: t.date, amount: round(t.amount), accountId: t.accountId, description: t.note });
    } else if (t.type === 'expense' && /\b(?:withdrawal|transfer out|withdrawn)\b/i.test(t.note)) {
      if (boundary.has(suffix(t.note, t.accountId)?.id ?? '')) continue;
      events.push({ id: t.id, date: t.date, amount: -round(t.amount), accountId: t.accountId, description: t.note });
    }
  }
  return events.toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function buildPlanPace(
  document: IncomeDocument,
  income: { date: string; amount: number }[],
  funding: FundingEvent[],
  from: string,
  through: string,
  today: string,
  coverage: string | null,
) {
  const plans = document.plans
    .filter((p) => p.evidence !== 'projected')
    .toSorted((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''));
  const current = plans
    .filter((p) => (!p.effectiveFrom || p.effectiveFrom <= today) && (!p.effectiveTo || p.effectiveTo >= today))
    .at(-1);
  const benchmark = current ? calculateIncomePlan(current.input) : null;
  const actualIncome = new Map<string, number>(),
    savings = new Map<string, number>();
  for (const x of income) actualIncome.set(x.date, (actualIncome.get(x.date) ?? 0) + x.amount);
  for (const x of funding) savings.set(x.date, (savings.get(x.date) ?? 0) + x.amount);
  const points: IncomePlanPace['points'] = [];
  let received = 0,
    saved = 0,
    plannedIncome = 0,
    plannedSavings = 0;
  for (let day = Date.parse(from); day <= Date.parse(through); day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10),
      year = Number(date.slice(0, 4));
    // Match the Income page's annual / 12 monthly budget, including February and leap years.
    const days = 12 * new Date(Date.UTC(year, Number(date.slice(5, 7)), 0)).getUTCDate();
    const result = benchmark?.available ? benchmark : null;
    if (result) {
      plannedIncome += result.annual.takeHome! / days;
      plannedSavings +=
        (result.annual.savings! +
          result.annual.investments! +
          result.annual.traditionalIra +
          result.annual.rothIra +
          (current!.input.hsaThroughPayroll ? 0 : result.annual.hsa)) /
        days;
    }
    received += actualIncome.get(date) ?? 0;
    saved += savings.get(date) ?? 0;
    const known = coverage !== null && date >= coverage && date <= today;
    points.push({
      date,
      income: known ? round(received) : null,
      savings: known ? round(saved) : null,
      plannedIncome: result ? round(plannedIncome) : null,
      plannedSavings: result ? round(plannedSavings) : null,
    });
  }
  return {
    from,
    through,
    today,
    coverageFrom: coverage,
    planName: current?.name ?? null,
    planBasis:
      'Current Income plan: monthly allocations spread evenly over each month. Income is paycheck take-home; savings is outside-payroll funding. This is a budget benchmark, not historical salary or a payday prediction.',
    points,
    funding: funding.filter((e) => e.date >= from && e.date <= through && e.date <= today),
    savingsBasis:
      'Net new money transferred to savings and investment accounts, including emergency, car and travel funds and brokerage funding. Withdrawals reduce savings. Transfers within those accounts, security trades, reinvested dividends, interest and market growth are excluded. Payroll retirement contributions are separate.',
  };
}
