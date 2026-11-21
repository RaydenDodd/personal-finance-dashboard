import { ASSET_CLASS, SECURITY_PROVIDER, type CompanyClassifications } from '@bt/shared/types/investments';
import Securities from '@models/investments/securities.model';

import { isFundSecurity, isCompositionIdentityConflict } from './composition/registry';
import { dataProviderFactory } from './data-providers';
import { toProviderSymbol } from './data-providers/base-provider';

const DAY = 86400000;
/** Invoked under the existing stock-sync lock, never from page rendering. */
export async function refreshCompanyClassifications(securities: Securities[]) {
  const fetched = new Map<string, CompanyClassifications>();
  for (const security of securities) {
    if (
      security.assetClass !== ASSET_CLASS.stocks ||
      (!isCompositionIdentityConflict(security) && isFundSecurity(security))
    )
      continue;
    const cached =
      security.companyClassifications?.providerSymbol === security.priceQuerySymbol
        ? security.companyClassifications
        : null;
    if (
      cached &&
      ((cached.observedAt && Date.now() - new Date(cached.observedAt).getTime() < 7 * DAY) ||
        Date.now() - new Date(cached.lastAttemptAt).getTime() < DAY)
    )
      continue;
    const symbol = security.priceQuerySymbol;
    let profile = fetched.get(symbol);
    if (!profile) {
      const attemptedAt = new Date().toISOString();
      profile = {
        ...(cached ?? {}),
        source: 'Yahoo Finance',
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/profile/`,
        providerSymbol: symbol,
        observedAt: cached?.observedAt ?? null,
        lastAttemptAt: attemptedAt,
      };
      try {
        const result = await dataProviderFactory
          .getProvider(SECURITY_PROVIDER.yahoo)
          .getCompanyClassifications(toProviderSymbol(symbol));
        if (result)
          profile = {
            ...profile,
            sector: result.sector,
            industry: result.industry,
            observedAt: new Date().toISOString(),
          };
      } catch {
        /* Retain the last valid metadata and do not retry failed access every five minutes. */
      }
      fetched.set(symbol, profile);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await security.update({ companyClassifications: profile });
  }
}

export { fillMissingCompanyClassifications } from './classification-values';
