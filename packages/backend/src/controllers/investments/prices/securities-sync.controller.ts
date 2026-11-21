import { createController } from '@controllers/helpers/controller-factory';
import { cryptoPricesSyncCron } from '@crons/crypto-prices-sync';
import { securitiesIntradaySyncCron } from '@crons/securities-daily-sync';
import { ValidationError } from '@js/errors';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserSettings from '@models/user-settings.model';
import { dataProviderFactory } from '@services/investments/data-providers';
import {
  syncHistoricalPrices,
  syncIntradayHistoricalPrices,
} from '@services/investments/securities-price/historical-sync.service';
import { addSecurityFromSearch } from '@services/investments/securities/add-from-search.service';
import { Op } from 'sequelize';
import { z } from 'zod';

const summarize = (result: PromiseSettledResult<unknown>): { ok: boolean; error?: string } => {
  if (result.status === 'fulfilled') return { ok: true };
  const reason = result.reason;
  return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
};

function createPricesSyncController(ownerScoped = false) {
  return createController(
    z.object({
      body: z
        .object({
          historical: z.boolean().optional(),
          intraday: z.boolean().optional(),
          daily: z.boolean().optional(),
          securityIds: z.array(z.string().uuid()).max(100).optional(),
          benchmarkSymbols: z
            .array(z.string().regex(/^[A-Z0-9.^=-]{1,30}$/))
            .max(12)
            .optional(),
        })
        .default({}),
    }),
    async ({ body, user }) => {
      let scope: string[] | undefined;
      if (ownerScoped) {
        const hidden =
          (await UserSettings.findOne({ where: { userId: user.id } }))?.settings.ui?.hiddenPortfolioIds ?? [];
        const positions = await Holdings.findAll({
          where: { excluded: false, ...(!body.historical && { quantity: { [Op.ne]: 0 } }) },
          attributes: ['securityId'],
          include: [
            {
              model: Portfolios,
              as: 'portfolio',
              required: true,
              attributes: [],
              where: { userId: user.id, ...(hidden.length && { id: { [Op.notIn]: hidden } }) },
            },
          ],
          raw: true,
        });
        scope = [...new Set(positions.map((p) => p.securityId))];
        if (body.securityIds?.some((id) => !scope!.includes(id)))
          throw new ValidationError({ message: 'Only securities in your visible portfolios may be refreshed.' });
        scope = body.securityIds ?? scope;
      }
      const ids = new Set(body.securityIds ?? scope ?? []);
      for (const symbol of body.benchmarkSymbols ?? (ownerScoped ? ['SPY'] : [])) {
        const found = await dataProviderFactory.getProvider().searchSecurities(symbol);
        const matches = found.filter(
          (s) => s.symbol === symbol && s.currencyCode === 'USD' && s.assetClass === 'stocks',
        );
        if (matches.length === 1)
          ids.add((await addSecurityFromSearch({ searchResult: matches[0]!, skipPriceFetch: true })).security.id);
      }
      const currentOptions = { force: true, ...(ownerScoped && { securityIds: [...ids] }) };
      if (body?.historical) {
        const results: { securityId: string; ok: boolean; count: number }[] = [];
        for (const securityId of ids) {
          try {
            if (body.intraday && (body.daily || (await SecurityPricing.count({ where: { securityId } })) < 30))
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
          securitiesIntradaySyncCron.triggerManualSync(currentOptions),
          cryptoPricesSyncCron.triggerManualSync(currentOptions),
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
        securitiesIntradaySyncCron.triggerManualSync(currentOptions),
        cryptoPricesSyncCron.triggerManualSync(currentOptions),
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
    { inBackground: ({ body }) => ownerScoped || !!body?.historical },
  );
}
export const ownerSecuritiesSyncController = createPricesSyncController(true);
export default createPricesSyncController();
