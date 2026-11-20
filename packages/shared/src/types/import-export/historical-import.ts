/** Evidence retained on the canonical transaction, alongside existing importDetails. */
export interface HistoricalTransactionSource {
  key: string;
  fileName: string;
  fileHash: string;
  sheet: string;
  row: number;
  institution: string;
  accountHint?: string;
  bankId?: string;
  category?: string;
  transactionDate: string;
  postedDate?: string;
  /** Evidence only. This must never be applied to Accounts or Balances. */
  balanceCents?: number;
}

export interface HistoricalTransactionRow {
  accountId: string;
  date: string;
  postedDate?: string;
  signedAmountCents: number;
  description: string;
  source: HistoricalTransactionSource;
  categoryId?: string;
  mcc?: string;
  /** Explicitly recognized one-sided internal movement; never creates another leg. */
  isTransfer?: boolean;
  /** Use the existing refund ledger. A missing original stays explicitly unlinked. */
  isRefund?: boolean;
  refundForTransactionId?: string;
  refundForSourceKey?: string;
  /** Explicit source/account/classification uncertainty: preserve it in the preview, never insert. */
  reviewReason?: string;
}

export interface HistoricalMatchCandidate {
  id: string;
  accountId: string;
  date: string;
  postedDate?: string;
  signedAmountCents: number;
  description: string;
  originalId?: string | null;
  isPending?: boolean;
  sources?: HistoricalTransactionSource[];
}

export interface HistoricalRowDecision {
  rowIndex: number;
  action: 'new' | 'existing' | 'source-duplicate' | 'review';
  reason: string;
  transactionId?: string;
  candidateIds?: string[];
}
