import {
  ASSET_CLASS,
  SECURITY_PROVIDER,
  PORTFOLIO_TYPE,
  INVESTMENT_TRANSACTION_CATEGORY,
} from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import PublicPortfolioConnection from '@models/investments/public-connection.model';
import Securities from '@models/investments/securities.model';
import { encryptCredentials, decryptCredentials } from '@services/bank-data-providers/utils/credential-encryption';
import { withLock } from '@services/common/lock';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { directCashTransaction } from '@services/investments/portfolios/transfers';
import { upsertSecuritiesFromSearch } from '@services/investments/securities-manage';
import { rememberSearchResults } from '@services/investments/securities/verified-search-cache';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { Big } from 'big.js';
import { createHash } from 'crypto';
import { Op } from 'sequelize';
import { z } from 'zod';

import { resolveBrokerCryptoIdentity } from './crypto-identity';
import { PublicReadClient } from './public-client';
import type { BrokerSnapshot } from './schema';
import { saveBrokerData } from './service';

const status = (c: PublicPortfolioConnection | null) => ({
  connected: !!c?.active,
  lastSyncAt: c?.lastSyncAt ?? null,
  error: c?.lastError ?? null,
  intervalHours: 6,
});
export const publicStatus = async (userId: number) => status(await PublicPortfolioConnection.findByPk(userId));
export const configurePublic = async (userId: number, secret: string) => {
  const client = new PublicReadClient();
  await client.authorize(secret);
  await client.accounts();
  await PublicPortfolioConnection.upsert({
    userId,
    encryptedCredentials: encryptCredentials({ secret }),
    active: true,
    lastError: null,
  });
  return publicStatus(userId);
};

const securityFor = async (symbol: string, type: string, name?: string | null) => {
  const assetClass = type === 'CRYPTO' ? ASSET_CLASS.crypto : ASSET_CLASS.stocks;
  if (!['CRYPTO', 'EQUITY', 'ETF', 'STOCK'].includes(type)) throw new Error('Unsupported Public security type.');
  const matches = await Securities.findAll({ where: { symbol, currencyCode: 'USD', assetClass } });
  if (matches.length > 1) throw new Error('Ambiguous Public security identity.');
  if (!matches[0] && assetClass === ASSET_CLASS.crypto) {
    const verified = await resolveBrokerCryptoIdentity(symbol, name);
    await rememberSearchResults({ results: [verified] });
    return (await upsertSecuritiesFromSearch({ securities: [verified] })).securities[0]!;
  }
  return (
    matches[0] ??
    Securities.create({
      symbol,
      name: name ?? symbol,
      providerSymbol: assetClass === ASSET_CLASS.crypto ? `${symbol}-USD` : symbol,
      currencyCode: 'USD',
      assetClass,
      providerName: SECURITY_PROVIDER.yahoo,
    })
  );
};

export const syncPublic = (userId: number) =>
  withLock(
    `public-portfolio:${userId}`,
    async () => {
      const connection = await PublicPortfolioConnection.findByPk(userId);
      if (!connection?.active) throw new Error('Public connection required.');
      try {
        const credentials = decryptCredentials(connection.encryptedCredentials);
        const client = new PublicReadClient();
        await client.authorize(z.string().parse(credentials.secret));
        let accountCount = 0;
        for (const account of await client.accounts()) {
          const current = await client.portfolio(account.accountId);
          const events = await client.history(account.accountId);
          const taxlots = z
            .object({ asOf: z.string().optional(), lots: z.array(z.record(z.string(), z.unknown())) })
            .parse(await client.read(`/userapigateway/trading/${account.accountId}/taxlots/unrealized`));
          const owned = await Portfolios.findAll({ where: { userId }, attributes: ['id'] });
          const sources = await BrokerPortfolioData.findAll({
            where: { portfolioId: { [Op.in]: owned.map((p) => p.id) } },
          });
          let portfolio: Portfolios | null = null;
          for (const source of sources)
            if (source.data.broker === 'public' && source.data.accountKey === account.accountId)
              portfolio = await Portfolios.findOne({ where: { id: source.portfolioId, userId } });
          if (!portfolio)
            portfolio = await Portfolios.create({
              userId,
              name: `Public ${account.accountType} ${account.accountId.slice(-4)}`,
              portfolioType: PORTFOLIO_TYPE.investment,
              displayCurrencyCode: 'USD',
              isEnabled: false,
              description:
                'Read-only Public portfolio mirror. Excluded from net worth to avoid duplicate connected balances. Broker snapshots are dated observations; transaction coverage may be incomplete.',
            });
          const portfolioId = portfolio.id;
          const review: string[] = [];
          const positions: BrokerSnapshot['positions'] = [];
          for (const p of current.positions) {
            const security = await securityFor(p.instrument.symbol, p.instrument.type, p.instrument.name);
            positions.push({
              securityId: security.id,
              symbol: p.instrument.symbol,
              quantity: p.quantity,
              costBasis: p.costBasis?.totalCost ?? null,
              marketValue: p.currentValue,
              lastPrice: p.lastPrice?.lastPrice,
            });
          }
          for (const e of events.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))) {
            const sourceRowId = createHash('sha256').update(`public:${account.accountId}:${e.id}`).digest('hex');
            const amount = new Big(e.netAmount ?? '0');
            const isTrade =
              e.type === 'TRADE' &&
              e.subType === 'TRADE' &&
              ['BUY', 'SELL'].includes(e.side ?? '') &&
              e.quantity &&
              new Big(e.quantity).abs().gt(0);
            if ((isTrade || e.subType === 'DIVIDEND') && e.symbol && e.securityType && !amount.eq(0)) {
              const security = await securityFor(e.symbol, e.securityType);
              await Holdings.findOrCreate({
                where: { portfolioId, securityId: security.id },
                defaults: {
                  currencyCode: 'USD',
                  quantity: Money.zero(),
                  costBasis: Money.zero(),
                  refCostBasis: Money.zero(),
                  excluded: false,
                },
              });
              const quantity = isTrade ? new Big(e.quantity!).abs() : new Big(1);
              const category = !isTrade
                ? INVESTMENT_TRANSACTION_CATEGORY.dividend
                : e.side === 'BUY'
                  ? INVESTMENT_TRANSACTION_CATEGORY.buy
                  : INVESTMENT_TRANSACTION_CATEGORY.sell;
              const brokerFees = new Big(e.fees ?? '0').abs();
              const gross =
                category === INVESTMENT_TRANSACTION_CATEGORY.buy
                  ? amount.abs().minus(brokerFees)
                  : amount.abs().plus(brokerFees);
              if (gross.lt(0)) throw new Error('Public fee exceeds the evidenced settlement.');
              // Exact settlement cash is authoritative. A net per-unit amount is derived, not a market quote.
              await createInvestmentTransaction({
                userId,
                portfolioId,
                securityId: security.id,
                date: e.timestamp,
                category,
                quantity: quantity.toString(),
                price: gross
                  .div(quantity)
                  .toFixed(10, category === INVESTMENT_TRANSACTION_CATEGORY.sell ? Big.roundUp : Big.roundDown),
                fees: brokerFees.toString(),
                settlementCurrencyCode: 'USD',
                settlementAmount: amount.abs().toFixed(10),
                sourceRowId,
                name: `Public ${e.description}; unit amount derived from verified settlement and broker fee ${brokerFees.toString()}.`,
              });
            } else if (e.type === 'MONEY_MOVEMENT' && !amount.eq(0)) {
              await directCashTransaction({
                userId,
                portfolioId,
                sourceRowId,
                type: amount.gt(0) ? 'deposit' : 'withdrawal',
                amount: amount.abs().toString(),
                currencyCode: 'USD',
                date: e.timestamp.slice(0, 10),
                isAdjustment: e.subType !== 'DEPOSIT' && e.subType !== 'WITHDRAWAL',
                description: `Public ${e.subType}: ${e.description}`,
              });
            } else
              review.push(
                `Public event ${e.id}: ${e.type}/${e.subType} retained for review; not converted to a trade.`,
              );
          }
          const asOf = new Date().toISOString();
          await saveBrokerData({
            userId,
            portfolioId,
            data: {
              broker: 'public',
              accountKey: account.accountId,
              snapshots: [
                {
                  id: `public:${asOf}`,
                  asOf,
                  source: `Public API portfolio snapshot; tax lots as of ${taxlots.asOf ?? 'not supplied'}`,
                  currencyCode: 'USD',
                  complete: true,
                  cash: current.cash ?? null,
                  totalValue: current.totalAccountValue ?? null,
                  positions,
                  lots: taxlots.lots,
                },
              ],
              documents: [],
              taxReports: [],
              sourceEvents: events.map((e) => ({ ...e })),
              historyComplete: false,
              review: [
                'API history may omit acquisitions predating available records. Annualized performance remains unavailable until inception and corporate actions are reconciled.',
                ...review,
              ],
            },
          });
          accountCount++;
        }
        await connection.update({ lastSyncAt: new Date(), lastError: null });
        return { ...status(connection), accounts: accountCount };
      } catch {
        // Never persist or serialize fetch errors, provider response bodies, tokens or credentials.
        await connection.update({
          lastError: 'Public sync failed. Stored history was preserved; check authorization and retry.',
        });
        throw new Error('Public sync failed. Stored history was preserved; check authorization and retry.');
      }
    },
    { ttl: 1800 },
  )();

export const syncDuePublic = async () => {
  let synced = 0,
    failed = 0;
  for (const c of await PublicPortfolioConnection.findAll({ where: { active: true } })) {
    if (await isBaseCurrencyChangeLocked({ userId: c.userId })) continue;
    if (c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() < 6 * 60 * 60 * 1000) continue;
    try {
      await syncPublic(c.userId);
      synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
};
