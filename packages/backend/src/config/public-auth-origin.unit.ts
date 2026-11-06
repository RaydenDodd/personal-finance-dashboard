import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import {
  AUTH_ORIGIN_HEADER,
  configuredPublicAuthOrigin,
  originAwareAuth,
  publicAuthOriginMiddleware,
  type AuthRequestHeaders,
} from './public-auth-origin';

const publicOrigin = 'https://finance.example.test';
const app = (trusted = false) => {
  const server = express();
  server.set('trust proxy', trusted);
  server.use(publicAuthOriginMiddleware(publicOrigin));
  server.get('/', (req, res) => res.json({ origin: req.headers[AUTH_ORIGIN_HEADER] ?? 'private' }));
  return server;
};

describe('public authentication origin boundary', () => {
  it('allows only an exact HTTPS origin in configuration', () => {
    expect(configuredPublicAuthOrigin('')).toBeNull();
    expect(configuredPublicAuthOrigin(publicOrigin + '/')).toBe(publicOrigin);
    for (const value of [
      'http://finance.example.test',
      publicOrigin + '/path',
      publicOrigin + '?query=1',
      'https://user:password@finance.example.test',
    ])
      expect(() => configuredPublicAuthOrigin(value)).toThrow();
  });
  it('strips caller-supplied context on private hosts', async () => {
    const response = await request(app(true))
      .get('/')
      .set(AUTH_ORIGIN_HEADER, publicOrigin)
      .set('X-Forwarded-Proto', 'https');
    expect(response.body.origin).toBe('private');
  });
  it('does not allow forwarded Host to select a public profile', async () => {
    const response = await request(app(true))
      .get('/')
      .set('Host', 'localhost')
      .set('X-Forwarded-Host', 'finance.example.test')
      .set('X-Forwarded-Proto', 'https');
    expect(response.body.origin).toBe('private');
  });
  it('rejects the public host when HTTPS is not proven through a trusted socket hop', async () => {
    expect(
      (await request(app(false)).get('/').set('Host', 'finance.example.test').set('X-Forwarded-Proto', 'https')).status,
    ).toBe(400);
    expect((await request(app(true)).get('/').set('Host', 'finance.example.test')).status).toBe(400);
  });
  it('selects the public context only for exact Host and trusted HTTPS', async () => {
    const response = await request(app(true))
      .get('/')
      .set('Host', 'finance.example.test')
      .set('X-Forwarded-Proto', 'https')
      .set(AUTH_ORIGIN_HEADER, 'https://attacker.example.test');
    expect(response.body.origin).toBe(publicOrigin);
  });
  it('keeps the old behavior when the public origin is not configured', async () => {
    const server = express();
    server.use(publicAuthOriginMiddleware(null));
    server.get('/', (req, res) => res.json({ origin: req.headers[AUTH_ORIGIN_HEADER] ?? 'private' }));
    expect((await request(server).get('/').set(AUTH_ORIGIN_HEADER, publicOrigin)).body.origin).toBe('private');
  });
  it('dispatches handlers and every API method without leaking context between concurrent requests', async () => {
    const make = (name: string) => ({
      handler: async (_request: Request) => new Response(name),
      api: {
        getSession: async (_input?: { headers?: AuthRequestHeaders }) => name,
        setPassword: async (_input?: { headers?: AuthRequestHeaders }) => name,
      },
      options: { issuer: name },
    });
    const auth = originAwareAuth(make('private'), make('public'), publicOrigin);
    const headers = new Headers({ [AUTH_ORIGIN_HEADER]: publicOrigin });
    expect(
      await Promise.all([
        auth.api.getSession({ headers }),
        auth.api.getSession(),
        auth.api.setPassword({ headers: { [AUTH_ORIGIN_HEADER]: publicOrigin } }),
      ]),
    ).toEqual(['public', 'private', 'public']);
    expect(await (await auth.handler(new Request(publicOrigin, { headers }))).text()).toBe('public');
    expect(await (await auth.handler(new Request('http://localhost'))).text()).toBe('private');
    expect(auth.options.issuer).toBe('private');
  });
});
