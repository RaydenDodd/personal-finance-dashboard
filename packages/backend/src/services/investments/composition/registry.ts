/** Source access policy and SEC identities, separate from native position/security records. */
export type CompositionAdapter =
  | 'sec-nport'
  | 'sec-gold-facts'
  | 'ishares-csv'
  | 'ssga-xlsx'
  | 'vanguard-file'
  | 'invesco-csv'
  | 'schwab-csv'
  | 'amplify-csv'
  | 'globalx-csv'
  | 'gld-xlsx'
  | 'spck-csv'
  | 'canonical-csv';
export interface CompositionDefinition {
  symbol: string;
  name: string;
  issuerUrl: string;
  adapter: CompositionAdapter;
  namePattern: RegExp;
  cik?: number;
  seriesId?: string;
  classId?: string;
  family?: string;
  cusip?: string;
  aliases?: string[];
  manualOnly?: boolean;
}
const vanguard = 'https://advisors.vanguard.com/investments/products/';
export const COMPOSITION_REGISTRY: CompositionDefinition[] = [
  {
    symbol: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    issuerUrl: `${vanguard}voo/vanguard-sp-500-etf`,
    adapter: 'vanguard-file',
    namePattern: /(?:S&P|S AND P|500)\s*(?:500|INDEX)?/i,
    cik: 36405,
    seriesId: 'S000002839',
    classId: 'C000092055',
    manualOnly: true,
  },
  {
    symbol: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    issuerUrl: `${vanguard}vti/vanguard-total-stock-market-etf`,
    adapter: 'vanguard-file',
    namePattern: /total\s+stock\s+market/i,
    cik: 36405,
    seriesId: 'S000002848',
    classId: 'C000007808',
    manualOnly: true,
  },
  {
    symbol: 'VO',
    name: 'Vanguard Mid-Cap ETF',
    issuerUrl: `${vanguard}vo/vanguard-mid-cap-etf`,
    adapter: 'vanguard-file',
    namePattern: /mid.?cap/i,
    cik: 36405,
    seriesId: 'S000002844',
    classId: 'C000007794',
    manualOnly: true,
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust Series 1',
    issuerUrl: 'https://www.invesco.com/qqq-etf/en/about.html',
    adapter: 'invesco-csv',
    namePattern: /invesco\s+qqq/i,
    cik: 1067839,
    seriesId: 'S000101292',
    classId: 'C000271435',
    manualOnly: true,
  },
  {
    symbol: 'SPYG',
    name: 'State Street SPDR Portfolio S&P 500 Growth ETF',
    issuerUrl: 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spyg.xlsx',
    adapter: 'ssga-xlsx',
    namePattern: /500.*growth/i,
    cik: 1064642,
    seriesId: 'S000006984',
    classId: 'C000019037',
  },
  {
    symbol: 'SCHD',
    name: 'Schwab US Dividend Equity ETF',
    issuerUrl: 'https://www.schwabassetmanagement.com/products/schd',
    adapter: 'schwab-csv',
    namePattern: /dividend\s+equity/i,
    cik: 1454889,
    seriesId: 'S000034163',
    classId: 'C000105320',
  },
  {
    symbol: 'IWP',
    name: 'iShares Russell Mid-Cap Growth ETF',
    issuerUrl: 'https://www.ishares.com/us/products/239717/ishares-russell-mid-cap-growth-etf/latest-holdings.csv',
    adapter: 'ishares-csv',
    namePattern: /russell\s+mid.?cap\s+growth/i,
    cik: 1100663,
    seriesId: 'S000004336',
    classId: 'C000012066',
  },
  {
    symbol: 'IBUY',
    name: 'Amplify Online Retail ETF',
    issuerUrl: 'https://amplifyetfs.com/IBUY-holdings/',
    adapter: 'amplify-csv',
    namePattern: /online\s+retail|IBUY/i,
    cik: 1633061,
    seriesId: 'S000052601',
    classId: 'C000165126',
  },
  {
    symbol: 'DJIA',
    name: 'Global X Dow 30 Covered Call ETF',
    issuerUrl: 'https://www.globalxetfs.com/funds/djia',
    adapter: 'globalx-csv',
    namePattern: /dow\s+30\s+covered\s+call/i,
    cik: 1432353,
    seriesId: 'S000075250',
    classId: 'C000234113',
  },
  {
    symbol: 'FSKAX',
    name: 'Fidelity Total Market Index Fund',
    issuerUrl: 'https://fundresearch.fidelity.com/mutual-funds/view-all/315911693',
    adapter: 'canonical-csv',
    namePattern: /fidelity\s+total\s+market/i,
    cik: 819118,
    seriesId: 'S000006026',
    classId: 'C000103359',
  },
  {
    symbol: 'VWNFX',
    name: 'Vanguard Windsor II Investor Shares',
    issuerUrl: `${vanguard}vwnfx/vanguard-windsor-ii-fund-investor-shares`,
    adapter: 'vanguard-file',
    namePattern: /windsor\s+ii/i,
    cik: 107606,
    seriesId: 'S000004418',
    classId: 'C000012180',
    family: 'S000004418',
    manualOnly: true,
  },
  {
    symbol: 'VWNAX',
    name: 'Vanguard Windsor II Admiral Shares',
    issuerUrl: `${vanguard}vwnax/vanguard-windsor-ii-fund-admiral-shares`,
    adapter: 'vanguard-file',
    namePattern: /windsor\s+ii/i,
    cik: 107606,
    seriesId: 'S000004418',
    classId: 'C000012181',
    family: 'S000004418',
    manualOnly: true,
  },
  {
    symbol: 'LIT',
    name: 'Global X Lithium & Battery Tech ETF',
    issuerUrl: 'https://www.globalxetfs.com/funds/lit',
    adapter: 'globalx-csv',
    namePattern: /lithium.*battery/i,
    cik: 1432353,
    seriesId: 'S000029441',
    classId: 'C000090392',
  },
  {
    symbol: 'GLD',
    name: 'SPDR Gold Shares',
    issuerUrl: 'https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en',
    adapter: 'gld-xlsx',
    namePattern: /SPDR.*GOLD/i,
    cusip: '78463V107',
    cik: 1222333,
  },
  {
    symbol: 'SPCK',
    aliases: ['SPCX'],
    name: 'SPAC and New Issue ETF',
    issuerUrl: 'https://spcketf.com/',
    adapter: 'spck-csv',
    namePattern: /SPAC|SPCK|SPCX/i,
    cik: 1719812,
    seriesId: 'S000070261',
    classId: 'C000223446',
    cusip: '19423L672',
  },
];
export const definitionFor = (symbol: string) =>
  COMPOSITION_REGISTRY.find((d) => d.symbol === symbol.toUpperCase() || d.aliases?.includes(symbol.toUpperCase()));
export const isCompositionIdentityConflict = (security: {
  symbol: string | null;
  name: string | null;
  cusip?: string | null;
  isin?: string | null;
}) =>
  security.symbol === 'SPCX' &&
  /space\s+exploration|spacex/i.test(security.name ?? '') &&
  security.cusip !== '19423L672' &&
  security.isin !== 'US19423L6728';
export const isFundSecurity = (s: { symbol: string | null; name: string | null }) =>
  !!definitionFor(s.symbol ?? '') ||
  /\b(etf|mutual fund|index fund|total market index|stock market index|ishares|vanguard|invesco|spdr)\b/i.test(
    s.name ?? '',
  );
export const secFeedUrl = (seriesId: string) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${seriesId}&type=NPORT-P&count=10&output=atom`;
