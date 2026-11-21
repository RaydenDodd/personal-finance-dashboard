import type { FundHoldingInput, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import Big from 'big.js';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { type CompositionAdapter, definitionFor } from './registry';

export const COMPOSITION_PARSER_VERSION = '1.0.0';
export const MAX_COMPOSITION_BYTES = 12 * 1024 * 1024;
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const clean = (v: unknown) => String(v ?? '').trim();
const present = (v: unknown) => !['', '-', '--', 'N/A', 'NA', 'N.A.', 'NOT AVAILABLE'].includes(clean(v).toUpperCase());
const optional = (v: unknown) => (present(v) ? clean(v) : undefined);
const array = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
export function compositionDecimal(v: unknown): string {
  const value = clean(v)
    .replace(/,/g, '')
    .replace(/%$/, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error(`Invalid source decimal: ${clean(v).slice(0, 30)}`);
  return new Big(value).toFixed();
}
export function compositionDate(v: unknown): string {
  const value = clean(v)
    .replace(/^.*?\bas\s+of\b[:\s]*/i, '')
    .replace(/^Fund Holdings (?:as of)?[,\s]*/i, '');
  let date: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date = value;
  else {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const match = value.match(
      /^(?:(\d{1,2})[- ]([A-Za-z]+)[-, ]+(\d{4})|([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/,
    );
    if (!match) throw new Error('A source report date is required; retrieval time cannot be used as the report date.');
    const year = match[3] ?? match[6] ?? match[9]!;
    const month =
      match[2] || match[4] ? months.indexOf((match[2] ?? match[4]!).slice(0, 3).toLowerCase()) + 1 : Number(match[7]);
    const day = Number(match[1] ?? match[5] ?? match[8]);
    date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('The source report date is invalid.');
  if (date > new Date().toISOString().slice(0, 10)) throw new Error('The source report date is in the future.');
  return date;
}
const identifier = (row: Partial<FundHoldingInput>, fallback: string) => {
  if (row.cusip && /^[A-Z0-9*@#]{9}$/.test(row.cusip)) return `cusip:${row.cusip}`;
  if (row.isin && /^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin)) return `isin:${row.isin}`;
  return fallback;
};
function assetClass(value: string, name = ''): string {
  // Explicit issuer / SEC categories take precedence over words in company names.
  if (/^(stocks?|equity|equities|common|preferred|E[CP])$/i.test(value)) return 'Equity';
  if (/^commodity$/i.test(value)) return 'Commodity';
  if (/option|future|swap|deriv|warrant/i.test(value)) return 'Derivative';
  if (
    /cash|money market|collateral|STIF|STIV/i.test(value) ||
    /\b(?:money market|cash collateral|USD cash|US dollar)\b/i.test(name)
  )
    return 'Cash / short-term investment';
  if (/gold|bullion/i.test(value) || /\b(?:physical gold|gold bullion)\b/i.test(name)) return 'Commodity';
  if (/repo|\bRA\b/i.test(value)) return 'Repurchase agreement';
  if (/equity|common|preferred|^E[CP]$/i.test(value)) return 'Equity';
  if (/bond|debt|treasur/i.test(value)) return 'Fixed income';
  return optional(value) ?? 'Unclassified asset';
}
type Parsed = {
  asOf: string;
  holdings: FundHoldingInput[];
  warnings: string[];
  reportedRows: number;
  taxonomy?: string;
  netAssets?: string;
  seriesId?: string;
  classId?: string;
  accession?: string;
};
function parseGoldFacts(raw: string, symbol: string): Parsed {
  const data = JSON.parse(raw);
  if (symbol !== 'GLD' || Number(data.cik) !== 1222333 || !/SPDR.*GOLD.*TRUST/i.test(data.entityName ?? ''))
    throw new Error('Wrong gold trust identity.');
  const facts = data.facts?.['us-gaap'];
  const today = new Date().toISOString().slice(0, 10);
  const reports = (facts?.AssetsNet?.units?.USD ?? [])
    .filter((r: any) => !r.start && r.end <= today && r.filed <= today && /^10-[QK](?:\/A)?$/.test(r.form))
    .sort((a: any, b: any) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const report = reports[0];
  if (!report) throw new Error('No dated gold-trust balance sheet was found.');
  const get = (key: string) => {
    const rows = (facts?.[key]?.units?.USD ?? []).filter(
      (r: any) => !r.start && r.end === report.end && r.accn === report.accn,
    );
    const values = [...new Set(rows.map((r: any) => compositionDecimal(r.val)))];
    if (values.length !== 1) throw new Error(`Missing or ambiguous same-filing gold balance-sheet fact: ${key}`);
    return new Big(values[0] as string);
  };
  const net = new Big(compositionDecimal(report.val));
  const gold = get('InvestmentOwnedAtFairValue'),
    assets = get('Assets'),
    liabilities = get('Liabilities');
  if (net.lte(0) || gold.lte(0) || gold.gt(assets) || !assets.minus(liabilities).eq(net))
    throw new Error('Gold trust balance sheet does not reconcile.');
  const holdings: FundHoldingInput[] = [
    {
      id: 'commodity:XAU',
      symbol: 'GOLD',
      name: 'Physical gold bullion',
      assetClass: 'Commodity',
      weight: gold.div(net).times(100).toFixed(),
      marketValue: gold.toFixed(),
      currencyCode: 'USD',
      sector: 'Not applicable (gold)',
      country: 'Not applicable (commodity)',
    },
  ];
  if (!assets.eq(gold))
    holdings.push({
      id: 'gld:other-assets',
      symbol: 'OTHER-ASSETS',
      name: 'Other reported assets; cash not separately identified',
      assetClass: 'Other reported assets',
      weight: assets.minus(gold).div(net).times(100).toFixed(),
      marketValue: assets.minus(gold).toFixed(),
    });
  if (!liabilities.eq(0))
    holdings.push({
      id: 'gld:liabilities',
      symbol: 'LIABILITIES',
      name: 'Reported trust liabilities',
      assetClass: 'Liabilities',
      weight: liabilities.neg().div(net).times(100).toFixed(),
      marketValue: liabilities.neg().toFixed(),
    });
  return {
    asOf: compositionDate(report.end),
    holdings,
    reportedRows: holdings.length,
    netAssets: net.toFixed(),
    accession: report.accn,
    warnings: [
      'Dated SEC trust balance sheet, not live bullion composition. Other assets are not assumed to be cash. Gold and trust liabilities are separate from company exposure.',
    ],
  };
}
type NportRow = Record<string, any>;
function parseNport(raw: string, symbol: string): Parsed {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('XML entity declarations are not accepted.');
  if (XMLValidator.validate(raw) !== true) throw new Error('Invalid or truncated SEC XML; import quarantined.');
  const root = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
  }).parse(raw).edgarSubmission;
  const f = root?.formData;
  const definition = definitionFor(symbol);
  if (!f?.genInfo || !definition?.seriesId || f.genInfo.seriesId !== definition.seriesId)
    throw new Error('Wrong fund: the SEC series does not match the selected fund.');
  const classes = array(root.headerData?.filerInfo?.seriesClassInfo?.classId).map(clean);
  if (definition.classId && !classes.includes(definition.classId))
    throw new Error('The filing does not include this share class.');
  if (Number(f.genInfo.regCik) !== definition.cik)
    throw new Error('The SEC registrant does not match the source registry.');
  const asOf = compositionDate(f.genInfo.repPdDate);
  const netAssets = compositionDecimal(f.fundInfo?.netAssets);
  if (new Big(netAssets).lte(0)) throw new Error('SEC fund net assets must be positive.');
  const rows: NportRow[] = array(f.invstOrSecs?.invstOrSec);
  if (!rows.length) throw new Error('The SEC filing has no investment records.');
  const seen = new Set<string>();
  const warnings: string[] = [];
  const holdings = rows.map((r, i): FundHoldingInput => {
    const signature = hash(JSON.stringify(r));
    if (seen.has(signature)) throw new Error('Duplicate SEC source record; import quarantined.');
    seen.add(signature);
    const cusip = optional(r.cusip)?.toUpperCase();
    const isin = optional(array<NportRow>(r.identifiers?.isin)[0]?.value)?.toUpperCase();
    const ticker = optional(array<NportRow>(r.identifiers?.ticker)[0]?.value);
    const category = clean(r.assetCat ?? r.assetConditional?.assetCat);
    const isDerivative = !!r.derivativeInfo || /^(DE|DIR|DCR|DFE|DCO|DOR)$/.test(category);
    const marketValue = compositionDecimal(r.valUSD);
    const weight = compositionDecimal(r.pctVal);
    const computed = new Big(marketValue).div(netAssets).times(100);
    if (computed.minus(weight).abs().gt('0.00001'))
      throw new Error('SEC percentage and USD valuation do not reconcile to reported net assets.');
    const name = optional(r.title) ?? optional(r.name) ?? `Reported derivative ${i + 1}`;
    const row: FundHoldingInput = {
      id: '',
      symbol: ticker ?? cusip ?? isin ?? `SEC-${i + 1}`,
      name,
      weight,
      rawWeight: clean(r.pctVal),
      weightReported: true,
      marketValue,
      assetClass: isDerivative ? 'Derivative' : assetClass(category, name),
      cusip: present(cusip) ? cusip : undefined,
      isin,
      issuerLei: optional(r.lei),
      currencyCode: optional(r.curCd ?? r.currencyConditional?.curCd),
      country: optional(r.invCountry),
      countryBasis: 'SEC investment country',
    };
    // A contract is an instrument of its own, never the issuer/underlying stock.
    row.id = isDerivative
      ? `sec-contract:${definition.seriesId}:${i + 1}`
      : identifier(row, `sec:${definition.seriesId}:${i + 1}`);
    if (isDerivative) {
      row.cusip = undefined;
      row.isin = undefined;
      const derivative = r.derivativeInfo;
      const detail = derivative?.optionSwaptionWarrantDeriv ?? derivative?.futrDeriv ?? derivative?.othDeriv;
      row.name = optional(detail?.desc) ?? optional(r.title) ?? `Derivative contract ${i + 1}`;
      row.symbol = ticker ?? `DERIVATIVE-${i + 1}`;
    }
    return row;
  });
  const cash = optional(f.fundInfo?.cshNotRptdInCorD);
  if (cash && !new Big(cash).eq(0))
    holdings.push({
      id: `sec-cash:${definition.seriesId}`,
      symbol: 'CASH',
      name: 'Cash not included in SEC investment rows',
      weight: new Big(cash).div(netAssets).times(100).toFixed(),
      marketValue: compositionDecimal(cash),
      assetClass: 'Cash / short-term investment',
      currencyCode: 'USD',
      weightReported: true,
    });
  const totalAssets = new Big(compositionDecimal(f.fundInfo.totAssets));
  const totalLiabilities = new Big(compositionDecimal(f.fundInfo.totLiabs));
  if (totalAssets.minus(totalLiabilities).minus(netAssets).abs().gt('0.02'))
    throw new Error('SEC total assets, liabilities and net assets do not reconcile.');
  const embeddedLiabilities = holdings.reduce(
    (n, h) => (h.marketValue && new Big(h.marketValue).lt(0) ? n.minus(h.marketValue) : n),
    new Big(0),
  );
  const remainingLiabilities = totalLiabilities.minus(embeddedLiabilities);
  if (remainingLiabilities.gt(0))
    holdings.push({
      id: `sec-liabilities:${definition.seriesId}`,
      symbol: 'LIABILITIES',
      name: 'Other reported liabilities (excluding signed investment liabilities)',
      weight: remainingLiabilities.neg().div(netAssets).times(100).toFixed(),
      marketValue: remainingLiabilities.neg().toFixed(),
      assetClass: 'Liabilities',
      currencyCode: 'USD',
      weightReported: true,
    });
  if (remainingLiabilities.lt(0))
    warnings.push(
      'Signed investment liabilities exceed the separately reported liability total; no offsetting liability was invented.',
    );
  warnings.push(
    'SEC report dates are delayed disclosures, not live fund composition. Unallocated assets or liabilities remain a separate residual.',
  );
  return {
    asOf,
    holdings,
    warnings,
    reportedRows: rows.length,
    netAssets,
    seriesId: definition.seriesId,
    classId: definition.classId,
  };
}
async function workbookRows(bytes: Buffer): Promise<string[][][]> {
  // Inspect the ZIP directory before ExcelJS expands it. No files are extracted.
  await boundedZip(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  return book.worksheets.map((sheet) => {
    if (sheet.rowCount > 15000 || sheet.columnCount > 200) throw new Error('Workbook exceeds composition limits.');
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) =>
      rows.push(
        Array.from({ length: Math.min(sheet.columnCount, 200) }, (_, n) => {
          const value = row.getCell(n + 1).value;
          if (value && typeof value === 'object' && 'richText' in value)
            return value.richText.map((part) => part.text).join('');
          if (value && typeof value === 'object' && 'result' in value) return clean(value.result);
          return clean(row.getCell(n + 1).text);
        }),
      ),
    );
    return rows;
  });
}
async function boundedZip(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > 300) throw new Error('ZIP contains too many entries.');
  let expanded = 0;
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    expanded += size;
    if (size > 40 * 1024 * 1024 || expanded > 60 * 1024 * 1024)
      throw new Error('ZIP expansion exceeds composition limits.');
    if (entry.name.split(/[\\/]/).includes('..')) throw new Error('Unsafe ZIP path.');
  }
  return zip;
}
function csvRows(raw: string): string[][] {
  if (
    /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(raw) ||
    /access denied|captcha|request (?:blocked|rate)/i.test(raw.slice(0, 1000))
  )
    throw new Error('The download is an access/error page, not a composition file.');
  return parse(raw, { bom: true, relax_column_count: true, skip_empty_lines: true, max_record_size: 2 * 1024 * 1024 });
}
const normalizedHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const column = (header: string[], names: string[]) => header.findIndex((h) => names.includes(normalizedHeader(h)));
function parseIssuerRows(rows: string[][], symbol: string, adapter: CompositionAdapter, manualDate?: string): Parsed {
  const definition = definitionFor(symbol);
  const headerAt = rows.findIndex(
    (r) =>
      column(r, ['name', 'holdingname', 'securityname', 'description', 'companyname']) >= 0 &&
      column(r, [
        'weight',
        'weighting',
        'weightpercent',
        'weightpercentage',
        'weightofnetassets',
        'marketweight',
        'weightfund',
        'ofnetassets',
        'percentofnetassets',
        'portfolioholdingweight',
      ]) >= 0,
  );
  if (headerAt < 0)
    throw new Error('Expected issuer holdings columns are missing. Import quarantined for schema review.');
  const metadata = rows.slice(0, headerAt).flat().join(' ');
  if (adapter !== 'canonical-csv' && (!definition || !definition.namePattern.test(metadata)))
    throw new Error('The file does not identify the selected fund. Include the original issuer metadata.');
  const explicitTicker = rows
    .slice(0, headerAt)
    .find((r) => /^ticker(?: symbol)?:?$/i.test(r[0]?.trim() ?? ''))?.[1]
    ?.trim();
  if (explicitTicker && explicitTicker !== symbol && !definition?.aliases?.includes(explicitTicker))
    throw new Error('Wrong fund ticker in the source file.');
  const dateRow = rows
    .slice(0, headerAt)
    .find((r) => /as of|fund holdings|holdings date|effective date/i.test(r.join(' ')) && /\d{4}/.test(r.join(' ')));
  const sourceDate =
    dateRow?.find((v, i) => i > 0 && /\d{4}/.test(v)) ??
    dateRow?.join(' ').match(/(?:as of|effective date|holdings date)[:\s]*(.+)$/i)?.[1];
  const asOf = compositionDate(sourceDate ?? manualDate);
  if (sourceDate && manualDate && asOf !== compositionDate(manualDate))
    throw new Error('The supplied date conflicts with the source report date.');
  const header = rows[headerAt]!;
  const pick = (r: string[], keys: string[]) => r[column(header, keys)] ?? '';
  const nameKeys = ['name', 'holdingname', 'securityname', 'description', 'companyname'];
  const weightKeys = [
    'marketweight',
    'weight',
    'weighting',
    'weightpercent',
    'weightpercentage',
    'weightofnetassets',
    'weightfund',
    'ofnetassets',
    'percentofnetassets',
    'portfolioholdingweight',
  ];
  const holdings: FundHoldingInput[] = [];
  const warnings: string[] = [];
  let unweighted = 0;
  const sourceRows = new Set<string>();
  for (const [i, r] of rows.slice(headerAt + 1).entries()) {
    if (adapter === 'ssga-xlsx' && holdings.length && r.every((v) => !present(v))) break;
    if (r.length !== header.length) {
      if (r.length <= 2 || r.filter(present).length <= 1) continue; // preserved source footnotes
      throw new Error(`Malformed holdings row ${i + headerAt + 2}; no rows were imported.`);
    }
    const name = pick(r, nameKeys);
    if (name.length > 100 && r.filter(present).every((v) => v === name)) break; // merged issuer legal footnote
    const weightRaw = pick(r, weightKeys);
    const ticker = optional(pick(r, ['ticker', 'symbol', 'holdingsticker', 'securityticker']));
    const cusip = optional(pick(r, ['cusip', 'identifier', 'securityidentifier']))?.toUpperCase();
    const isin = optional(pick(r, ['isin']))?.toUpperCase();
    const marketValue = optional(pick(r, ['marketvalue', 'marketvaluebase', 'value']));
    if (!present(name) || (!present(weightRaw) && !marketValue)) continue;
    const sourceRowKey = JSON.stringify(r);
    if (sourceRows.has(sourceRowKey)) throw new Error('Duplicate issuer source record; import quarantined.');
    sourceRows.add(sourceRowKey);
    const reported = present(weightRaw);
    if (!reported) unweighted++;
    const currencyCode = optional(pick(r, ['marketcurrency', 'localcurrency', 'currencycode', 'currency']));
    const exchange = optional(pick(r, ['exchange', 'exchangename']));
    const row: FundHoldingInput = {
      id: '',
      symbol: ticker ?? cusip ?? isin ?? 'CASH',
      name,
      weight: reported ? compositionDecimal(weightRaw) : '0',
      rawWeight: weightRaw,
      weightReported: reported,
      cusip,
      isin,
      currencyCode,
      exchange,
      sector: optional(pick(r, ['sector', 'gicssector', 'sectorclassification'])),
      industry: optional(pick(r, ['industry'])),
      region: optional(pick(r, ['region'])),
      market: optional(pick(r, ['market'])),
      marketCap: optional(pick(r, ['marketcap'])),
      style: optional(pick(r, ['style'])),
      isFund: pick(r, ['isfund']).toLowerCase() === 'true',
      country: optional(pick(r, ['location', 'country', 'countryofrisk', 'countryofincorporation'])),
      countryBasis: adapter === 'ishares-csv' ? 'iShares location' : 'Issuer-reported country',
      assetClass: assetClass(pick(r, ['assetclass', 'assettype', 'securitytype', 'type']), name),
      marketValue: marketValue ? compositionDecimal(marketValue) : undefined,
      notionalWeight: optional(pick(r, ['notionalweight']))
        ? compositionDecimal(pick(r, ['notionalweight']))
        : undefined,
    };
    // State Street's USD identifier is cash, not a CUSIP/company.
    if (/^US DOLLAR$/i.test(name)) {
      row.assetClass = 'Cash / short-term investment';
      row.symbol = 'CASH';
    }
    if (row.assetClass === 'Unclassified asset' && ticker && ['ssga-xlsx', 'canonical-csv'].includes(adapter))
      row.assetClass = 'Equity';
    const manualId = optional(pick(r, ['id']));
    if (adapter === 'canonical-csv' && !manualId && !cusip && !isin)
      throw new Error('Canonical CSV rows require an explicit stable id, ISIN or CUSIP.');
    row.id =
      manualId ??
      identifier(
        row,
        exchange && currencyCode && ticker
          ? `listing:${exchange.toUpperCase()}:${currencyCode}:${ticker}`
          : `issuer:${adapter}:${symbol}:${hash([ticker, name, currencyCode].join('|')).slice(0, 24)}`,
      );
    holdings.push(row);
  }
  if (unweighted)
    warnings.push(
      `${unweighted} source rows have no reported market weight. Their values and raw cells are retained; they have not been normalized or assigned invented weights.`,
    );
  if (adapter === 'ishares-csv')
    warnings.push(
      'iShares market weights are rounded source percentages. Reported coverage is their sum; unreported small positions and rounding remain unresolved. Notional weights are separate.',
    );
  return {
    asOf,
    holdings,
    warnings,
    reportedRows: holdings.length,
    taxonomy:
      adapter === 'ishares-csv'
        ? 'iShares sector'
        : adapter === 'ssga-xlsx'
          ? 'GICS'
          : adapter === 'invesco-csv'
            ? 'ICB'
            : 'Issuer sector',
  };
}
export interface CompositionFileInput {
  fundId: string;
  symbol: string;
  adapter: CompositionAdapter;
  fileName: string;
  base64: string;
  sourceUrl?: string;
  asOf?: string;
  refreshRunAt?: string;
}
export async function parseCompositionFile(input: CompositionFileInput): Promise<InvestmentFundSnapshot> {
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_COMPOSITION_BYTES)
    throw new Error('Use a nonempty composition file smaller than 12 MB.');
  const definition = definitionFor(input.symbol);
  if (
    input.adapter === 'sec-nport' &&
    (!input.sourceUrl || !input.sourceUrl.startsWith('https://www.sec.gov/Archives/edgar/data/'))
  )
    throw new Error('Supply the original SEC filing document URL for this XML.');
  if (
    input.adapter === 'sec-gold-facts' &&
    input.sourceUrl !== 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001222333.json'
  )
    throw new Error('Supply the official GLD SEC company-facts URL.');
  if (!definition && input.adapter !== 'canonical-csv')
    throw new Error('An unregistered fund needs a canonical manual import with stable constituent identifiers.');
  let parsed: Parsed;
  let actualBytes: Buffer = bytes;
  if (input.adapter === 'sec-nport' && bytes.subarray(0, 2).toString() === 'PK') {
    const zip = await boundedZip(bytes);
    const xml = Object.values(zip.files).filter((e) => !e.dir && /\.xml$/i.test(e.name) && !/xsd|schema/i.test(e.name));
    if (xml.length !== 1)
      throw new Error(
        'Upload the individual fund N-PORT XML, or a ZIP containing that one XML. Bulk data archives require a series-filtered export.',
      );
    actualBytes = await xml[0]!.async('nodebuffer');
  }
  if (input.adapter === 'sec-nport') parsed = parseNport(actualBytes.toString('utf8'), input.symbol);
  else if (input.adapter === 'sec-gold-facts') parsed = parseGoldFacts(actualBytes.toString('utf8'), input.symbol);
  else if (input.adapter === 'gld-xlsx')
    throw new Error(
      'The GLD historical archive reports ounces and NAV, but does not establish bullion/cash weights. Import the dated trust balance sheet using the gold-balance-sheet adapter.',
    );
  else {
    const sheets =
      bytes.subarray(0, 2).toString() === 'PK' ? await workbookRows(bytes) : [csvRows(bytes.toString('utf8'))];
    const sheet = sheets.find((rows) =>
      rows.some((r) => column(r, ['name', 'holdingname', 'securityname', 'description', 'companyname']) >= 0),
    );
    if (!sheet) throw new Error('No holdings worksheet was found.');
    parsed = parseIssuerRows(sheet, input.symbol, input.adapter, input.asOf);
  }
  if (!parsed.holdings.length || parsed.holdings.length > 10000)
    throw new Error('Unexpected source constituent count.');
  const aggregated = new Map<string, FundHoldingInput>();
  for (const h of parsed.holdings) {
    if (new Big(h.weight).abs().gt(1000))
      throw new Error('Source holding weight exceeds the supported 1000% gross exposure limit.');
    if (
      new Big(h.weight).lt(0) &&
      !input.adapter.startsWith('sec-') &&
      !/derivative|cash|repo|liabil/i.test(h.assetClass ?? '')
    )
      throw new Error('Unexpected negative equity weight.');
    const previous = aggregated.get(h.id);
    if (previous) {
      if (previous.assetClass !== h.assetClass) throw new Error('One source identity has conflicting asset types.');
      previous.weight = new Big(previous.weight).plus(h.weight).toFixed();
      if (previous.marketValue && h.marketValue)
        previous.marketValue = new Big(previous.marketValue).plus(h.marketValue).toString();
      parsed.warnings.push(
        `Multiple reported positions in ${h.id} were aggregated; original records are retained in the source file.`,
      );
    } else aggregated.set(h.id, { ...h });
  }
  const holdings = [...aggregated.values()];
  const net = holdings.reduce((n, h) => n.plus(h.weight), new Big(0));
  const gross = holdings.reduce((n, h) => n.plus(new Big(h.weight).abs()), new Big(0));
  if (net.lt(0) || net.gt(125) || gross.gt(300))
    throw new Error('The source weights fail fund reconciliation limits; import quarantined.');
  if (!input.adapter.startsWith('sec-') && net.gt('100.1'))
    throw new Error('Issuer weights exceed 100% beyond supported source rounding.');
  const residual = new Big(100).minus(net);
  if (!residual.eq(0))
    parsed.warnings.push(
      `${residual.toString()}% remains unallocated net assets / liabilities or source rounding; it is not assigned to a company.`,
    );
  const available = new Big(100).minus(residual.abs());
  const sourceUrl = input.sourceUrl ?? definition?.issuerUrl ?? 'urn:moneymatter:manual-composition';
  return {
    fundId: input.fundId,
    symbol: input.symbol,
    asOf: parsed.asOf,
    provider: `${input.adapter} · ${hash(bytes).slice(0, 12)}`,
    retrievedAt: new Date().toISOString(),
    holdings,
    coverage: (available.lt(0) ? new Big(0) : available).toString(),
    classificationStandard: parsed.taxonomy,
    provenance: {
      sourceId: input.adapter,
      sourceUrl,
      fileName: input.fileName,
      sha256: hash(bytes),
      parserVersion: COMPOSITION_PARSER_VERSION,
      method:
        input.adapter === 'sec-nport'
          ? 'sec-nport'
          : input.adapter === 'sec-gold-facts'
            ? 'sec-xbrl'
            : input.adapter === 'canonical-csv'
              ? 'manual'
              : 'issuer-file',
      rawSourceGzipBase64: gzipSync(bytes).toString('base64'),
      reportedRowCount: parsed.reportedRows,
      parsedRowCount: parsed.reportedRows,
      unweightedRowCount: parsed.holdings.filter((h) => h.weightReported === false).length,
      completeness: input.adapter.startsWith('sec-') ? 'full-file' : 'partial',
      warnings: [...new Set(parsed.warnings)],
      netWeight: net.toFixed(),
      grossWeight: gross.toFixed(),
      residualWeight: residual.toFixed(),
      seriesId: parsed.seriesId,
      classId: parsed.classId,
      fundNetAssets: parsed.netAssets,
      accession: parsed.accession ?? sourceUrl.match(/\/([0-9]{18})\//)?.[1],
      autoRefreshPermitted: input.adapter.startsWith('sec-'),
      refreshRunAt: input.refreshRunAt,
    },
  };
}
