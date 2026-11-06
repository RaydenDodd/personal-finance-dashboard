import type { FinanceAccount, FinanceCashFlow } from '@/api/personal-finance';

export function valuationSourceLabel(source?: string | null): string {
  return (
    {
      manual: 'Manual entry',
      'google-sheets': 'Google Sheets',
      csv: 'CSV import',
      simplefin: 'SimpleFIN',
      plaid: 'Plaid',
      bank: 'Bank sync',
      imported: 'Imported history',
      'bank-transfer': 'Verified bank transfer',
    }[source ?? ''] ?? 'Unknown source'
  );
}

export function accountManagementLabel(account: Pick<FinanceAccount, 'preferredSource' | 'connectionStatus'>): string {
  if (['simplefin', 'plaid'].includes(account.preferredSource)) {
    return account.connectionStatus === 'connected'
      ? 'Automatic · manual fallback available'
      : 'Manual fallback · bank connection unavailable';
  }
  return account.preferredSource === 'google-sheets' ? 'Google Sheets · manual entry available' : 'Manually managed';
}

/** Dated ledger only: returns and internal purchases do not create contributed capital. */
export function recordedPrincipal(accountId: string, flows: FinanceCashFlow[], date: string): number | null {
  const dated = flows
    .filter(
      (flow) =>
        flow.verified !== false &&
        flow.date <= date &&
        (flow.accountId === accountId || flow.toAccountId === accountId),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const opening = dated.findIndex((flow) => flow.accountId === accountId && flow.opening);
  if (opening < 0) return null;
  const validThrough = dated[opening]?.evidence?.principalValidThrough;
  if (typeof validThrough === 'string' && date > validThrough) return null;
  return (
    (dated[opening]?.evidence?.checkpoint === true
      ? [dated[opening]!, ...dated.filter((flow) => flow.date > dated[opening]!.date)]
      : dated.slice(opening)
    ).reduce((total, flow) => {
      if (flow.type === 'interest' || flow.type === 'dividend') return total;
      const amount = Math.round(flow.amount * 100);
      if (flow.type === 'transfer') return total + (flow.toAccountId === accountId ? amount : -amount);
      return total + (flow.type === 'withdrawal' ? -amount : amount);
    }, 0) / 100
  );
}
