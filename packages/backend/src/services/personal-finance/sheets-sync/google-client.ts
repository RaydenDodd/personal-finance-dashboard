import { createPrivateKey, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { type SheetGrid, type SheetSyncConfig, readGrid } from './layout';

export type SheetsCredentials =
  | { kind: 'service-account'; clientEmail: string; privateKey: string }
  | { kind: 'oauth-refresh'; refreshToken: string };
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const requestTimeout = 15000;
const tokenCache = new Map<string, { token: string; until: number }>();
export function oauthSettings() {
  const clientId = process.env.GOOGLE_SHEETS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri =
    process.env.GOOGLE_SHEETS_REDIRECT_URI ||
    'http://localhost:8095/api/v1/personal-finance/sheets-sync/oauth/callback';
  let validRedirect = false;
  try {
    const url = new URL(redirectUri);
    validRedirect =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    /* configuration is not ready */
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: clientId.endsWith('.apps.googleusercontent.com') && Boolean(clientSecret) && validRedirect,
  };
}
export async function environmentCredentials(): Promise<SheetsCredentials | null> {
  const file = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE;
  if (file) {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return validateCredentials({
      kind: 'service-account',
      clientEmail: data.client_email,
      privateKey: data.private_key,
    });
  }
  if (process.env.GOOGLE_SHEETS_REFRESH_TOKEN && oauthSettings().configured)
    return { kind: 'oauth-refresh', refreshToken: process.env.GOOGLE_SHEETS_REFRESH_TOKEN };
  return null;
}
export function validateCredentials(credentials: SheetsCredentials): SheetsCredentials {
  if (credentials.kind === 'service-account') {
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(credentials.clientEmail))
      throw Error('invalid_service_account');
    const key = createPrivateKey(credentials.privateKey);
    if (key.asymmetricKeyType !== 'rsa') throw Error('invalid_service_account_key');
  } else if (!credentials.refreshToken || credentials.refreshToken.length > 10000) throw Error('invalid_refresh_token');
  return credentials;
}
async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(requestTimeout),
  });
  if (!response.ok) throw Error('google_authorization_failed');
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (typeof data.access_token !== 'string' || !data.access_token) throw Error('google_authorization_failed');
  return data;
}
export async function exchangeAuthorizationCode(code: string, verifier: string) {
  const settings = oauthSettings();
  if (!settings.configured) throw Error('oauth_client_missing');
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: settings.redirectUri,
      grant_type: 'authorization_code',
    }),
  );
  if (!data.refresh_token || !(data.scope ?? '').split(' ').includes(SCOPE))
    throw Error('google_offline_access_missing');
  return { kind: 'oauth-refresh' as const, refreshToken: String(data.refresh_token) };
}
export async function accessToken(credentials: SheetsCredentials) {
  const key = credentials.kind === 'service-account' ? credentials.clientEmail : credentials.refreshToken;
  const cached = tokenCache.get(key);
  if (cached && cached.until > Date.now()) return cached.token;
  let body: URLSearchParams;
  if (credentials.kind === 'service-account') {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload =
      encode({ alg: 'RS256', typ: 'JWT' }) +
      '.' +
      encode({ iss: credentials.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
    const signature = createSign('RSA-SHA256').update(payload).sign(credentials.privateKey, 'base64url');
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: payload + '.' + signature,
    });
  } else {
    const settings = oauthSettings();
    if (!settings.configured) throw Error('oauth_client_missing');
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    });
  }
  const data = await tokenRequest(body);
  tokenCache.set(key, {
    token: String(data.access_token),
    until: Date.now() + (Math.max(60, Number(data.expires_in) || 3600) - 60) * 1000,
  });
  return String(data.access_token);
}
export interface SheetsTransport {
  read(config: SheetSyncConfig): Promise<SheetGrid>;
  write(config: SheetSyncConfig, requests: unknown[]): Promise<void>;
}
export function googleSheetsTransport(credentials: SheetsCredentials): SheetsTransport {
  const request = async (config: SheetSyncConfig, suffix: string, body?: unknown) => {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}${suffix}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${await accessToken(credentials)}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(requestTimeout),
      },
    );
    if (!response.ok)
      throw Error(
        response.status === 403
          ? 'sheet_permission_denied'
          : response.status === 404
            ? 'sheet_not_found'
            : response.status === 429
              ? 'google_rate_limited'
              : 'google_request_failed',
      );
    return response.json();
  };
  return {
    async read(config) {
      const metadata = (await request(config, '?fields=sheets(properties(sheetId,title,gridProperties))')) as {
        sheets?: Array<{ properties: { sheetId: number; gridProperties: { columnCount: number } } }>;
      };
      const properties = metadata.sheets?.find((sheet) => sheet.properties.sheetId === config.sheetId)?.properties;
      if (!properties) throw Error('sheet_not_found');
      const count = Math.min(properties.gridProperties.columnCount, 702);
      let column = '';
      for (let value = count; value > 0; value = Math.floor((value - 1) / 26))
        column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
      const range = `'${config.sheetName.replaceAll("'", "''")}'!A1:${column}70`;
      const query = new URLSearchParams({
        ranges: range,
        fields:
          'sheets(properties(sheetId,title,gridProperties),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,note))))',
      });
      return readGrid(await request(config, '?' + query.toString()), config.sheetId);
    },
    async write(config, requests) {
      if (requests.length) await request(config, ':batchUpdate', { requests, includeSpreadsheetInResponse: false });
    },
  };
}
