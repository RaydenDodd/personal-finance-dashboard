import { brokerDecimal, brokerSymbolsNeedingReview, parseBrokerPortfolioExport } from './broker-export-parser';

describe('broker portfolio source normalization', () => {
  it('retains signed cash, multiline descriptions and precise shares', () => {
    const result = parseBrokerPortfolioExport({
      accountKey: 'test',
      fileContent:
        'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount\n11/4/2026,11/4/2026,11/5/2026,ABC,"Company\nCUSIP: TEST",Buy,0.000009,$1000.00,($0.01)',
    });
    expect(result.events[0]).toMatchObject({
      kind: 'trade',
      quantity: '0.000009',
      reportedPrice: '1000',
      cashAmount: '-0.01',
    });
    expect(result.events[0]!.description).toContain('\n');
  });
  it('does not invent executions from M1 trading summaries', () => {
    const result = parseBrokerPortfolioExport({
      accountKey: 'test',
      fileContent:
        'Date,Activity,Value,Summary\n11/05/2026,Morning Trading\n11/05/2026,Position activity,1.012ABC Company\n11/05/2026,Dividend,0.44,ABC Company',
    });
    expect(result.events.map((event) => event.kind)).toEqual(['notice', 'review', 'dividend']);
    expect(result.events[0]!.quantity).toBeNull();
    expect(result.hasCompleteHoldings).toBe(false);
  });
  it('makes identical legitimate rows distinct while repeat imports are stable', () => {
    const input = {
      accountKey: 'test',
      fileContent: 'Date,Activity,Value,Summary\n11/05/2026,Deposit,200,\n11/05/2026,Deposit,200,',
    };
    const first = parseBrokerPortfolioExport(input),
      second = parseBrokerPortfolioExport(input);
    expect(first.events.map((event) => event.sourceRowId)).toEqual(second.events.map((event) => event.sourceRowId));
    expect(first.events[0]!.sourceRowId).not.toEqual(first.events[1]!.sourceRowId);
    expect(first.events[0]!.sourceRowId).not.toEqual(
      parseBrokerPortfolioExport({ ...input, accountKey: 'different' }).events[0]!.sourceRowId,
    );
  });
  it('blocks shares with unsupported corporate actions or missing acquisition history', () => {
    const parsed = parseBrokerPortfolioExport({
      accountKey: 'test',
      fileContent:
        'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount\n11/4/2026,,,ABC,Sale,Sell,2,$5,$10\n11/3/2026,,,XYZ,Split,SPL,3,,',
    });
    expect(brokerSymbolsNeedingReview(parsed.events)).toEqual(['ABC', 'XYZ']);
  });
  it('rejects invalid dates and keeps missing money distinct from zero', () => {
    expect(brokerDecimal('')).toBeNull();
    expect(brokerDecimal('$0.00')).toBe('0');
    expect(brokerDecimal('($1,234.56)')).toBe('-1234.56');
    const parsed = parseBrokerPortfolioExport({
      accountKey: 'test',
      fileContent: 'Date,Activity,Value,Summary\n02/30/2026,Deposit,200,',
    });
    expect(parsed.events).toHaveLength(0);
    expect(parsed.issues).toHaveLength(2);
  });
  it('reviews a trade with impossible cash direction instead of inventing its cost basis', () => {
    const parsed = parseBrokerPortfolioExport({
      accountKey: 'test',
      fileContent:
        'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount\n11/4/2026,,,ABC,Purchase,Buy,2,$5,$10\n11/3/2026,,,XYZ,Gift,Buy,3,$0,$0',
    });
    expect(parsed.events.map((event) => event.kind)).toEqual(['review', 'review']);
    expect(brokerSymbolsNeedingReview(parsed.events)).toEqual(['ABC', 'XYZ']);
  });
});

const m1Header = 'Date,Posted Date,Symbol,Description,Transaction Type,Amount,Units,Unit Type,Unit Price,Security Id,Security Id Type';
describe('M1 detailed execution export', () => {
  const deposit = '"Jan 5, 2025","Jan 5, 2025",,ACH deposit of $50 completed.,TRANSFER,$50.00,--,CURRENCY,--,,';
  const buy = '"Jan 6, 2025","Jan 6, 2025",ABC,0.5 shares purchased.,PURCHASED,$50.00,0.5,SHARES,$100.00,123456789,CUSIP';
  const sell = '"Jan 7, 2025","Jan 8, 2025",ABC,0.1 shares sold.,SOLD,-$10.00,-0.1,SHARES,$100.00,123456789,CUSIP';
  const parse = (rows: string[]) => parseBrokerPortfolioExport({ accountKey: 'synthetic-m1', fileContent: [m1Header, ...rows].join('\n') });
  it('normalizes purchase and sale signs and retains both dates and security identity', () => {
    const result = parse([buy, sell, deposit]);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ kind: 'trade', action: 'Buy', quantity: '0.5', cashAmount: '-50', securityId: '123456789', securityIdType: 'CUSIP' });
    expect(result.events[1]).toMatchObject({ kind: 'trade', action: 'Sell', quantity: '0.1', cashAmount: '10', postedDate: '2025-01-08' });
    expect(result.events[2]).toMatchObject({ kind: 'cash', cashAmount: '50' });
    expect(result.hasCompleteHoldings).toBe(false);
  });
  it('preserves repeated same-day deposit occurrences and stable overlapping source identities', () => {
    const first = parse([deposit, buy, deposit]);
    const second = parse([sell, deposit, deposit, buy]);
    expect(new Set(first.events.map(e => e.sourceRowId)).size).toBe(3);
    expect(second.events.slice(1).map(e => e.sourceRowId).sort()).toEqual(first.events.map(e => e.sourceRowId).sort());
  });
  it('keeps returned ACH and bonuses out of external funding', () => {
    const result = parse([
      '"Jan 5, 2025","Jan 5, 2025",,ACH deposit of $50 was returned.,OTHER,-$50.00,--,CURRENCY,--,,',
      '"Jan 5, 2025","Jan 5, 2025",,Sign Up Bonus,CASH,$10.00,--,CURRENCY,--,,',
    ]);
    expect(result.events.map(e => e.kind)).toEqual(['review', 'review']);
  });
});
