/**
 * Real OAuth/PKCE and Streamable HTTP connectivity check against a private
 * deployment. No tokens are inserted into the database. Output contains only
 * statuses and tool counts; account records stay in memory.
 *
 * Requires Node 22+ and ignored private/owner-credentials.json with email/password.
 * MCP_HTTP_BASE_URL is the reachable address; MCP_ORIGIN is the configured origin.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const base = (process.env.MCP_HTTP_BASE_URL || 'http://localhost:8095').replace(/\/$/, '');
const origin = (process.env.MCP_ORIGIN || 'http://192.168.0.32:8095').replace(/\/$/, '');
const resource = `${origin}/mcp`;
const scopes = ['finance:read', 'profile:read'];
const sessionPath = resolve(process.env.MCP_SESSION_FILE || 'private/mcp-session.json');
const privateDirectory = resolve('private');
const cookieJar = new Map();

class VerificationError extends Error {}

function requireCondition({ condition, message }) {
  if (!condition) throw new VerificationError(message);
}

async function request({ path, method = 'GET', body, authenticated = false, headers = {} }) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      Origin: origin,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated && cookieJar.size ? { Cookie: [...cookieJar.values()].join('; ') } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    cookieJar.set(pair.split('=', 1)[0], pair);
  }
  return response;
}

async function expectJson({ response, stage, status = 200 }) {
  requireCondition({ condition: response.status === status, message: `${stage}: unexpected HTTP ${response.status}` });
  return response.json();
}

async function getRedirect({ response, stage }) {
  if (response.headers.has('location')) return response.headers.get('location');
  requireCondition({ condition: response.ok, message: `${stage}: unexpected HTTP ${response.status}` });
  const data = await response.json();
  const target = data.url || data.redirectTo;
  requireCondition({ condition: typeof target === 'string', message: `${stage}: redirect was not returned` });
  return target;
}

async function authorizeOwner() {
  const credentials = JSON.parse(await readFile('private/owner-credentials.json', 'utf8'));
  requireCondition({
    condition: typeof credentials.email === 'string' && typeof credentials.password === 'string',
    message: 'Owner credential file must contain email and password',
  });
  await expectJson({
    response: await request({
      path: '/api/v1/auth/sign-in/email',
      method: 'POST',
      body: { email: credentials.email, password: credentials.password },
    }),
    stage: 'Owner sign-in',
  });

  const callback = 'http://127.0.0.1:47682/callback';
  const client = await expectJson({
    response: await request({
      path: '/api/v1/auth/oauth2/register',
      method: 'POST',
      body: {
        client_name: 'Personal Finance verification',
        application_type: 'native',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: scopes.join(' '),
      },
    }),
    stage: 'OAuth client registration',
    status: 201,
  });
  requireCondition({ condition: typeof client.client_id === 'string', message: 'OAuth client ID missing' });
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const parameters = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource,
  });
  const authorizationTarget = new URL(await getRedirect({
    response: await request({ path: `/api/v1/auth/oauth2/authorize?${parameters}`, authenticated: true }),
    stage: 'OAuth authorization',
  }), origin);
  requireCondition({
    condition: authorizationTarget.origin === origin && authorizationTarget.pathname === '/oauth/authorize',
    message: 'OAuth authorization did not reach the configured consent page',
  });
  const consentTarget = new URL(await getRedirect({
    response: await request({
      path: '/api/v1/auth/oauth2/consent',
      method: 'POST',
      authenticated: true,
      body: { accept: true, oauth_query: authorizationTarget.search.slice(1), scope: scopes.join(' ') },
    }),
    stage: 'OAuth read-only consent',
  }), callback);
  requireCondition({
    condition: consentTarget.origin === new URL(callback).origin && consentTarget.pathname === '/callback' &&
      consentTarget.searchParams.get('state') === state && Boolean(consentTarget.searchParams.get('code')),
    message: 'OAuth callback or state did not match',
  });
  const token = await expectJson({
    response: await request({
      path: '/api/v1/auth/oauth2/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: consentTarget.searchParams.get('code'),
        redirect_uri: callback,
        client_id: client.client_id,
        code_verifier: verifier,
        resource,
      }).toString(),
    }),
    stage: 'OAuth PKCE token exchange',
  });
  requireCondition({ condition: typeof token.access_token === 'string', message: 'OAuth access token missing' });
  requireCondition({
    condition: !String(token.scope).includes('finance:write') && !String(token.scope).includes('finance:delete'),
    message: 'OAuth token unexpectedly includes write permissions',
  });
  const session = {
    serverUrl: `${base}/mcp`,
    resource,
    clientId: client.client_id,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope,
    expiresAt: Date.now() + Number(token.expires_in) * 1000,
  };
  requireCondition({
    condition: sessionPath.startsWith(`${privateDirectory}${sep}`),
    message: 'MCP session files must stay inside ignored private/',
  });
  await mkdir(dirname(sessionPath), { recursive: true, mode: 0o700 });
  await writeFile(sessionPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

async function parseRpc({ response, stage }) {
  requireCondition({ condition: response.ok, message: `${stage}: unexpected HTTP ${response.status}` });
  const raw = await response.text();
  let result;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith('data:'));
    requireCondition({ condition: Boolean(line), message: `${stage}: MCP SSE response had no data` });
    result = JSON.parse(line.slice(5).trim());
  } else {
    result = JSON.parse(raw);
  }
  requireCondition({ condition: !result.error && !result.result?.isError, message: `${stage}: MCP returned an error` });
  return result;
}

async function main() {
  for (const authorization of [undefined, 'Bearer invalid-connectivity-test']) {
    const response = await request({ path: '/mcp', headers: authorization ? { Authorization: authorization } : {} });
    requireCondition({ condition: response.status === 401, message: 'MCP must reject missing and invalid tokens' });
    await response.arrayBuffer();
  }
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
    await expectJson({ response: await request({ path }), stage: 'OAuth discovery' });
  }
  let session;
  if (process.env.MCP_FRESH_AUTH !== 'true') {
    try {
      const candidate = JSON.parse(await readFile(sessionPath, 'utf8'));
      if (candidate.resource === resource && candidate.expiresAt > Date.now() + 60_000) session = candidate;
    } catch { /* Missing local cache starts the normal OAuth flow. */ }
  }
  if (!session) session = await authorizeOwner();
  let transportSession;
  const rpc = async ({ body, stage }) => {
    const response = await request({
      path: '/mcp', method: 'POST', body,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json, text/event-stream',
        ...(transportSession ? { 'Mcp-Session-Id': transportSession } : {}),
      },
    });
    transportSession ||= response.headers.get('mcp-session-id');
    return parseRpc({ response, stage });
  };
  await rpc({
    stage: 'MCP initialize',
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'Personal Finance verification', version: '1.0.0' },
    } },
  });
  const notification = await request({
    path: '/mcp', method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': transportSession },
  });
  requireCondition({ condition: notification.ok, message: 'MCP initialized notification failed' });
  await notification.arrayBuffer();
  const listing = await rpc({ stage: 'MCP tool listing', body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  const tools = listing.result?.tools;
  requireCondition({ condition: Array.isArray(tools), message: 'MCP tool catalog missing' });
  requireCondition({ condition: tools.some((tool) => tool.name === 'get_accounts'), message: 'MCP account read tool missing' });
  await rpc({ stage: 'MCP account read', body: {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_accounts', arguments: {} },
  } });
  const personalTool = tools.some((tool) => tool.name === 'get_personal_net_worth');
  if (personalTool) {
    await rpc({ stage: 'MCP personal finance read', body: {
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_personal_net_worth', arguments: {} },
    } });
  }
  requireCondition({
    condition: process.env.MCP_EXPECT_PERSONAL_TOOL !== 'true' || personalTool,
    message: 'Custom personal net-worth MCP tool is not deployed yet',
  });
  const termination = await request({ path: '/mcp', method: 'DELETE', headers: {
    Authorization: `Bearer ${session.accessToken}`, 'Mcp-Session-Id': transportSession,
    Accept: 'application/json, text/event-stream',
  } });
  await termination.arrayBuffer();
  console.log(JSON.stringify({ authentication: 'passed', oauthPkce: 'passed', discovery: 'passed',
    streamableHttp: 'passed', toolCount: tools.length, accountRead: 'passed',
    personalNetWorthRead: personalTool ? 'passed' : 'not-deployed', tokenScope: 'read-only' }));
}

main().catch((error) => {
  console.error(error instanceof VerificationError ? error.message : 'MCP validation failed; sensitive error details suppressed');
  process.exitCode = 1;
});
