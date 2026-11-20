import type { HistoricalMatchCandidate, HistoricalRowDecision, HistoricalTransactionRow } from '@bt/shared/types';

/** Keep merchant digits (622 North and 9:30 Club are different businesses).
 * Remove only leading processor labels, never merchant or location words. */
export const normalizeHistoricalDescription = ({ description }: { description: string }): string =>
  description
    .normalize('NFKD')
    .toLowerCase()
    .replace(/^(?:(?:aplpay|tst|sq|pos)\s*[*:]?\s+|(?:tst|sq)\s*[*:]\s*)+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const dayNumber = ({ date }: { date: string }) => Date.parse(`${date}T12:00:00Z`) / 86_400_000;
const sameMerchant = ({ left, right }: { left: string; right: string }) => {
  if (!left || !right) return false;
  if (left === right) return true;
  // Statement downloads sometimes append a city/phone/terminal to the same name.
  // Require a substantial complete prefix, rather than substring or edit-distance guessing.
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 12 && longer.startsWith(`${shorter} `);
};
const datesNear = ({ row, candidate }: { row: HistoricalTransactionRow; candidate: HistoricalMatchCandidate }) =>
  [row.date, row.postedDate].some(
    (day) =>
      day &&
      [candidate.date, candidate.postedDate].some(
        (other) => other && Math.abs(dayNumber({ date: day }) - dayNumber({ date: other })) <= 3,
      ),
  );

/** Pure, conservative multiset reconciliation. A candidate may satisfy one occurrence
 * per source file. Overlapping files may cite that same canonical transaction again.
 * Newly proposed rows participate immediately, so overlap within a request is reconciled.
 * An unresolved possible duplicate never becomes a proposed insert. */
export function reconcileHistoricalRows({
  rows,
  candidates,
}: {
  rows: HistoricalTransactionRow[];
  candidates: HistoricalMatchCandidate[];
}): HistoricalRowDecision[] {
  const pool = candidates.map((candidate) => ({ ...candidate, sources: [...(candidate.sources ?? [])] }));
  const claims = new Set<string>();
  const seenSourceRows = new Map<string, HistoricalRowDecision>();
  return rows.map((row, rowIndex) => {
    const sourceIdentity = `${row.accountId}:${row.source.fileHash}:${row.source.sheet}:${row.source.row}`;
    const seen = seenSourceRows.get(sourceIdentity);
    if (seen)
      return {
        ...seen,
        rowIndex,
        action: seen.action === 'review' ? 'review' : 'source-duplicate',
        reason: 'same-source-row',
      };
    const eligible = pool.filter((candidate) => candidate.accountId === row.accountId);
    const identified = eligible.filter(
      (candidate) =>
        candidate.sources.some((source) => source.key === row.source.key) ||
        Boolean(
          row.source.bankId &&
          (candidate.originalId === row.source.bankId ||
            candidate.sources.some(
              (source) => source.bankId === row.source.bankId && source.institution === row.source.institution,
            )),
        ),
    );
    const claimKey = (candidate: HistoricalMatchCandidate) => `${row.source.fileHash}:${candidate.id}`;
    const finish = (decision: HistoricalRowDecision) => {
      seenSourceRows.set(sourceIdentity, decision);
      return decision;
    };
    const review = (reason: string, matches: HistoricalMatchCandidate[]) =>
      finish({ rowIndex, action: 'review', reason, candidateIds: matches.map((candidate) => candidate.id) });
    const match = (candidate: (typeof pool)[number], reason: string) => {
      if (candidate.isPending) return review('pending-versus-posted', [candidate]);
      const alreadyCited = claims.has(claimKey(candidate));
      claims.add(claimKey(candidate));
      if (
        !candidate.sources.some(
          (source) =>
            source.key === row.source.key && source.fileHash === row.source.fileHash && source.row === row.source.row,
        )
      )
        candidate.sources.push(row.source);
      return finish({
        rowIndex,
        action: candidate.id.startsWith('proposed:') || alreadyCited ? 'source-duplicate' : 'existing',
        transactionId: candidate.id,
        reason,
      });
    };
    if (identified.length) {
      if (identified.length !== 1) return review('conflicting-source-identifiers', identified);
      const candidate = identified[0]!;
      if (candidate.signedAmountCents !== row.signedAmountCents || !datesNear({ row, candidate }))
        return review('identifier-financial-conflict', identified);
      return match(candidate, 'source-identifier');
    }
    const amountMatches = eligible.filter(
      (candidate) => candidate.signedAmountCents === row.signedAmountCents && datesNear({ row, candidate }),
    );
    // Distinct reliable ids in the same institution prove distinct purchases.
    const comparable = amountMatches.filter(
      (candidate) =>
        !row.source.bankId ||
        !candidate.sources.some((source) => source.bankId && source.institution === row.source.institution) ||
        candidate.sources.some(
          (source) => source.bankId === row.source.bankId && source.institution === row.source.institution,
        ),
    );
    const merchant = normalizeHistoricalDescription({ description: row.description });
    const merchantMatches = comparable.filter((candidate) =>
      sameMerchant({ left: merchant, right: normalizeHistoricalDescription({ description: candidate.description }) }),
    );
    const unclaimed = merchantMatches.filter((candidate) => !claims.has(claimKey(candidate)));
    const sameDay = unclaimed.filter((candidate) => candidate.date === row.date);
    const available = sameDay.length ? sameDay : unclaimed;
    if (available.length === 1) return match(available[0]!, 'account-amount-merchant-date');
    if (available.length > 1) return review('multiple-indistinguishable-existing-records', available);
    // All exact occurrences have been consumed in this file: an additional source
    // occurrence is evidence of an additional purchase, not a duplicate of the first.
    if (!merchantMatches.length && comparable.some((candidate) => !claims.has(claimKey(candidate))))
      return review('same-amount-near-date-different-description', comparable);
    if (merchantMatches.some((candidate) => candidate.isPending))
      return review('pending-versus-posted', merchantMatches);
    const candidate = {
      id: `proposed:${rowIndex}`,
      accountId: row.accountId,
      date: row.date,
      postedDate: row.postedDate,
      signedAmountCents: row.signedAmountCents,
      description: row.description,
      sources: [row.source],
    };
    pool.push(candidate);
    claims.add(claimKey(candidate));
    return finish({
      rowIndex,
      action: 'new',
      transactionId: candidate.id,
      reason: merchantMatches.length ? 'additional-source-occurrence' : 'no-existing-evidence',
    });
  });
}
