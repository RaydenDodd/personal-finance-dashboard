import { TRANSACTION_TYPES } from '@bt/shared/types';
import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, UnexpectedError, ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { recalculateHolding } from '@services/investments/holdings/recalculation.service';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { getExchangeRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { Big } from 'big.js';
import { Op } from 'sequelize';

import { lockBrokerImportRow } from '../broker-import-provenance';
import { calculateCashDelta } from './cash-balance-utils';
import { resolveSettlement } from './settlement-utils';

interface CreateTxParams {
  userId: number;
  portfolioId: string;
  securityId: string;
  category: INVESTMENT_TRANSACTION_CATEGORY;
  date: string;
  quantity: string;
  price: string;
  fees: string;
  name?: string;
  /** Stable identifier from the broker CSV parser. Replaying it returns the original row. */
  sourceRowId?: string;
  /** Broker reports rounded execution price/quantity and exact cash independently. Internal CSV path only. */
  brokerRoundedSettlement?: boolean;
  /**
   * Settlement leg — the cash side of the trade when it differs from the
   * security's own currency (single-cash-currency brokers, e.g. a PLN account
   * trading USD securities), or when the user only knows the total cash moved
   * and wants the fee derived. See `resolveSettlement` for the math.
   */
  settlementCurrencyCode?: string;
  settlementAmount?: string;
  settlementFees?: string;
  /**
   * Security→settlement rate the user read off the broker statement. The fee
   * is derived as the residual. When neither this nor settlementFees is given
   * for a cross-currency settlement, the market rate for the trade date is
   * used instead. Mutually exclusive with settlementFees.
   */
  settlementRate?: string;
  /**
   * Optional pre-loaded holding (with `security` and `portfolio` includes) +
   * a flag indicating the caller has already verified portfolio ownership.
   * Used by the bulk import loop to skip a portfolio query + a holding query
   * per row. Without this the function fetches both itself, as before.
   */
  preloadedHolding?: Holdings;
}

const createInvestmentTransactionImpl = async (params: CreateTxParams) => {
  const { portfolioId, securityId, userId, category, quantity, price, fees, date, preloadedHolding } = params;

  await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: `investment-trade:${userId}:${portfolioId}` } });
  let sourceMarker: string | undefined;
  if (params.sourceRowId) {
    await findOrThrowNotFound({
      query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
      message: t({ key: 'investments.portfolioNotFound' }),
    });
    sourceMarker = await lockBrokerImportRow({ userId, portfolioId, sourceRowId: params.sourceRowId });
    const existing = await InvestmentTransaction.findOne({
      where: { portfolioId, name: { [Op.like]: `${sourceMarker}%` } },
    });
    if (existing) return existing;
  }

  let holding: Holdings;
  if (preloadedHolding) {
    // Caller has already verified ownership and loaded the holding with its
    // `portfolio` + `security` includes — the import loop hits the same
    // (portfolioId, securityId) for every row of a holding, so re-fetching
    // here would be wasted work. Defense in depth: re-verify that the
    // preloaded portfolio actually belongs to this user. A future caller that
    // forgets the ownership check upstream would silently grant cross-tenant
    // writes without this guard.
    if (!preloadedHolding.portfolio || preloadedHolding.portfolio.userId !== userId) {
      throw new ValidationError({
        message: 'preloadedHolding ownership mismatch — portfolio does not belong to the calling user.',
      });
    }
    holding = preloadedHolding;
  } else {
    await findOrThrowNotFound({
      query: Portfolios.findOne({
        where: { id: portfolioId, userId },
      }),
      message: t({ key: 'investments.portfolioNotFound' }),
    });

    holding = await findOrThrowNotFound({
      query: Holdings.findOne({
        where: { portfolioId, securityId },
        include: [
          { model: Portfolios, as: 'portfolio', where: { userId }, required: true },
          { model: Securities, as: 'security', required: true },
        ],
      }),
      message: t({ key: 'investments.holdingNotFoundAddSecurity' }),
    });
  }

  // Crypto holdings often drift from the on-chain truth (staking rewards, gas
  // fees, missed transfers), so we trust the user and let the position go
  // negative — a follow-up "adjust to zero" flow will reconcile the leftover.
  // Stocks have exact share counts, so we keep the strict check.
  const isCrypto = holding.security?.assetClass === ASSET_CLASS.crypto;
  // An imported historical disposal may predate the available acquisitions or a
  // corporate action. Record the evidenced disposal without inventing a buy.
  // This exception is confined to idempotent imports into non-additive mirrors;
  // ordinary/manual sales and enabled portfolios retain the share guard.
  const incompleteMirrorImport = !!params.sourceRowId && holding.portfolio?.isEnabled === false;
  if (category === INVESTMENT_TRANSACTION_CATEGORY.sell && !isCrypto && !incompleteMirrorImport) {
    const currentQty = new Big(holding.quantity.toDecimalString(10));
    if (new Big(quantity).gt(currentQty)) {
      throw new ValidationError({
        message: 'Cannot sell more shares than currently owned.',
      });
    }
  }

  const requestedSettlementCurrencyCode = params.settlementCurrencyCode ?? holding.currencyCode;
  const isCrossCurrency = requestedSettlementCurrencyCode !== holding.currencyCode;

  // ensureUserCurrencyConnected idempotently links the settlement currency
  // (e.g. PLN for the user's first PLN-settled trade) so the market-rate
  // and ref-amount lookups below don't fail with `currencyNotConnected`.
  if (isCrossCurrency) {
    await ensureUserCurrencyConnected({ userId, currencyCode: requestedSettlementCurrencyCode });
  }

  // "Auto" mode: caller didn't supply fee or rate, so we look up the market
  // rate for the trade date and let resolveSettlement derive the fee as the
  // residual between the cash moved and the market-priced notional.
  let marketRate: string | undefined;
  if (isCrossCurrency && params.settlementFees === undefined && params.settlementRate === undefined) {
    await ensureUserCurrencyConnected({ userId, currencyCode: holding.currencyCode });
    try {
      const { rate } = await getExchangeRate({
        userId,
        date: new Date(date),
        baseCode: holding.currencyCode,
        quoteCode: requestedSettlementCurrencyCode,
      });
      marketRate = String(rate);
    } catch (error) {
      // Only the rate-genuinely-missing path is a user input issue. Bugs and
      // outages must surface as 500s instead of being painted as missing rates.
      if (error instanceof NotFoundError || error instanceof UnexpectedError) {
        throw new ValidationError({
          message: `No market exchange rate available for ${holding.currencyCode}→${requestedSettlementCurrencyCode} on ${date}. Enter the fee or the exchange rate manually.`,
        });
      }
      throw error;
    }
  }

  let settlement: ReturnType<typeof resolveSettlement>;
  if (params.brokerRoundedSettlement) {
    if (!params.sourceRowId || category !== INVESTMENT_TRANSACTION_CATEGORY.buy || isCrossCurrency || params.settlementAmount === undefined || !new Big(fees || '0').eq(0) || new Big(params.settlementAmount).lte(0) || new Big(params.settlementAmount).minus(new Big(quantity).times(price)).abs().gt('0.01')) {
      throw new ValidationError({ message: 'Invalid rounded broker settlement.' });
    }
    // Exact reported cash is authoritative; the separate execution price is
    // preserved and a sub-cent statement rounding difference is not a fee.
    const actual = new Big(params.settlementAmount).toFixed(10);
    settlement = { fees: '0', amount: actual, settlementCurrencyCode: holding.currencyCode, settlementAmount: actual, settlementFees: '0', settlementRate: '1' };
  } else settlement = resolveSettlement({
    category,
    quantity,
    price,
    fees,
    holdingCurrencyCode: holding.currencyCode,
    settlementCurrencyCode: params.settlementCurrencyCode,
    settlementAmount: params.settlementAmount,
    settlementFees: params.settlementFees,
    settlementRate: params.settlementRate ?? marketRate,
  });

  // Convert the settlement-currency cash into the security currency at the
  // broker's effective rate before feeding it to calculateRefAmount, so the
  // base-currency total reflects what actually moved (not the market rate).
  const rate = new Big(settlement.settlementRate);
  const amountInSettlement = new Big(settlement.amount).times(rate).toFixed(10);
  const priceInSettlement = new Big(price || '0').times(rate).toFixed(10);

  const [refAmount, refPrice, refFees] = await Promise.all([
    calculateRefAmount({
      amount: Money.fromDecimal(amountInSettlement),
      userId,
      date,
      baseCode: settlement.settlementCurrencyCode,
    }),
    calculateRefAmount({
      amount: Money.fromDecimal(priceInSettlement),
      userId,
      date,
      baseCode: settlement.settlementCurrencyCode,
    }),
    calculateRefAmount({
      amount: Money.fromDecimal(settlement.settlementFees),
      userId,
      date,
      baseCode: settlement.settlementCurrencyCode,
    }),
  ]);

  const newTx = await InvestmentTransaction.create({
    ...params,
    name: sourceMarker ? `${sourceMarker} ${params.name ?? ''}`.slice(0, 2000) : params.name,
    // Normalize the API string to a Date so the TIMESTAMPTZ column receives a
    // proper instant regardless of DB session timezone. A date-only input
    // (e.g. '2026-03-01') becomes UTC midnight; a full ISO datetime is kept at
    // its exact instant. This overrides the raw string spread from `...params`.
    date: new Date(date),
    fees: settlement.fees,
    amount: settlement.amount,
    currencyCode: holding.currencyCode,
    settlementCurrencyCode: settlement.settlementCurrencyCode,
    settlementAmount: settlement.settlementAmount,
    settlementFees: settlement.settlementFees,
    settlementRate: settlement.settlementRate,
    refAmount,
    refPrice,
    refFees,
    transactionType:
      category === INVESTMENT_TRANSACTION_CATEGORY.buy ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
  });

  await recalculateHolding({ portfolioId, securityId });

  const cashDelta = calculateCashDelta({
    category,
    settlementAmount: settlement.settlementAmount,
  });

  if (cashDelta !== null) {
    await updatePortfolioBalance({
      userId,
      portfolioId,
      currencyCode: settlement.settlementCurrencyCode,
      availableCashDelta: cashDelta,
      totalCashDelta: cashDelta,
    });
  }

  // `recalculateHolding` saves through its own instance; refresh the caller's so its next sell guard sees the new quantity.
  await preloadedHolding?.reload();

  return newTx;
};

export const createInvestmentTransaction = withTransaction(createInvestmentTransactionImpl);
