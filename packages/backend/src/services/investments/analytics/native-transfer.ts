import { Money } from '@common/types/money';
import type PortfolioTransfers from '@models/investments/portfolio-transfers.model';

import { externalFlow } from './math';

/** Read native model getters explicitly: spreading Sequelize instances drops column fields. */
export function nativeExternalFlow(
  t: Pick<
    PortfolioTransfers,
    'fromPortfolioId' | 'toPortfolioId' | 'isAdjustment' | 'refAmount' | 'refToAmount' | 'toCurrencyCode'
  >,
  selected: Set<string>,
) {
  const decimal = (value: Money | string) => (Money.isMoney(value) ? value.toDecimalString(18) : String(value));
  return externalFlow(
    {
      fromPortfolioId: t.fromPortfolioId,
      toPortfolioId: t.toPortfolioId,
      isAdjustment: t.isAdjustment,
      refAmount: decimal(t.refAmount),
      refToAmount: t.toCurrencyCode && t.refToAmount != null ? decimal(t.refToAmount) : null,
    },
    selected,
  );
}
