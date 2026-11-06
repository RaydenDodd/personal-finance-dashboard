import type { NextFunction, Request, Response } from 'express';

/** Internal context, overwritten before any caller can reach Better Auth. */
export const AUTH_ORIGIN_HEADER = 'x-bt-auth-origin';
export type AuthRequestHeaders = NonNullable<ConstructorParameters<typeof Headers>[0]>;

export function configuredPublicAuthOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value.replace(/\/$/, '')
  )
    throw Error('FINANCE_PUBLIC_ORIGIN must be an exact HTTPS origin without a path or credentials');
  return parsed.origin;
}

/** The frontend strips/replaces forwarded headers, accepting public HTTPS only
 * from its explicitly configured host Caddy peer. Express independently requires
 * a trusted socket hop, the exact Host, and that validated HTTPS protocol. */
export function publicAuthOriginMiddleware(publicOrigin: string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    delete req.headers[AUTH_ORIGIN_HEADER];
    if (!publicOrigin || req.get('host')?.toLowerCase() !== new URL(publicOrigin).host) return next();
    const trust = req.app.get('trust proxy fn') as ((address: string, index: number) => boolean) | undefined;
    const peer = req.socket.remoteAddress;
    if (!peer || !trust?.(peer, 0) || req.protocol !== 'https')
      return res.status(400).json({ status: 'error', response: { message: 'Invalid public proxy origin' } });
    req.headers[AUTH_ORIGIN_HEADER] = publicOrigin;
    return next();
  };
}

interface AuthProfile {
  handler(request: globalThis.Request): Promise<globalThis.Response>;
  api: object;
}

/** Two profiles share the existing auth store and backend process. The private
 * profile retains the canonical MCP issuer. Public web sessions have their own
 * HTTPS origin/cookie names. Direct server calls without request context remain
 * private; no process-global mutable request origin is used. */
export function originAwareAuth<T extends AuthProfile>(
  privateAuth: T,
  publicAuth: T | null,
  publicOrigin: string | null,
): T {
  const profile = (headers?: AuthRequestHeaders) => {
    if (!publicAuth || !publicOrigin || !headers) return privateAuth;
    return new Headers(headers).get(AUTH_ORIGIN_HEADER) === publicOrigin ? publicAuth : privateAuth;
  };
  const api = new Proxy(privateAuth.api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const input = args[0] as { headers?: AuthRequestHeaders } | undefined;
        const selected = profile(input?.headers);
        return Reflect.get(selected.api, property).apply(selected.api, args);
      };
    },
  });
  return new Proxy(privateAuth, {
    get(target, property, receiver) {
      if (property === 'api') return api;
      if (property === 'handler' || property === 'fetch')
        return (request: globalThis.Request) => profile(request.headers).handler(request);
      return Reflect.get(target, property, receiver);
    },
  });
}
