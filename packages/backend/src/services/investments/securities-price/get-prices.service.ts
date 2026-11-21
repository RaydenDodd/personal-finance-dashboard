import { investmentPriceDate, usEquityObservationAllowed } from '@bt/shared/types/investment-market';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op, WhereOptions } from 'sequelize';

import { usesUsEquitySession } from './regular-session';

interface PriceQueryOptions {
  securityId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Fetches security prices based on a flexible set of query options.
 * @param options - The query options including securityId and date ranges.
 */
const getPricesImpl = async (options: PriceQueryOptions) => {
  const where: WhereOptions<SecurityPricing> = {};

  if (options.securityId) {
    where.securityId = options.securityId;
  }

  if (options.from || options.to) {
    where.date = {};
    if (options.from) {
      where.date[Op.gte] = options.from;
    }
    if (options.to) {
      where.date[Op.lte] = options.to;
    }
  }

  const storedRows = await SecurityPricing.findAll({ where, order: [['date', 'ASC']] });
  const securities = await Securities.findAll({ where: options.securityId ? { id: options.securityId } : {} });
  const usSessionIds = new Set(securities.filter(usesUsEquitySession).map((s) => String(s.id)));
  const rows = storedRows.filter(
    (p) =>
      p.source !== 'yahoo' ||
      !p.priceAsOf ||
      !!p.previousClose ||
      !usSessionIds.has(p.securityId) ||
      usEquityObservationAllowed(p.priceAsOf),
  );
  const factors = new Map<string, number>();
  const intradayCounts = new Map<string, number>();
  for (const p of rows)
    if (p.unadjustedClose != null && p.priceAsOf) {
      const key = `${p.securityId}:${investmentPriceDate(p.priceAsOf, false)}`;
      intradayCounts.set(key, (intradayCounts.get(key) ?? 0) + 1);
    }
  for (const p of rows)
    if (p.unadjustedClose?.toBig().gt(0) && !p.priceAsOf)
      factors.set(
        `${p.securityId}:${investmentPriceDate(p.date)}`,
        p.priceClose.toBig().div(p.unadjustedClose.toBig()).toNumber(),
      );
  return rows.map((p) => {
    const key = `${p.securityId}:${investmentPriceDate(p.priceAsOf ?? p.date, p.priceAsOf ? false : undefined)}`;
    const factor = factors.get(key);
    const graphPriceClose =
      p.unadjustedClose && factor !== undefined
        ? p.unadjustedClose.toBig().times(factor).toString()
        : p.source === 'yahoo' &&
            !p.previousClose &&
            p.unadjustedClose == null &&
            ((factor !== undefined && factor !== 1) || (intradayCounts.get(key) ?? 0) > 2)
          ? null
          : p.priceClose.toDecimalString(18);
    return { ...p.toJSON(), graphPriceClose };
  });
};

export const getPrices = withTransaction(getPricesImpl);
