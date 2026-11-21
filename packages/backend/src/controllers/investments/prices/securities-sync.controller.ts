import { createController } from '@controllers/helpers/controller-factory';
import { cryptoPricesSyncCron } from '@crons/crypto-prices-sync';
import { securitiesIntradaySyncCron } from '@crons/securities-daily-sync';
import { ValidationError } from '@js/errors';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserSettings from '@models/user-settings.model';
import { sqlRows } from '@services/investments/analytics/daily-account-cache';
import { resolveSourceSecurities } from '@services/investments/analytics/resolve-source-securities';
import { sourceQuantityEvidence } from '@services/investments/analytics/source-quantity-evidence';
import { dataProviderFactory } from '@services/investments/data-providers';
import {
  syncHistoricalPrices,
  syncIntradayHistoricalPrices,
} from '@services/investments/securities-price/historical-sync.service';
import { addSecurityFromSearch } from '@services/investments/securities/add-from-search.service';
import { Op } from 'sequelize';
import { z } from 'zod';

const summarize = (result: PromiseSettledResult<unknown>): { ok: boolean; error?: string; result?: unknown } => {
  if (result.status === 'fulfilled')
    return {
      ok: !(
        result.value &&
        typeof result.value === 'object' &&
        'failedUpdates' in result.value &&
        Number(result.value.failedUpdates) > 0
      ),
      result: result.value,
    };
  const reason = result.reason;
  return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
};

function createPricesSyncController(ownerScoped = false) {
  return createController(
    z.object({
      body: z
        .object({
          historical: z.boolean().optional(),
          missingOnly: z.boolean().optional(),
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
      const requiredFrom = new Map<string, string>();
      let discovery:
        | { added: { id: string; symbol: string | null }[]; unresolved: { symbol: string; reason: string }[] }
        | undefined;
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
        if (body.historical) {
          const portfolios = await Portfolios.findAll({
            where: { userId: user.id, ...(hidden.length && { id: { [Op.notIn]: hidden } }) },
            attributes: ['id'],
          });
          const portfolioIds = portfolios.map((p) => p.id);
          const [past, records] = await Promise.all([
            InvestmentTransaction.findAll({
              where: { portfolioId: { [Op.in]: portfolioIds } },
              attributes: ['securityId'],
              group: ['securityId'],
              raw: true,
            }),
            BrokerPortfolioData.findAll({ where: { portfolioId: { [Op.in]: portfolioIds } } }),
          ]);
          scope = [
            ...new Set([
              ...scope,
              ...past.map((t) => t.securityId),
              ...records.flatMap((r) => r.data.snapshots.flatMap((s) => s.positions.map((p) => p.securityId))),
            ]),
          ];
          const symbols = [
            ...new Set(
              records.flatMap((r) =>
                r.data.sourceEvents
                  .filter((e) => ['REC', 'SXCH', 'Buy', 'Sell'].includes(String(e.action)))
                  .map((e) => String(e.symbol ?? '')),
              ),
            ),
          ];
          const sourceSecurities = await Securities.findAll({
            where: { symbol: { [Op.in]: symbols }, currencyCode: 'USD' },
          });
          const resolved = await resolveSourceSecurities(records, sourceSecurities);
          sourceSecurities.push(...resolved.added);
          discovery = {
            added: resolved.added.map((s) => ({ id: s.id, symbol: s.symbol })),
            unresolved: resolved.unresolved,
          };
          for (const record of records)
            for (const t of sourceQuantityEvidence(record.portfolioId, record.data, sourceSecurities, []).rows) {
              const d = t.date.toISOString().slice(0, 10);
              scope.push(t.securityId);
              if (!requiredFrom.has(t.securityId) || d < requiredFrom.get(t.securityId)!)
                requiredFrom.set(t.securityId, d);
              if (resolved.added.some((s) => s.id === t.securityId))
                await sqlRows('SELECT investment_history_dirty(CAST(:id AS uuid),CAST(:date AS date))', {
                  id: record.portfolioId,
                  date: d,
                });
            }
          scope = [...new Set(scope)];
          if (body.missingOnly) scope = resolved.added.map((s) => s.id);
        }
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
        const results: { securityId: string; ok: boolean; count: number; error?: string }[] = [];
        for (const securityId of ids) {
          try {
            if (body.intraday && (body.daily || (await SecurityPricing.count({ where: { securityId } })) < 30))
              await syncHistoricalPrices(securityId, requiredFrom.get(securityId));
            results.push({
              securityId,
              ok: true,
              ...(await (body.intraday
                ? syncIntradayHistoricalPrices(securityId)
                : syncHistoricalPrices(securityId, requiredFrom.get(securityId)))),
            });
          } catch (error) {
            results.push({
              securityId,
              ok: false,
              count: 0,
              error: error instanceof Error ? error.message.slice(0, 500) : 'Price history refresh failed',
            });
          }
        }
        if (body.missingOnly) return { data: { timestamp: new Date().toISOString(), historical: results, discovery } };
        const current = await Promise.allSettled([
          securitiesIntradaySyncCron.triggerManualSync(currentOptions),
          cryptoPricesSyncCron.triggerManualSync(currentOptions),
        ]);
        return {
          data: {
            timestamp: new Date().toISOString(),
            historical: results,
            discovery,
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
