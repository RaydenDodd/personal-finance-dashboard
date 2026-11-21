import { ASSET_CLASS } from '@bt/shared/types/investments';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { withLock } from '@services/common/lock';
import { withTransaction } from '@services/common/with-transaction';
import { dataProviderFactory, YahooDataProvider } from '@services/investments/data-providers';
import { PriceData, toProviderSymbol } from '@services/investments/data-providers/base-provider';
import { fetchCoinbaseHistory } from '@services/investments/data-providers/coinbase-quotes';
import { subYears, subDays } from 'date-fns';
import { Op } from 'sequelize';

import { bucketByUtcDay, startOfDayUtc, uniquePriceObservations } from './pricing-anchor';

// CoinGecko Demo tier only serves up to 1 year of history. Stocks (Yahoo etc.)
// happily go back further, so keep the longer backfill for them. Extending the
// crypto window beyond 1y requires a second data source or a paid plan.
const STOCK_BACKFILL_YEARS = 5;
const CRYPTO_BACKFILL_YEARS = 1;

const syncHistoricalPricesImpl = async (
  securityId: string,
  intraday = false,
  requiredFrom?: string,
): Promise<{ count: number }> => {
  logger.info(`Starting historical price sync for securityId: ${securityId}`);

  const security = await Securities.findByPk(securityId);
  if (!security) {
    throw new NotFoundError({ message: `Security with ID ${securityId} not found` });
  }

  const endDate = new Date();
  const yearsBack = security.assetClass === ASSET_CLASS.crypto ? CRYPTO_BACKFILL_YEARS : STOCK_BACKFILL_YEARS;
  let startDate = intraday ? subDays(endDate, 7) : subYears(endDate, yearsBack);
  if (!intraday) {
    if (requiredFrom && /^\d{4}-\d{2}-\d{2}$/.test(requiredFrom) && new Date(requiredFrom) < startDate)
      startDate = new Date(requiredFrom + 'T00:00:00Z');
    // Preserve the native default window, extending it only where actual native
    // transactions establish that the instrument is needed further back.
    const firstTrade = await InvestmentTransaction.min('date', { where: { securityId } });
    if (firstTrade && new Date(String(firstTrade)) < startDate) startDate = new Date(String(firstTrade));
    const firstStored = await SecurityPricing.min('date', { where: { securityId } });
    if (firstStored && new Date(String(firstStored)) < startDate) startDate = new Date(String(firstStored));
    startDate = startOfDayUtc(startDate);
  }

  // Use composite provider which automatically handles US vs non-US routing and fallbacks
  const compositeProvider = dataProviderFactory.getProvider();

  // `priceQuerySymbol` returns the same value as `providerSymbol` for ordinary
  // securities; for rows with `priceSourceSymbol` set it returns the local-ticker
  // venue the Yahoo ISIN-fallback path chose for dense historical data.
  const querySymbol = security.priceQuerySymbol;
  const routedVia = querySymbol !== security.providerSymbol ? ` (routed via priceSourceSymbol=${querySymbol})` : '';

  logger.info(
    `Fetching historical prices for ${security.symbol ?? security.providerSymbol} (${security.assetClass}, ${yearsBack}yr)${routedVia} using composite provider`,
  );

  let prices: PriceData[];
  try {
    prices = await compositeProvider.getHistoricalPrices(toProviderSymbol(querySymbol), {
      startDate,
      endDate,
      assetClass: security.assetClass,
      ...(intraday && security.assetClass !== ASSET_CLASS.crypto && { interval: '5m' as const }),
    });
  } catch (error) {
    if (security.assetClass !== ASSET_CLASS.crypto) throw error;
    prices = [];
  }
  const firstReturned = prices.length ? new Date(Math.min(...prices.map((p) => p.date.getTime()))) : endDate;
  if (
    security.assetClass === ASSET_CLASS.crypto &&
    (!prices.length || (!intraday && firstReturned.getTime() - startDate.getTime() > 3 * 86400000))
  ) {
    try {
      const older = await fetchCoinbaseHistory(
        {
          securityId: security.id,
          symbol: security.symbol ?? '',
          providerSymbol: toProviderSymbol(security.providerSymbol),
          assetClass: security.assetClass,
        },
        startDate,
        prices.length ? new Date(firstReturned.getTime() - 1) : endDate,
        intraday ? 3600 : 86400,
      );
      prices = [...older, ...prices].sort((a, b) => a.date.getTime() - b.date.getTime());
    } catch {
      logger.warn(
        `Older Coinbase history unavailable for ${security.symbol}; retained existing provider observations.`,
      );
    }
  }

  // Coinbase begins at the venue's listing date. Reuse the native Yahoo adapter
  // for older USD coin daily observations; it does not create a second security.
  const earliest = prices.length ? new Date(Math.min(...prices.map((p) => p.date.getTime()))) : endDate;
  if (
    !intraday &&
    security.assetClass === ASSET_CLASS.crypto &&
    /^[A-Z0-9]{2,15}$/.test(security.symbol ?? '') &&
    earliest.getTime() - startDate.getTime() > 86400000
  ) {
    try {
      const older = await new YahooDataProvider().getHistoricalPrices(toProviderSymbol(`${security.symbol}-USD`), {
        startDate,
        endDate: earliest,
        assetClass: ASSET_CLASS.crypto,
      });
      prices = [...older, ...prices].sort((a, b) => a.date.getTime() - b.date.getTime());
    } catch {
      logger.warn(`Older Yahoo USD history unavailable for ${security.symbol}; retained sourced observations.`);
    }
  }

  if (prices.length === 0) {
    // When the row has an explicit `priceSourceSymbol` and the provider still
    // returns nothing, that source is broken (delisted, renamed, throttled) –
    // not the silent "no data on this ticker" case for ordinary rows. Warn so
    // it shows up in alerts instead of getting buried in info-level noise.
    const severity = querySymbol !== security.providerSymbol ? 'warn' : 'info';
    logger[severity](`No historical prices found for ${security.symbol ?? security.providerSymbol}${routedVia}.`);
    return { count: 0 };
  }

  const dailyPrices = intraday
    ? prices.map((p) => (p.dailyBar ? { ...p, date: startOfDayUtc(p.date) } : p))
    : bucketByUtcDay(prices);

  const pricesToCreate = uniquePriceObservations(dailyPrices).map((price) => ({
    securityId: security.id,
    date: price.date,
    priceClose: price.priceClose.toString(),
    unadjustedClose:
      price.unadjustedClose?.toString() ??
      (security.assetClass === ASSET_CLASS.crypto ? price.priceClose.toString() : null),
    priceAsOf: (intraday && !price.dailyBar) || security.assetClass === ASSET_CLASS.crypto ? price.priceAsOf : null,
    source: price.providerName,
  }));

  const existing = await SecurityPricing.findAll({
    where: { securityId, date: { [Op.in]: pricesToCreate.map((p) => p.date) } },
    attributes: ['date', 'source', 'priceAsOf', 'previousClose'],
    raw: true,
  });
  const existingByDate = new Map(existing.map((p) => [new Date(p.date).toISOString(), p]));
  const editable = pricesToCreate.filter((p) => {
    const prior = existingByDate.get(p.date.toISOString());
    return !prior || (!prior.previousClose && prior.source === p.source && (p.priceAsOf !== null || !prior.priceAsOf));
  });
  await SecurityPricing.bulkCreate(editable, {
    updateOnDuplicate: ['priceClose', 'unadjustedClose', 'priceAsOf', 'source'],
  });

  // Update the main security record
  security.pricingLastSyncedAt = new Date();
  await security.save();

  logger.info(
    `Submitted ${dailyPrices.length} historical price points (bucketed from ${prices.length} provider points; ` +
      `provider rows were repaired idempotently; manual sources retained) for ${security.symbol ?? security.providerSymbol}.`,
  );
  return { count: dailyPrices.length };
};

// Wrap with a lock to prevent multiple syncs for the same security at the same time
const lockedSync = (securityId: string, requiredFrom?: string) =>
  withLock(`price-sync:security:${securityId}`, () => syncHistoricalPricesImpl(securityId, false, requiredFrom))();

export const syncHistoricalPrices = withTransaction(lockedSync);
export const syncIntradayHistoricalPrices = withTransaction((securityId: string) =>
  withLock(`price-sync:security:${securityId}`, () => syncHistoricalPricesImpl(securityId, true))(),
);
