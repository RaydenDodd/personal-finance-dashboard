jest.mock('@models/investments/holdings.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/investments/broker-portfolio-data.model', () => ({
  __esModule: true,
  default: { findByPk: jest.fn().mockResolvedValue(null) },
}));
jest.mock('@models/investments/investment-transaction.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('@models/investments/security-pricing.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
import { Money } from '@common/types/money';
import Holdings from '@models/investments/holdings.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { Op } from 'sequelize';

import { getHoldingValues } from './get-holding-values.service';

it('uses a closing auction quote published after 16:00 when a later extended-hours row exists', async () => {
  const close = new Date('2026-11-20T21:00:03Z');
  const extended = new Date('2026-11-21T00:59:56Z');
  jest.mocked(Holdings.findAll).mockResolvedValue([
    {
      portfolioId: 'portfolio',
      securityId: 'security',
      quantity: Money.fromDecimal('2'),
      costBasis: Money.fromDecimal('1000'),
      refCostBasis: Money.fromDecimal('1000'),
      currencyCode: 'USD',
      excluded: false,
      security: { assetClass: 'stocks', currencyCode: 'USD', exchangeMic: 'ARCX' },
    },
  ] as never);
  jest
    .mocked(SecurityPricing.findAll)
    .mockResolvedValueOnce([{ securityId: 'security', date: extended }] as never)
    .mockResolvedValueOnce([
      { securityId: 'security', date: extended, priceAsOf: extended, source: 'yahoo', previousClose: null },
    ] as never)
    .mockImplementationOnce(async (query) => {
      const branches = (query!.where as any)[Op.or][0][Op.or];
      expect(branches[0].date[Op.lte]).toEqual(new Date('2026-11-20T21:00:00Z'));
      expect(branches[1].previousClose[Op.ne]).toBeNull();
      expect(branches[1].date[Op.lte]).toEqual(extended);
      return [{ securityId: 'security', date: close }] as never;
    })
    .mockResolvedValueOnce([
      {
        securityId: 'security',
        date: close,
        priceAsOf: close,
        source: 'yahoo',
        priceClose: Money.fromDecimal('635.54'),
        unadjustedClose: Money.fromDecimal('635.54'),
        previousClose: { date: '2026-11-19T21:00:00Z', price: '658.01' },
      },
    ] as never);
  const [holding] = await getHoldingValues({ portfolioId: 'portfolio' });
  expect(holding?.latestPrice).toBe('635.5400000000');
  expect(holding?.marketValue).toBe('1271.0800000000');
  expect(holding?.priceDate).toEqual(close);
});
