import { createController } from '@controllers/helpers/controller-factory';
import { cryptoPricesSyncCron } from '@crons/crypto-prices-sync';
import { securitiesIntradaySyncCron } from '@crons/securities-daily-sync';
import SecurityPricing from '@models/investments/security-pricing.model';
import { dataProviderFactory } from '@services/investments/data-providers';
import {
  syncHistoricalPrices,
  syncIntradayHistoricalPrices,
} from '@services/investments/securities-price/historical-sync.service';
import { addSecurityFromSearch } from '@services/investments/securities/add-from-search.service';
import { z } from 'zod';

const summarize = (result: PromiseSettledResult<unknown>): { ok: boolean; error?: string } => {
  if (result.status === 'fulfilled') return { ok: true };
  const reason = result.reason;
  return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
};

export default createController(
  z.object({
    body: z
      .object({
        historical: z.boolean().optional(),
        intraday: z.boolean().optional(),
        securityIds: z.array(z.string().uuid()).max(100).optional(),
        benchmarkSymbols: z
          .array(z.string().regex(/^[A-Z0-9.^=-]{1,30}$/))
          .max(12)
          .optional(),
      })
      .default({}),
  }),
  async ({ body }) => {
    if (body?.historical) {
      const results: { securityId: string; ok: boolean; count: number }[] = [];
      const ids = new Set(body.securityIds ?? []);
      for (const symbol of body.benchmarkSymbols ?? []) {
        const found = await dataProviderFactory.getProvider().searchSecurities(symbol);
        const matches = found.filter(
          (s) => s.symbol === symbol && s.currencyCode === 'USD' && s.assetClass === 'stocks',
        );
        if (matches.length === 1)
          ids.add((await addSecurityFromSearch({ searchResult: matches[0]!, skipPriceFetch: true })).security.id);
      }
      for (const securityId of ids) {
        try {
          if (body.intraday && (await SecurityPricing.count({ where: { securityId } })) < 30)
            await syncHistoricalPrices(securityId);
          results.push({
            securityId,
            ok: true,
            ...(await (body.intraday ? syncIntradayHistoricalPrices(securityId) : syncHistoricalPrices(securityId))),
          });
        } catch {
          results.push({ securityId, ok: false, count: 0 });
        }
      }
      const current = await Promise.allSettled([
        securitiesIntradaySyncCron.triggerManualSync({ force: true }),
        cryptoPricesSyncCron.triggerManualSync({ force: true }),
      ]);
      return {
        data: {
          timestamp: new Date().toISOString(),
          historical: results,
          stocks: summarize(current[0]!),
          crypto: summarize(current[1]!),
        },
      };
    }
    // Run both syncs in parallel under separate locks so a lock contention or
    // provider failure on one side never silently skips the other. The operator
    // hitting the button wants a full refresh — partial outcomes must be visible
    // per-side rather than hidden behind a single throw.
    const [stocks, crypto] = await Promise.allSettled([
      securitiesIntradaySyncCron.triggerManualSync({ force: true }),
      cryptoPricesSyncCron.triggerManualSync({ force: true }),
    ]);

    return {
      data: {
        message: 'Securities sync triggered (stocks + crypto)',
        timestamp: new Date().toISOString(),
        stocks: summarize(stocks),
        crypto: summarize(crypto),
      },
    };
  },
  { inBackground: ({ body }) => !!body?.historical },
);
