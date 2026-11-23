import { accountGainSeries, accountPeriodSeries, sumGainSeries } from './account-history-gains';

describe('cached dollar account gains', () => {
  it('removes deposits and withdrawals from period value changes, including the first day', () => {
    const result = accountGainSeries(
      [
        { date: '2026-10-31', value: '1000', funding: '800' },
        { date: '2026-11-01', value: '1250', funding: '1100' },
        { date: '2026-11-02', value: '1170', funding: '1000' },
      ],
      '2026-11-01',
    );
    expect(result.gains).toEqual(['200', '150', '170']);
    expect(result.periodGains).toEqual([null, '-50', '-30']);
  });
  it('does not invent missing funding or an opening observation', () => {
    expect(accountGainSeries([{ date: '2026-11-01', value: '500', funding: null }], '2026-11-01')).toEqual({
      gains: [null],
      periodGains: [null],
    });
    expect(accountGainSeries([{ date: '2026-11-01', value: '500', funding: '400' }], '2026-11-01').periodGains).toEqual(
      [null],
    );
    expect(
      sumGainSeries(
        [
          ['10', null],
          [null, null],
        ],
        2,
      ),
    ).toEqual(['10', null]);
  });
});

describe('date-selected account performance', () => {
  it('uses the preceding close and excludes deposits and withdrawals from gains', () => {
    const result = accountPeriodSeries(
      [
        { date: '2026-10-31', value: '1000', funding: '800' },
        { date: '2026-11-01', value: '1250', funding: '1100' },
        { date: '2026-11-02', value: '1170', funding: '1000' },
      ],
      '2026-11-01',
    );
    expect(result.periodGains).toEqual([null, '-50', '-30']);
    expect(result.periodCapital).toEqual([null, '1000', '1150']);
    expect(Number(result.periodReturnPercent[1])).toBe(-5);
    expect(Number(result.periodReturnPercent[2])).toBeCloseTo((-30 / 1150) * 100);
  });
  it('uses the first evidenced valuation for MAX, never an invented opening balance', () => {
    const result = accountPeriodSeries(
      [
        { date: '2019-12-12', value: null, funding: null },
        { date: '2019-12-13', value: '100', funding: '80' },
        { date: '2019-12-16', value: '110', funding: '80' },
      ],
      '1900-01-01',
    );
    expect(result.periodGains).toEqual([null, '0', '10']);
    expect(result.periodReturnPercent).toEqual([null, '0', '10']);
  });
  it('does not interpolate unknown funding into an estimated return', () => {
    const result = accountPeriodSeries([
      { date: '2026-11-01', value: '100', funding: '80' },
      { date: '2026-11-02', value: '150', funding: null },
      { date: '2026-11-03', value: '160', funding: '100' },
    ]);
    expect(result.periodGains).toEqual(['0', null, '40']);
    expect(result.periodReturnPercent).toEqual(['0', null, null]);
  });
});
