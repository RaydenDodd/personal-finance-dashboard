import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { recalculateHolding } from '@services/investments/holdings/recalculation.service';
import { isDeepStrictEqual } from 'node:util';

import { BrokerData, brokerDataSchema, latestSnapshot } from './schema';

export const getBrokerData = async ({ userId, portfolioId }: { userId: number; portfolioId: string }) => {
  await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
    message: 'Portfolio not found',
  });
  return (await BrokerPortfolioData.findByPk(portfolioId))?.data ?? null;
};

// An observation is not a cash flow or a trade. Keep it in a separate audit record.
export const saveBrokerData = withTransaction(
  async ({ userId, portfolioId, data }: { userId: number; portfolioId: string; data: BrokerData }) => {
    data = brokerDataSchema.parse(data);
    const portfolio = await findOrThrowNotFound({
      query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
      message: 'Portfolio not found',
    });
    const currency = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
    if (currency?.currency.code !== 'USD')
      throw new ValidationError({ message: 'USD broker records require a USD base currency.' });
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `broker-data:${portfolioId}` },
    });
    if (portfolio.isEnabled)
      throw new ValidationError({ message: 'Broker mirror portfolios must be excluded from net worth before import.' });
    const previous = await BrokerPortfolioData.findByPk(portfolioId, { lock: true });
    if (previous && (previous.data.broker !== data.broker || previous.data.accountKey !== data.accountKey))
      throw new ValidationError({ message: 'Broker account mapping cannot be changed by an import.' });
    for (const s of data.snapshots) {
      const old = previous?.data.snapshots.find((p) => p.id === s.id);
      if (old && !isDeepStrictEqual(old, s))
        throw new ValidationError({
          message: 'Existing source observation is immutable. Supply a new revision identifier.',
        });
    }
    const merged: BrokerData = {
      ...data,
      snapshots: [
        ...new Map([...(previous?.data.snapshots ?? []), ...data.snapshots].map((s) => [s.id, s])).values(),
      ].toSorted((a, b) => a.asOf.localeCompare(b.asOf)),
      documents: [
        ...new Map([...(previous?.data.documents ?? []), ...data.documents].map((s) => [s.sha256, s])).values(),
      ],
      taxReports: [
        ...new Map([...(previous?.data.taxReports ?? []), ...data.taxReports].map((s) => [s.year, s])).values(),
      ],
      review: [...new Set([...(previous?.data.review ?? []), ...data.review])],
      sourceEvents: [
        ...new Map(
          [...(previous?.data.sourceEvents ?? []), ...data.sourceEvents].map((s) => [
            String(s.sourceRowId ?? s.id ?? JSON.stringify(s)),
            s,
          ]),
        ).values(),
      ],
    };
    for (const snapshot of data.snapshots)
      for (const p of snapshot.positions) {
        const security = await Securities.findByPk(p.securityId);
        if (!security || security.currencyCode !== snapshot.currencyCode || security.symbol !== p.symbol)
          throw new ValidationError({ message: 'Snapshot security identity or currency mismatch.' });
        await Holdings.findOrCreate({
          where: { portfolioId, securityId: p.securityId },
          defaults: {
            currencyCode: snapshot.currencyCode,
            quantity: Money.zero(),
            costBasis: Money.zero(),
            refCostBasis: Money.zero(),
            excluded: false,
          },
        });
      }
    await BrokerPortfolioData.upsert({ portfolioId, data: merged });
    for (const h of await Holdings.findAll({ where: { portfolioId } }))
      await recalculateHolding({ portfolioId, securityId: h.securityId });
    return {
      snapshots: merged.snapshots.length,
      documents: merged.documents.length,
      latestAsOf: latestSnapshot(merged)?.asOf,
    };
  },
);
