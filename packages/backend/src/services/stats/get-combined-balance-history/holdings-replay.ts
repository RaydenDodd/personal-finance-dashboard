import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';

import type { HoldingState, SecurityRow, TransactionRow } from './types';

/**
 * Replay buy/sell transactions to derive per-portfolio holdings on each
 * snapshot date, value them via `findPriceForDate` → `getExchangeRate`, and
 * sum the result across all portfolios per date.
 *
 * Cost-basis/quantity tracking mirrors `computeHoldingTotals`
 * (`services/investments/holdings/holding-totals.ts`) — keep in sync, or an
 * oversell mid-history (allowed for crypto drift) drops the holding and the
 * next buy reinflates it, ballooning market value.
 *
 * Transactions within each portfolio MUST be sorted ascending by date — the
 * inner loop breaks at the first transaction past the snapshot.
 *
 * Invokes `onMissingPrice({ securityId, dateStr })` whenever a held security has
 * no price for a snapshot day and is valued at cost basis instead, so callers
 * that report valuation quality can name the affected securities.
 */
export const computeHoldingsValueByDate = ({
  uniqueDates,
  portfolioIds,
  transactionsByPortfolio,
  securitiesById,
  findPriceForDate,
  getExchangeRate,
  floorValues = true,
  onMissingPrice,
  positionAnchorsByPortfolio,
  onHoldingValue,
  dateKey = toUtcDateString,
  shareUnitFactor = () => 1,
  mergePositionAnchors = false,
  onUnknownQuantity,
  onHoldingQuantity,
  onAnchorDifference,
}: {
  uniqueDates: string[];
  portfolioIds: string[];
  transactionsByPortfolio: Map<string, TransactionRow[]>;
  securitiesById: Map<string, SecurityRow>;
  findPriceForDate: (securityId: string, targetDate: string) => number | null;
  getExchangeRate: (currencyCode: string, dateStr: string) => number;
  /** Truncates each holding's base value to a whole currency unit; pass false to keep the decimals. */
  floorValues?: boolean;
  onMissingPrice?: ({ securityId, dateStr }: { securityId: string; dateStr: string }) => void;
  /** Read-only analytics hook; quantity and valuation still come from this native replay. */
  onHoldingValue?: (row: {
    portfolioId: string;
    securityId: string;
    date: string;
    value: number;
    quantity: number;
  }) => void;
  dateKey?: (date: Date | string) => string;
  /** Optional market-data unit adapter. Does not persist share or transaction changes. */
  shareUnitFactor?: (securityId: string, date: string) => number;
  mergePositionAnchors?: boolean;
  onUnknownQuantity?: (row: { securityId: string; dateStr: string }) => void;
  onHoldingQuantity?: (row: { portfolioId: string; securityId: string; date: string; quantity: number | null }) => void;
  onAnchorDifference?: (row: {
    portfolioId: string;
    securityId: string;
    date: string;
    expected: number | null;
    observed: number;
  }) => void;
  /** Real complete broker positions establish an opening balance only from their dated observation forward. */
  positionAnchorsByPortfolio?: Map<
    string,
    {
      asOf: string;
      complete?: boolean;
      opening?: boolean;
      positions: { securityId: string; quantity: string; costBasis: string | null }[];
    }[]
  >;
}): Map<string, number> => {
  const holdingsValueByDate = new Map<string, number>();

  // Running holdings + a forward-only cursor per portfolio: dates and txs are
  // both ascending, so each tx is folded in once and every date values the
  // holdings accumulated so far.
  const holdingsByPortfolio = new Map<string, Map<string, HoldingState>>();
  const cursorByPortfolio = new Map<string, number>();
  const appliedAnchor = new Map<string, string>();
  type Anchor = NonNullable<typeof positionAnchorsByPortfolio> extends Map<string, (infer A)[]> ? A : never;
  const events = new Map(
    portfolioIds.map((id) => [
      id,
      [
        ...(transactionsByPortfolio.get(id) ?? []).map((tx) => ({
          date: tx.date,
          tx,
          anchor: undefined as Anchor | undefined,
        })),
        ...(mergePositionAnchors ? (positionAnchorsByPortfolio?.get(id) ?? []) : []).map((anchor) => ({
          date: new Date(anchor.asOf),
          tx: undefined as TransactionRow | undefined,
          anchor,
        })),
      ].sort(
        (a, b) =>
          dateKey(a.date).localeCompare(dateKey(b.date)) ||
          (a.anchor?.opening ? -1 : b.anchor?.opening ? 1 : new Date(a.date).getTime() - new Date(b.date).getTime()),
      ),
    ]),
  );
  for (const portfolioId of portfolioIds) {
    holdingsByPortfolio.set(portfolioId, new Map<string, HoldingState>());
    cursorByPortfolio.set(portfolioId, 0);
  }

  for (const dateStr of uniqueDates) {
    let totalValueForDate = 0;

    for (const portfolioId of portfolioIds) {
      const portfolioTxs = transactionsByPortfolio.get(portfolioId) ?? [];
      const holdings = holdingsByPortfolio.get(portfolioId)!;
      let cursor = cursorByPortfolio.get(portfolioId)!;
      const anchor =
        !mergePositionAnchors &&
        positionAnchorsByPortfolio?.get(portfolioId)?.findLast((a) => dateKey(a.asOf) <= dateStr);
      if (anchor && appliedAnchor.get(portfolioId) !== anchor.asOf) {
        holdings.clear();
        for (const position of anchor.positions) {
          const security = securitiesById.get(position.securityId);
          holdings.set(position.securityId, {
            quantity: Number(position.quantity) * shareUnitFactor(position.securityId, dateKey(anchor.asOf)),
            costBasis: Number(position.costBasis ?? 0),
            currencyCode: security?.currencyCode ?? 'USD',
            assetClass: security?.assetClass ?? ASSET_CLASS.other,
          });
        }
        cursor = 0;
        while (cursor < portfolioTxs.length && new Date(portfolioTxs[cursor]!.date) <= new Date(anchor.asOf)) cursor++;
        appliedAnchor.set(portfolioId, anchor.asOf);
      }

      // Fold in every transaction that settled on or before this snapshot day.
      const portfolioEvents = events.get(portfolioId)!;
      while (cursor < portfolioEvents.length) {
        const event = portfolioEvents[cursor]!;
        if (dateKey(event.date) > dateStr) break;
        if (event.anchor) {
          if (onAnchorDifference && !event.anchor.opening) {
            const ids = new Set([
              ...event.anchor.positions.map((p) => p.securityId),
              ...(event.anchor.complete ? holdings.keys() : []),
            ]);
            for (const id of ids) {
              const previousQuantity = holdings.get(id)?.quantity;
              const old = previousQuantity != null && Number.isFinite(previousQuantity) ? previousQuantity : null,
                p = event.anchor.positions.find((p) => p.securityId === id);
              const observed = Number(p?.quantity ?? 0) * shareUnitFactor(id, dateKey(event.date));
              if (old === null ? observed > 0 : Math.abs(old - observed) > (Math.abs(observed) + 1) * 1e-8)
                onAnchorDifference({ portfolioId, securityId: id, date: dateKey(event.date), expected: old, observed });
            }
          }
          if (event.anchor.complete) holdings.clear();
          for (const p of event.anchor.positions) {
            const security = securitiesById.get(p.securityId);
            holdings.set(p.securityId, {
              quantity:
                Number(p.quantity) * (event.anchor.opening ? 1 : shareUnitFactor(p.securityId, dateKey(event.date))),
              costBasis: Number(p.costBasis ?? 0),
              currencyCode: security?.currencyCode ?? 'USD',
              assetClass: security?.assetClass ?? ASSET_CLASS.other,
            });
          }
          cursor++;
          continue;
        }
        const tx = event.tx!;
        // `tx.date` is TIMESTAMPTZ; bucket to its UTC calendar day so the
        // comparison against the `yyyy-MM-dd` snapshot key is lexicographic.
        if (dateKey(tx.date) > dateStr) break;

        const securityId = tx.securityId;
        // Raw rows carry DECIMALs as strings (see `TransactionRow`); this replay
        // runs on floats anyway, so plain Number() conversion loses nothing.
        const quantity = Number(tx.quantity) * shareUnitFactor(securityId, dateKey(tx.date));
        // Read only for buys, where `refAmount` is the leg's full cost in base currency —
        // quantity × price *including* fees, as `resolveSettlement` composes it. That is exactly
        // what `computeHoldingTotals` folds into the basis, so `refFees` must not
        // be added on top of it: the fee is already in there and would count twice.
        const totalAmount = Number(tx.refAmount);

        if (!holdings.has(securityId)) {
          const security = securitiesById.get(securityId);
          holdings.set(securityId, {
            quantity: 0,
            costBasis: 0,
            currencyCode: security?.currencyCode ?? tx.currencyCode,
            assetClass: security?.assetClass ?? ASSET_CLASS.other,
          });
        }

        const holding = holdings.get(securityId)!;

        if (mergePositionAnchors && tx.cashInLieu) {
          const candidate = Number.isFinite(holding.quantity)
            ? holding.quantity
            : holding.quantityBeforeUnresolvedAction;
          const factor = shareUnitFactor(securityId, dateKey(tx.date));
          const atEvent = candidate == null ? NaN : candidate / factor;
          const whole = Math.floor(atEvent + 1e-9),
            fraction = Math.max(0, atEvent - whole);
          const record = tx.cashInLieu;
          const precision = 10 ** -(record.quantity.split('.')[1]?.length ?? 0);
          const reconciles =
            Number.isFinite(atEvent) &&
            atEvent >= 0 &&
            fraction > 0 &&
            Number(record.price) > 0 &&
            Math.abs(fraction - Number(record.quantity)) <= precision + 1e-9 &&
            Math.abs(fraction * Number(record.price) - Number(record.amount)) <= 0.015;
          holding.quantity = reconciles ? whole * factor : NaN;
          holding.quantityBeforeUnresolvedAction = undefined;
          if (reconciles && candidate != null && candidate > 0) holding.costBasis *= holding.quantity / candidate;
        } else if (mergePositionAnchors && tx.quantityUnknown) {
          holding.quantityBeforeUnresolvedAction = Number.isFinite(holding.quantity) ? holding.quantity : undefined;
          holding.quantity = NaN;
        } else if (mergePositionAnchors && tx.category === INVESTMENT_TRANSACTION_CATEGORY.transfer && quantity !== 0) {
          holding.quantityBeforeUnresolvedAction = undefined;
          holding.quantity =
            tx.transactionType === 'income'
              ? holding.quantity + quantity
              : tx.transactionType === 'expense'
                ? holding.quantity - quantity
                : NaN;
        } else if (tx.category === INVESTMENT_TRANSACTION_CATEGORY.buy) {
          holding.quantityBeforeUnresolvedAction = undefined;
          const newQuantity = holding.quantity + quantity;
          if (newQuantity <= 0) {
            holding.costBasis = 0;
          } else if (holding.quantity <= 0) {
            // Buy crosses from short/zero into long — only the long portion is new basis.
            const longProportion = newQuantity / quantity;
            holding.costBasis = totalAmount * longProportion;
          } else {
            holding.costBasis += totalAmount;
          }
          holding.quantity = newQuantity;
        } else if (tx.category === INVESTMENT_TRANSACTION_CATEGORY.sell) {
          holding.quantityBeforeUnresolvedAction = undefined;
          if (holding.quantity > 0) {
            const newQuantity = holding.quantity - quantity;
            if (newQuantity <= 0) {
              holding.costBasis = 0;
            } else {
              const remainingProportion = newQuantity / holding.quantity;
              holding.costBasis *= remainingProportion;
            }
          }
          holding.quantity -= quantity;
        }

        cursor += 1;
      }
      cursorByPortfolio.set(portfolioId, cursor);

      for (const [securityId, holding] of holdings) {
        if (onUnknownQuantity && (!Number.isFinite(holding.quantity) || holding.quantity < -1e-9)) {
          onHoldingQuantity?.({ portfolioId, securityId, date: dateStr, quantity: null });
          onUnknownQuantity({ securityId, dateStr });
          continue;
        }
        // Stocks cap at zero; crypto can legitimately drift negative until reconciled.
        const allowNegative = holding.assetClass === ASSET_CLASS.crypto;
        const effectiveQuantity = !allowNegative && holding.quantity < 0 ? 0 : holding.quantity;
        onHoldingQuantity?.({ portfolioId, securityId, date: dateStr, quantity: effectiveQuantity });
        if (effectiveQuantity === 0) continue;

        const currentPrice = findPriceForDate(securityId, dateStr);

        if (currentPrice !== null) {
          const marketValueInSecurityCurrency = effectiveQuantity * currentPrice;
          const exchangeRate = getExchangeRate(holding.currencyCode, dateStr);
          const unfloored = marketValueInSecurityCurrency * exchangeRate;
          const marketValueInBaseCurrency = floorValues ? Math.floor(unfloored) : unfloored;
          totalValueForDate += marketValueInBaseCurrency;
          onHoldingValue?.({
            portfolioId,
            securityId,
            date: dateStr,
            value: marketValueInBaseCurrency,
            quantity: effectiveQuantity,
          });
        } else {
          // No price for this day — value the holding at cost basis so the line
          // stays continuous instead of collapsing to zero. It is only an
          // approximation: it carries the purchase cost forward and shows none of
          // the gain/loss since, so callers presenting the number are told via
          // `onMissingPrice` and can disclose that the day is partly unpriced.
          onMissingPrice?.({ securityId, dateStr });
          totalValueForDate += holding.costBasis;
        }
      }
    }

    holdingsValueByDate.set(dateStr, totalValueForDate);
  }

  return holdingsValueByDate;
};
