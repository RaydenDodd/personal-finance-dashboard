import type { FundHoldingInput, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';

const issuerName = (name: string) =>
  name
    .toUpperCase()
    .replace(/\bCL\.?\s+([A-Z])\b/g, 'CLASS $1')
    .replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|PLC|CO)\s*[-/]\s*([A-Z])$/g, '$1 CLASS $2')
    .replace(/\b(COMMON STOCK|CORPORATION|CORP|INCORPORATED|INC|PLC|LTD|LIMITED|CO|COMPANY)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
const tickerKey = (symbol: string | null | undefined) => (symbol ?? '').toUpperCase().replace(/[.\- /]/g, '');
const baseIssuerName = (name: string) => issuerName(name).replace(/CLASS[A-Z]$/, '');
const usVenue = (venue: string | null | undefined) =>
  /^(XNAS|XNYS|ARCX|NASDAQ|NYSE|NMS|NAS|NGM|NCM|NYQ|PCX|ARCA|NYSEARCA|ASE|AMEX|XASE)$/i.test(venue ?? '');
const strongId = (row: FundHoldingInput) => {
  if (/^[A-Z0-9*@#]{9}$/.test(row.cusip ?? '')) return `cusip:${row.cusip}`;
  if (/^US[A-Z0-9]{9}\d$/.test(row.isin ?? '')) return `cusip:${row.isin!.slice(2, 11)}`;
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin ?? '')) return `isin:${row.isin}`;
  return /^(cusip|isin):/i.test(row.id)
    ? row.id.toLowerCase().startsWith('cusip:')
      ? `cusip:${row.id.slice(6).toUpperCase()}`
      : `isin:${row.id.slice(5).toUpperCase()}`
    : undefined;
};
const displayTicker = (row: FundHoldingInput) =>
  row.symbol &&
  row.symbol !== row.cusip &&
  row.symbol !== row.isin &&
  !/^SEC-|^DERIVATIVE-|^LIABILITIES$/.test(row.symbol) &&
  row.symbol.length < 20;
type NativeIdentity = {
  id: string;
  symbol?: string | null;
  name?: string | null;
  currencyCode: string;
  exchangeMic?: string | null;
  exchangeAcronym?: string | null;
  isin?: string | null;
  cusip?: string | null;
};

/**
 * Source-to-source joins require CUSIP/ISIN, or a qualified issuer listing with
 * an exact issuer name and currency. Native records without identifiers need
 * all of: a source CUSIP/ISIN, source ticker, matching normalized issuer name,
 * USD currency and a native US venue, and a unique match. Ticker alone never joins.
 * This is an analytical alias; no Securities/BrokerPortfolioData row is edited.
 */
export function bridgeCompositionIdentities(snapshots: InvestmentFundSnapshot[], securities: NativeIdentity[]) {
  const metadata = new Map<string, FundHoldingInput>();
  const candidates = new Map<string, Set<string>>();
  for (const snapshot of snapshots.filter((s) => !!s.provenance))
    for (const h of snapshot.holdings) {
      if (h.assetClass !== 'Equity') continue;
      const id = strongId(h);
      if (!id) continue;
      const previous = metadata.get(id);
      const merged = { ...h, ...previous, id };
      for (const key of [
        'sector',
        'industry',
        'country',
        'currencyCode',
        'exchange',
        'isin',
        'cusip',
        'issuerLei',
      ] as const)
        if (!merged[key] && h[key]) merged[key] = h[key];
      if (displayTicker(h)) merged.symbol = h.symbol;
      if (h.sector) {
        merged.classificationStandard = h.classificationStandard ?? snapshot.classificationStandard;
        merged.classificationSource = h.classificationSource ?? snapshot.provider;
      }
      metadata.set(id, merged);
      const key = `${issuerName(h.name)}:${h.currencyCode ?? ''}`;
      const ids = candidates.get(key) ?? new Set<string>();
      ids.add(id);
      candidates.set(key, ids);
    }
  const nativeAliases = new Map<string, string>();
  const candidatesByNative = new Map<string, string[]>();
  for (const [id, h] of metadata) {
    if (!displayTicker(h) || h.currencyCode !== 'USD') continue;
    const matches = securities.filter(
      (s) =>
        tickerKey(s.symbol) === tickerKey(h.symbol) &&
        s.currencyCode === 'USD' &&
        !s.isin &&
        !s.cusip &&
        !!s.name &&
        (/\bCLASS\s+[A-Z]\b/i.test(s.name)
          ? issuerName(s.name) === issuerName(h.name)
          : baseIssuerName(s.name) === baseIssuerName(h.name)) &&
        (usVenue(s.exchangeMic) || usVenue(s.exchangeAcronym)),
    );
    if (matches.length === 1) {
      const nativeId = matches[0]!.id;
      candidatesByNative.set(nativeId, [...(candidatesByNative.get(nativeId) ?? []), id]);
    }
  }
  for (const [nativeId, ids] of candidatesByNative) if (ids.length === 1) nativeAliases.set(ids[0]!, nativeId);
  const resolved = snapshots.map((snapshot) =>
    !snapshot.provenance
      ? snapshot
      : {
          ...snapshot,
          holdings: snapshot.holdings.map((h) => {
            if (h.assetClass !== 'Equity') return h;
            let id = strongId(h);
            if (!id && h.exchange && h.currencyCode && displayTicker(h)) {
              const ids = [...(candidates.get(`${issuerName(h.name)}:${h.currencyCode}`) ?? [])].filter((key) => {
                const source = metadata.get(key)!;
                return !displayTicker(source) || tickerKey(source.symbol) === tickerKey(h.symbol);
              });
              if (ids.length === 1) id = ids[0];
            }
            if (!id) return h;
            const other = metadata.get(id);
            const nativeId = nativeAliases.get(id) ?? id;
            return {
              ...h,
              id: nativeId,
              sourceId: h.id,
              ...(other && displayTicker(other) && { symbol: other.symbol }),
              sector: h.sector ?? other?.sector,
              industry: h.industry ?? other?.industry,
              country: h.country ?? other?.country,
              classificationStandard: h.sector
                ? (h.classificationStandard ?? snapshot.classificationStandard)
                : other?.classificationStandard,
              classificationSource: h.sector
                ? (h.classificationSource ?? snapshot.provider)
                : other?.classificationSource,
            };
          }),
        },
  );
  const classifications = new Map<string, FundHoldingInput>();
  for (const snapshot of resolved)
    for (const h of snapshot.holdings)
      if (snapshot.provenance && h.assetClass === 'Equity' && h.sector)
        classifications.set(h.id, {
          ...h,
          classificationStandard: h.classificationStandard ?? snapshot.classificationStandard,
          classificationSource: `${snapshot.provider} (${snapshot.asOf})`,
        });
  return resolved.map((snapshot) =>
    !snapshot.provenance
      ? snapshot
      : {
          ...snapshot,
          holdings: snapshot.holdings.map((h) => {
            const classification = classifications.get(h.id);
            return !classification || h.sector
              ? h
              : {
                  ...h,
                  sector: classification.sector,
                  industry: classification.industry,
                  classificationStandard: classification.classificationStandard,
                  classificationSource: classification.classificationSource,
                };
          }),
        },
  );
}
