export type AccountReferenceRelation = 'confirmed' | 'contradicted' | 'neutral';

/** A suffix is usable only when it identifies one of this user's own accounts. */
export function buildAccountSuffixes(accounts: Array<{ id: string; name: string }>): Map<string, string> {
  const suffixes = accounts.map((account) => ({ id: account.id, suffix: /\((\d{4})\)\s*$/.exec(account.name)?.[1] }));
  return new Map(
    suffixes
      .filter((account) => account.suffix && suffixes.filter((other) => other.suffix === account.suffix).length === 1)
      .map((account) => [account.id, account.suffix!]),
  );
}

function counterpartySuffix(note: string | null): string | null {
  // Require an explicit movement direction and a masked account identifier.
  // An arbitrary merchant name or a trailing four-digit number is not evidence.
  return /^(?:deposit from|withdrawal to)\s+.+?\s+[x*•]{3,}(\d{4})\s*$/i.exec(note?.trim() ?? '')?.[1] ?? null;
}

export function maskedTransferReferenceRelation({
  a,
  b,
  accountSuffixes,
}: {
  a: { accountId: string; note: string | null };
  b: { accountId: string; note: string | null };
  accountSuffixes: Map<string, string>;
}): AccountReferenceRelation {
  let confirmed = false;
  for (const [transaction, other] of [
    [a, b],
    [b, a],
  ]) {
    const reference = counterpartySuffix(transaction!.note);
    const suffix = accountSuffixes.get(other!.accountId);
    if (!reference || !suffix) continue;
    if (reference !== suffix) return 'contradicted';
    confirmed = true;
  }
  return confirmed ? 'confirmed' : 'neutral';
}
