/** Monetary/quantity values are decimal strings; null means unavailable, never zero. */
export type InvestmentDecimal = string | null;
export type InvestmentQualityStatus = 'verified' | 'partial' | 'stale' | 'unavailable';
export interface InvestmentMetric {
  value: InvestmentDecimal;
  status: InvestmentQualityStatus;
  reason?: string;
}
export interface InvestmentClassification {
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
  /** Price-only changes from recorded historical prices, never account returns or current quotes copied backwards. */
  periodReturns?: Partial<Record<'daily' | 'weekly' | 'monthly' | 'ytd' | '1y', InvestmentDecimal>>;
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
}
export interface InvestmentFundSnapshot {
  /** Matches the held fund's InvestmentHolding.id; nested fund ids must match child snapshots. */
  fundId: string;
  symbol: string;
  asOf: string;
  provider: string;
  retrievedAt: string;
  holdings: FundHoldingInput[];
  coverage: string;
  classificationStandard?: string;
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
  overlap: InvestmentFundOverlap[];
  benchmarks: InvestmentBenchmark[];
  health: InvestmentDataHealth[];
  coverage: {
    historyStart: string | null;
    historyEnd: string | null;
    costBasisPercent: string;
    lookThroughPercent: string;
    pricePercent: string;
    methodology: string[];
  };
  refresh: { supported: boolean; lastSuccess: string | null; schedule: string; provider: string; reason?: string };
}
