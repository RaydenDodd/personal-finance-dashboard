import { dailyPositionChange } from './daily-performance';
describe('native-position daily attribution', () => {
  it('uses prior close rather than lifetime basis', () => {
    expect(dailyPositionChange({ quantity: '10', marketValue: '1100', previousClose: '100', trades: [] })).toEqual({
      change: '100',
      capital: '1000',
      percent: '10.000000',
    });
  });
  it('removes same-day purchases and includes fees in native net cash', () => {
    expect(
      dailyPositionChange({
        quantity: '12',
        marketValue: '1320',
        previousClose: '100',
        trades: [{ category: 'buy', quantity: '2', amount: '211' }],
      }),
    ).toEqual({ change: '109', capital: '1211', percent: '9.000826' });
  });
  it('retains the gain on a position fully sold today', () => {
    expect(
      dailyPositionChange({
        quantity: '0',
        marketValue: '0',
        previousClose: '100',
        trades: [{ category: 'sell', quantity: '10', amount: '1099' }],
      }),
    ).toEqual({ change: '99', capital: '1000', percent: '9.900000' });
  });
  it('does not call a deposit or round trip a price gain', () => {
    expect(
      dailyPositionChange({
        quantity: '0',
        marketValue: '0',
        previousClose: '100',
        trades: [
          { category: 'buy', quantity: '1', amount: '101' },
          { category: 'sell', quantity: '1', amount: '109' },
        ],
      }),
    ).toEqual({ change: '8', capital: '101', percent: '7.920792' });
  });
  it('leaves inconsistent opening positions unsupported', () => {
    expect(
      dailyPositionChange({
        quantity: '0',
        marketValue: '0',
        previousClose: '100',
        trades: [{ category: 'buy', quantity: '1', amount: '100' }],
      }),
    ).toBeNull();
  });
});
