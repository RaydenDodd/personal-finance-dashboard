/** Columnar transport of backend-calculated account values. No security histories or composition documents. */
export interface InvestmentAccountHistoryResponse {
  generatedAt: string;
  currencyCode: string;
  dates: string[];
  total: (string | null)[];
  accountsKnown: number[];
  accountsFull: number[];
  positionsPriced?: number[];
  positionsMissing?: number[];
  quantitiesUnknown?: number[];
  netFunding?: (string | null)[];
  /** Backend-calculated value minus recorded external net funding; partial evidence stays partial. */
  gains?: (string | null)[];
  /** Estimated daily-flow-weighted return over the date selection (Modified Dietz). */
  periodReturnPercent?: (string | null)[];
  periodGains?: (string | null)[];
  gainFrom?: string;
  accounts: {
    id: string;
    name: string;
    broker: string;
    accountType: string;
    isEnabled: boolean;
    firstPurchase: string | null;
    firstDate: string | null;
    lastDate: string | null;
    builtAt: string | null;
    pending: boolean;
    values: (string | null)[];
    full: boolean[];
    gains?: (string | null)[];
    /** Estimated daily-flow-weighted return over the date selection (Modified Dietz). */
    periodReturnPercent?: (string | null)[];
    periodGains?: (string | null)[];
    coverage: [number, number, number, boolean][];
    audit?: Record<string, unknown>;
  }[];
  pending: boolean;
  events?: {
    id: string;
    date: string;
    type: string;
    label: string;
    amount: string;
    portfolioId: string;
  }[];
}
