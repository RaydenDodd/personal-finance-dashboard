import Big from 'big.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { parseCompositionFile } from './parsers';

const input = (
  raw: string | Buffer,
  adapter: 'sec-nport' | 'ishares-csv' | 'ssga-xlsx' | 'sec-gold-facts',
  symbol: string,
) => ({
  fundId: 'fund',
  symbol,
  adapter,
  fileName: 'original-source',
  base64: Buffer.from(raw).toString('base64'),
  sourceUrl:
    adapter === 'sec-gold-facts'
      ? 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001222333.json'
      : 'https://www.sec.gov/Archives/edgar/data/1432353/000143235326000001/primary_doc.xml',
});
const security = (weight = '60', value = '600') =>
  `<invstOrSec><name>Microsoft Corp</name><title>Microsoft Corp</title><cusip>594918104</cusip><identifiers><isin value="US5949181045"/></identifiers><valUSD>${value}</valUSD><pctVal>${weight}</pctVal><curCd>USD</curCd><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>`;
const nport = (rows = security(), series = 'S000075250', date = '2026-07-31') =>
  `<?xml version="1.0"?><edgarSubmission xmlns="http://www.sec.gov/edgar/nport"><headerData><filerInfo><seriesClassInfo><classId>C000234113</classId></seriesClassInfo></filerInfo></headerData><formData><genInfo><regCik>1432353</regCik><seriesId>${series}</seriesId><repPdDate>${date}</repPdDate><repPdEnd>2099-12-31</repPdEnd></genInfo><fundInfo><netAssets>1000</netAssets><totAssets>1010</totAssets><totLiabs>10</totLiabs><cshNotRptdInCorD>0</cshNotRptdInCorD></fundInfo><invstOrSecs>${rows}</invstOrSecs></formData></edgarSubmission>`;

describe('issuer composition source validation', () => {
  it('uses reported equity categories rather than matching company-name words such as Gold or Option', async () => {
    for (const name of ['Goldman Sachs Group Inc', 'Option Care Health Inc']) {
      const raw = nport(security().replaceAll('Microsoft Corp', name));
      expect((await parseCompositionFile(input(raw, 'sec-nport', 'DJIA'))).holdings[0]?.assetClass).toBe('Equity');
    }
  });
  it('uses the SEC report date, verifies series/class and reconciles signed options without scaling equity', async () => {
    const option = `<invstOrSec><name>N/A</name><title>Dow call option</title><valUSD>-5</valUSD><pctVal>-.5</pctVal><assetCat>DIR</assetCat><derivativeInfo><optionSwaptionWarrantDeriv><desc>Short Dow call</desc></optionSwaptionWarrantDeriv></derivativeInfo></invstOrSec>`;
    const raw = nport(security('100', '1000') + option);
    const snapshot = await parseCompositionFile(input(raw, 'sec-nport', 'DJIA'));
    expect(snapshot.asOf).toBe('2026-07-31');
    expect(snapshot.holdings.find((h) => h.assetClass === 'Equity')?.weight).toBe('100');
    expect(snapshot.holdings.find((h) => h.assetClass === 'Derivative')).toMatchObject({
      weight: '-0.5',
      name: 'Short Dow call',
    });
    expect(snapshot.holdings.find((h) => h.assetClass === 'Liabilities')?.weight).toBe('-0.5');
    expect(snapshot.coverage).toBe('99');
    expect(snapshot.provenance?.residualWeight).toBe('1');
    expect(gunzipSync(Buffer.from(snapshot.provenance!.rawSourceGzipBase64!, 'base64')).toString()).toBe(raw);
    expect(snapshot.provenance?.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    await expect(parseCompositionFile(input(nport(security(), 'S000029441'), 'sec-nport', 'DJIA'))).rejects.toThrow(
      'Wrong fund',
    );
    await expect(
      parseCompositionFile(input(nport(security(), 'S000075250', '2099-01-01'), 'sec-nport', 'DJIA')),
    ).rejects.toThrow('future');
  });
  it('quarantines duplicated and inconsistent SEC records and entity declarations', async () => {
    await expect(parseCompositionFile(input(nport(security() + security()), 'sec-nport', 'DJIA'))).rejects.toThrow(
      'Duplicate',
    );
    await expect(parseCompositionFile(input(nport(security('50', '600')), 'sec-nport', 'DJIA'))).rejects.toThrow(
      'reconcile',
    );
    await expect(
      parseCompositionFile(input('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]>' + nport(), 'sec-nport', 'DJIA')),
    ).rejects.toThrow('entity');
  });
  it('preserves iShares market weights separately from notional weights and missing source weights', async () => {
    const csv =
      'iShares Russell Mid-Cap Growth ETF\nFund Holdings as of,"Nov 19, 2026"\nTicker,Name,Type,Sector,Asset Class,Market Value,Notional Value,Quantity,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date,Market Weight,Notional Weight\nNET,CLOUDFLARE INC CLASS A,EQUITY,Information Technology,Equity,"1,000.00","1,000.00",10,100,United States,NYSE,USD,1,USD,-,3.20,3.19\nRTYZ6,RUSSELL FUTURE,INDEX,Cash and/or Derivatives,Futures,0,100,1,100,United States,CME,USD,1,USD,-,-,0.05';
    const snapshot = await parseCompositionFile(input(csv, 'ishares-csv', 'IWP'));
    expect(snapshot.asOf).toBe('2026-11-19');
    expect(snapshot.holdings[0]).toMatchObject({ weight: '3.2', notionalWeight: '3.19', country: 'United States' });
    expect(snapshot.holdings[1]).toMatchObject({
      weight: '0',
      notionalWeight: '0.05',
      weightReported: false,
      assetClass: 'Derivative',
    });
    expect(snapshot.coverage).toBe('3.2');
    await expect(parseCompositionFile(input('<html>Access denied</html>', 'ishares-csv', 'IWP'))).rejects.toThrow(
      'access/error',
    );
    await expect(
      parseCompositionFile(input(csv.replace('Russell Mid-Cap Growth', 'Core S&P 500'), 'ishares-csv', 'IWP')),
    ).rejects.toThrow('selected fund');
    await expect(parseCompositionFile(input(csv + '\n' + csv.split('\n')[3], 'ishares-csv', 'IWP'))).rejects.toThrow(
      'Duplicate',
    );
  });
  it('finds State Street metadata/headers and excludes workbook footnotes', async () => {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('holdings');
    sheet.addRows([
      ['Fund Name:', 'State Street SPDR Portfolio S&P 500 Growth ETF'],
      ['Ticker Symbol:', 'SPYG'],
      ['Holdings:', 'As of 19-Nov-2026'],
      [],
      ['Name', 'Ticker', 'Identifier', 'SEDOL', 'Weight', 'Sector', 'Shares Held', 'Local Currency'],
      ['MICROSOFT CORP', 'MSFT', '594918104', '2588173', 11.399178, '-', 100, 'USD'],
      [],
      ['Before investing read the prospectus.'],
    ]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const snapshot = await parseCompositionFile(input(bytes, 'ssga-xlsx', 'SPYG'));
    expect(snapshot.holdings).toHaveLength(1);
    expect(snapshot.holdings[0]).toMatchObject({ id: 'cusip:594918104', weight: '11.399178', assetClass: 'Equity' });
    expect(snapshot.provenance?.residualWeight).toBe('88.600822');
    sheet.getCell('B2').value = 'SPY';
    await expect(
      parseCompositionFile(input(Buffer.from(await book.xlsx.writeBuffer()), 'ssga-xlsx', 'SPYG')),
    ).rejects.toThrow('Wrong fund');
  });
  it('supports bounded single-filing ZIPs and rejects unsafe archive paths', async () => {
    const zip = new JSZip();
    zip.file('primary_doc.xml', nport());
    const snapshot = await parseCompositionFile(
      input(await zip.generateAsync({ type: 'nodebuffer' }), 'sec-nport', 'DJIA'),
    );
    expect(snapshot.provenance?.parsedRowCount).toBe(1);
    zip.file('other.xml', nport());
    await expect(
      parseCompositionFile(input(await zip.generateAsync({ type: 'nodebuffer' }), 'sec-nport', 'DJIA')),
    ).rejects.toThrow('individual fund');
  });
  it('uses same-filing gold, assets, liabilities and net assets; never invents cash or company exposure', async () => {
    const fact = (val: number) => ({
      units: { USD: [{ end: '2026-06-30', val, accn: '2026-filing', form: '10-Q', filed: '2026-08-04' }] },
    });
    const data = {
      cik: 1222333,
      entityName: 'SPDR GOLD TRUST',
      facts: {
        'us-gaap': {
          AssetsNet: fact(1000),
          Assets: fact(1005),
          Liabilities: fact(5),
          InvestmentOwnedAtFairValue: fact(1005),
        },
      },
    };
    const snapshot = await parseCompositionFile(input(JSON.stringify(data), 'sec-gold-facts', 'GLD'));
    expect(snapshot.coverage).toBe('100');
    expect(snapshot.holdings.map((h) => h.assetClass)).toEqual(['Commodity', 'Liabilities']);
    expect(snapshot.holdings.reduce((n, h) => n.plus(h.weight), new Big(0)).toString()).toBe('100');
    expect(snapshot.holdings[0]?.country).toContain('Not applicable');
    data.facts['us-gaap'].Liabilities.units.USD[0]!.accn = 'different-filing';
    await expect(parseCompositionFile(input(JSON.stringify(data), 'sec-gold-facts', 'GLD'))).rejects.toThrow(
      'same-filing',
    );
  });
});
