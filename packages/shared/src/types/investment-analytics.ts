/** Monetary/quantity values are decimal strings; null means unavailable, never zero. */
export type InvestmentDecimal = string | null;
export type InvestmentQualityStatus = 'verified' | 'partial' | 'stale' | 'unavailable';
export interface InvestmentMetric {
  value: InvestmentDecimal;
  status: InvestmentQualityStatus;
  reason?: string;
}
export interface InvestmentClassification {
  classificationSources?: Partial<Record<'sector' | 'industry', string>>;
  sector?: string;
  industry?: string;
  country?: string;
  region?: string;
  market?: string;
  marketCap?: string;
  style?: string;
  assetClass?: string;
}
export interface InvestmentPortfolio {
  calculation?: {
    securitiesValue: InvestmentDecimal;
    pricedValue: string;
    gainValue: string;
    gainBasis: string;
    unrealizedGain: InvestmentDecimal;
    recordedFunding: InvestmentDecimal;
    holdingsLessRecordedFunding: InvestmentDecimal;
    dailyChange?: InvestmentDecimal;
    accountGain: InvestmentDecimal;
    missing: string[];
  };
  id: string;
  name: string;
  broker: string;
  accountType: string;
  isEnabled: boolean;
  historyComplete: boolean;
  currencyCode: string;
  marketValue: InvestmentDecimal;
  cash: InvestmentDecimal;
  costBasis: InvestmentDecimal;
  unrealizedGain: InvestmentDecimal;
  realizedGain: InvestmentDecimal;
  observationDate: string | null;
  review: string[];
}
export interface InvestmentHoldingAccount {
  dailyChange?: InvestmentDecimal;
  reportedAverageCost?: InvestmentDecimal;
  portfolioId: string;
  portfolioName: string;
  quantity: string;
  costBasis: InvestmentDecimal;
  averageCost: InvestmentDecimal;
  marketValue: InvestmentDecimal;
  unrealizedGain: InvestmentDecimal;
  source: string;
  updatedAt: string | null;
}
export interface InvestmentHolding extends InvestmentClassification {
  personalGains?: Record<string, InvestmentDecimal>;
  /** Position gains from native opening values and recorded trade/distribution cash. */
  personalReturns?: Partial<
    Record<'weekly' | 'monthly' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | 'custom', InvestmentDecimal>
  >;
  /** id/securityId are stable database instrument UUIDs, never ticker-only identifiers. */
  id: string;
  securityId: string;
  symbol: string;
  name: string;
  securityType: string;
  currencyCode: string;
  exchange: string | null;
  quantity: string;
  averageCost: InvestmentDecimal;
  /** price/averageCost use instrument currencyCode; all totals use InvestmentAnalytics.currencyCode. */
  costBasis: InvestmentDecimal;
  price: InvestmentDecimal;
  priceDate: string | null;
  marketValue: InvestmentDecimal;
  unrealizedGain: InvestmentDecimal;
  unrealizedPercent: InvestmentDecimal;
  realizedGain: InvestmentDecimal;
  dividends: InvestmentDecimal;
  dailyChange: InvestmentDecimal;
  dailyChangePercent: InvestmentDecimal;
  dailyChangeReason?: string;
  previousCloseDate?: string | null;
  quoteStatus?: 'delayed' | 'closing' | 'historical' | 'unavailable';
  /** Price-only changes from recorded historical prices, never account returns or current quotes copied backwards. */
  periodReturns?: Partial<
    Record<'daily' | 'weekly' | 'monthly' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all', InvestmentDecimal>
  >;
  weight: InvestmentDecimal;
  portfolioCount: number;
  isFund: boolean;
  accounts: InvestmentHoldingAccount[];
  quality: InvestmentQualityStatus;
}
export interface InvestmentHistoryPoint {
  date: string;
  marketValue: InvestmentDecimal;
  netInvested: InvestmentDecimal;
  cumulativeGain: InvestmentDecimal;
  unrealizedGain: InvestmentDecimal;
  realizedGain: InvestmentDecimal;
  returnPercent: InvestmentDecimal;
  contributions: InvestmentDecimal;
  withdrawals: InvestmentDecimal;
  portfolios: Record<string, InvestmentDecimal>;
  coverage: number;
  source: string;
  /** Supported subtotals are separate from full portfolio values. */
  knownMarketValue?: InvestmentDecimal;
  knownNetInvested?: InvestmentDecimal;
  knownPortfolios?: Record<string, InvestmentDecimal>;
}
export interface InvestmentEvent {
  id: string;
  date: string;
  type: string;
  label: string;
  amount: InvestmentDecimal;
  portfolioId: string;
  securityId?: string;
  symbol?: string;
}
export interface InvestmentDividend {
  id: string;
  date: string;
  portfolioId: string;
  portfolioName: string;
  securityId: string;
  symbol: string;
  name: string;
  amount: string;
  currencyCode: string;
  status: 'recorded' | 'announced' | 'estimated';
  reinvested: boolean | null;
  type: 'dividend' | 'interest';
}
export interface InvestmentExposureContribution {
  portfolioId: string;
  portfolioName: string;
  fundId: string | null;
  fundSymbol: string | null;
  value: string;
  weight: string | null;
  source: string;
  asOf: string | null;
}
export interface InvestmentExposure extends InvestmentClassification {
  id: string;
  symbol: string;
  name: string;
  directValue: string;
  indirectValue: string;
  totalValue: string;
  weight: InvestmentDecimal;
  fundCount: number;
  unknown: boolean;
  sourceDate: string | null;
  notionalWeight?: string;
  contributions: InvestmentExposureContribution[];
}
export interface InvestmentAllocation {
  key: string;
  label: string;
  value: string;
  percent: InvestmentDecimal;
  securityIds: string[];
}
export interface FundHoldingInput extends InvestmentClassification {
  /** Stable UUID/ISIN/source identity; reuse the direct holding UUID to combine direct+indirect exposure. Weight is percent 0..100. */
  id: string;
  symbol: string;
  name: string;
  weight: string;
  isFund?: boolean;
  isin?: string;
  cusip?: string;
  currencyCode?: string;
  exchange?: string;
  /** Original source identifier retained when an exact ISIN/CUSIP alias is resolved to a held UUID. */
  sourceId?: string;
  /** Source market-value weight and derivative notional weight are never interchangeable. */
  notionalWeight?: string;
  marketValue?: string;
  rawWeight?: string;
  weightReported?: boolean;
  issuerLei?: string;
  countryBasis?: string;
  classificationStandard?: string;
  classificationSource?: string;
}
export interface FundCompositionProvenance {
  sourceId: string;
  sourceUrl: string;
  fileName: string;
  sha256: string;
  parserVersion: string;
  method: 'issuer-file' | 'sec-nport' | 'sec-xbrl' | 'manual';
  rawSourceGzipBase64?: string;
  reportedRowCount: number;
  parsedRowCount: number;
  unweightedRowCount: number;
  completeness: 'full-file' | 'partial';
  warnings: string[];
  netWeight: string;
  grossWeight: string;
  /** Signed rounding / unlisted assets and liabilities, never reassigned to companies. */
  residualWeight: string;
  seriesId?: string;
  classId?: string;
  accession?: string;
  fundNetAssets?: string;
  autoRefreshPermitted: boolean;
  refreshRunAt?: string;
}
export interface InvestmentFundSnapshot {
  holdingsOmitted?: boolean;
  holdingCount?: number;
  /** Matches the held fund's InvestmentHolding.id; nested fund ids must match child snapshots. */
  fundId: string;
  symbol: string;
  asOf: string;
  provider: string;
  retrievedAt: string;
  holdings: FundHoldingInput[];
  coverage: string;
  classificationStandard?: string;
  provenance?: FundCompositionProvenance;
}
export interface FundCompositionStatus {
  fundId: string;
  symbol: string;
  name: string;
  sourceId: string;
  sourceUrl: string;
  adapter: string;
  seriesId?: string;
  classId?: string;
  family?: string;
  status: 'ready' | 'partial' | 'missing' | 'review';
  asOf: string | null;
  retrievedAt: string | null;
  rows: number;
  coverage: string;
  residual: string;
  autoRefreshPermitted: boolean;
  autoRefreshOperational: boolean;
  lastRefreshRun: string | null;
  blocker: string | null;
  warnings: string[];
  identityEvidence?: string;
  scheduledRefreshEnabled?: boolean;
  lastScheduledRun?: string | null;
  nextRefreshDue?: string | null;
  refreshAsOf?: string | null;
  netWeight?: string;
  grossWeight?: string;
}
export interface InvestmentCategoryOverlap {
  /** All category weights and coverage values are percentages of each fund's unnormalized composition. */
  weightedOverlap: InvestmentDecimal;
  status: InvestmentQualityStatus;
  reason?: string;
  leftCoverage: string;
  rightCoverage: string;
  categories: { label: string; leftWeight: string; rightWeight: string; overlapWeight: string }[];
}
export interface InvestmentFundOverlap {
  detailsLoaded?: boolean;
  leftId: string;
  rightId: string;
  leftSymbol: string;
  rightSymbol: string;
  weightedOverlap: string | null;
  sharedCount: number;
  coverage: InvestmentQualityStatus;
  reason?: string;
  leftDate: string | null;
  rightDate: string | null;
  shared: {
    id: string;
    symbol: string;
    name: string;
    leftWeight: string;
    rightWeight: string;
    combinedValue: InvestmentDecimal;
  }[];
  /** Unique among known reported companies; incomplete counterpart coverage may conceal additional overlap. */
  leftUnique: { id: string; symbol: string; name: string; weight: string; value: InvestmentDecimal }[];
  rightUnique: { id: string; symbol: string; name: string; weight: string; value: InvestmentDecimal }[];
  sectorOverlap: InvestmentCategoryOverlap;
  countryOverlap: InvestmentCategoryOverlap;
}
export interface InvestmentBenchmark {
  id: string;
  symbol: string;
  name: string;
  returnType: 'price-only' | 'total-return';
  status: InvestmentQualityStatus;
  reason?: string;
  points: { date: string; returnPercent: string }[];
}
export interface InvestmentDataHealth {
  id: string;
  portfolioId?: string;
  securityId?: string;
  label: string;
  status: InvestmentQualityStatus;
  detail: string;
  asOf?: string | null;
}
export interface InvestmentAnalytics {
  performanceTotals?: Record<
    string,
    { gain: InvestmentDecimal; percent: InvestmentDecimal; covered: number; total: number }
  >;
  accountHistory?: import('./investment-history').InvestmentAccountHistoryResponse;
  /** Historical prices of a fixed basket of today's priced holdings; never a reconstructed account return. */
  priceRisk?: {
    points: { date: string; returnPercent: string; drawdown: string }[];
    coveragePercent: string;
    included: number;
    excluded: string[];
    volatility: InvestmentDecimal;
    maxDrawdown: InvestmentDecimal;
    methodology: string;
  };
  generatedAt: string;
  currencyCode: string;
  selectedPortfolioIds: string[];
  portfolios: InvestmentPortfolio[];
  metrics: Record<string, InvestmentMetric>;
  holdings: InvestmentHolding[];
  history: InvestmentHistoryPoint[];
  events: InvestmentEvent[];
  dividends: InvestmentDividend[];
  exposure: InvestmentExposure[];
  allocations: Record<string, InvestmentAllocation[]>;
  fundSnapshots: InvestmentFundSnapshot[];
  composition?: FundCompositionStatus[];
  overlap: InvestmentFundOverlap[];
  benchmarks: InvestmentBenchmark[];
  health: InvestmentDataHealth[];
  coverage: {
    historyStart: string | null;
    historyEnd: string | null;
    costBasisPercent: string;
    lookThroughPercent: string;
    fundCompositionPercent?: string;
    fundValue?: InvestmentDecimal;
    compositionDates?: string[];
    pricePercent: string;
    methodology: string[];
  };
  refresh: { supported: boolean; lastSuccess: string | null; schedule: string; provider: string; reason?: string };
}
