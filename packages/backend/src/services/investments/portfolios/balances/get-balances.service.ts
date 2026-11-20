import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Currencies from '@models/currencies.model';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import Portfolios from '@models/investments/portfolios.model';
import { withTransaction } from '@services/common/with-transaction';
import { latestSnapshot } from '@services/investments/broker-records/schema';
import { WhereOptions } from 'sequelize';

interface GetPortfolioBalancesParams {
  userId: number;
  portfolioId: string;
  currencyCode?: string; // If specified, return balance for specific currency only
}

const getPortfolioBalancesImpl = async ({ userId, portfolioId, currencyCode }: GetPortfolioBalancesParams) => {
  // Verify portfolio exists and user owns it
  await findOrThrowNotFound({
    query: Portfolios.findOne({
      where: { id: portfolioId, userId },
    }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  // Build where clause for balance query
  const where: WhereOptions<PortfolioBalances> = { portfolioId };
  if (currencyCode !== undefined) {
    where.currencyCode = currencyCode;
  }

  // Get portfolio balances
  const balances = await PortfolioBalances.findAll({
    where,
    include: [
      {
        model: Currencies,
        as: 'currency',
      },
    ],
    order: [['currency', 'code', 'ASC']],
  });

  const broker = await BrokerPortfolioData.findByPk(portfolioId);
  if (broker) {
    const snapshot = latestSnapshot(broker.data);
    if (snapshot?.cash === null || !snapshot) return [];
    for (const balance of balances)
      if (balance.currencyCode === 'USD') {
        balance.availableCash = Money.fromDecimal(snapshot.cash);
        balance.totalCash = Money.fromDecimal(snapshot.cash);
        balance.refAvailableCash = Money.fromDecimal(snapshot.cash);
        balance.refTotalCash = Money.fromDecimal(snapshot.cash);
      }
  }
  return balances;
};

export const getPortfolioBalances = withTransaction(getPortfolioBalancesImpl);
