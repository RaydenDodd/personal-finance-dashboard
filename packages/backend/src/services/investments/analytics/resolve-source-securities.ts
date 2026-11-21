import Securities from '@models/investments/securities.model';

import type { BrokerData } from '../broker-records/schema';
import { dataProviderFactory } from '../data-providers';
import { addSecurityFromSearch } from '../securities/add-from-search.service';

const nameKey = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
/** Register evidenced market-data identities, never holdings or financial transactions. */
export async function resolveSourceSecurities(records: { data: BrokerData }[], known: Securities[]) {
  const added: Securities[] = [],
    unresolved: { symbol: string; reason: string }[] = [];
  const candidates = new Map<string, string>();
  for (const r of records)
    for (const e of r.data.sourceEvents ?? [])
      if (['Buy', 'Sell', 'REC'].includes(String(e.action)) && e.symbol && !known.some((s) => s.symbol === e.symbol))
        candidates.set(
          String(e.symbol),
          String(e.description ?? '')
            .split(/CUSIP:/i)[0]!
            .trim(),
        );
  for (const [symbol, description] of candidates) {
    try {
      const found = await dataProviderFactory.getProvider().searchSecurities(symbol);
      const sourceName = nameKey(description);
      const matches = found.filter(
        (s) =>
          s.symbol === symbol &&
          s.currencyCode === 'USD' &&
          s.assetClass === 'stocks' &&
          sourceName.length >= 2 &&
          (nameKey(s.name).startsWith(sourceName) || sourceName.startsWith(nameKey(s.name))),
      );
      if (matches.length !== 1) {
        unresolved.push({ symbol, reason: 'No unique provider identity matching the original broker company name.' });
        continue;
      }
      added.push((await addSecurityFromSearch({ searchResult: matches[0]!, skipPriceFetch: true })).security);
    } catch {
      unresolved.push({
        symbol,
        reason: 'Historical provider identity is unavailable; no replacement ticker was guessed.',
      });
    }
  }
  return { added, unresolved };
}
