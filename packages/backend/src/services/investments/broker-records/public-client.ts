import { z } from 'zod';

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
export const publicPosition = z.object({
  instrument: z.object({ symbol: z.string(), name: z.string().nullable(), type: z.string() }),
  quantity: decimal,
  currentValue: decimal,
  lastPrice: z.object({ lastPrice: decimal }).nullish(),
  costBasis: z.object({ totalCost: decimal.nullable() }).nullable(),
});
export const publicEvent = z.object({
  id: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  type: z.string(),
  subType: z.string(),
  symbol: z.string().nullable(),
  securityType: z.string().nullable(),
  side: z.string().nullable(),
  description: z.string(),
  netAmount: decimal.nullable(),
  principalAmount: decimal.nullable(),
  quantity: decimal.nullable(),
  fees: decimal.nullable(),
});
export type PublicEvent = z.infer<typeof publicEvent>;

/** Fixed origin and a closed read allowlist. The sole POST exchanges the secret for a short-lived token. */
export class PublicReadClient {
  private token = '';
  private readonly deadline = Date.now() + 10 * 60 * 1000;
  constructor(private readonly transport: typeof fetch = fetch) {}

  async authorize(secret: string) {
    const response = await this.transport('https://api.public.com/userapiauthservice/personal/access-tokens', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, validityInMinutes: 15 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Public authorization failed (HTTP ${response.status}).`);
    this.token = z.object({ accessToken: z.string().min(1) }).parse(await response.json()).accessToken;
  }

  async read(path: string) {
    if (Date.now() > this.deadline) throw new Error('Public read session timed out.');
    if (
      !/^\/userapigateway\/trading\/(?:account|[A-Za-z0-9_-]+\/(?:portfolio\/v2|history(?:\?[^#]*)?|taxlots\/unrealized))$/.test(
        path,
      )
    )
      throw new Error('Unsupported Public read endpoint.');
    const response = await this.transport(`https://api.public.com${path}`, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Public read failed (HTTP ${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  async accounts() {
    return z
      .object({
        accounts: z.array(z.object({ accountId: z.string().regex(/^[A-Za-z0-9_-]+$/), accountType: z.string() })),
      })
      .parse(await this.read('/userapigateway/trading/account')).accounts;
  }

  async portfolio(accountId: string) {
    return z
      .object({
        accountId: z.string(),
        positions: z.array(publicPosition),
        cash: decimal.optional(),
        totalAccountValue: decimal.optional(),
      })
      .parse(await this.read(`/userapigateway/trading/${accountId}/portfolio/v2`));
  }

  async history(accountId: string) {
    const events: PublicEvent[] = [];
    const cursors = new Set<string>();
    let nextToken: string | undefined;
    do {
      const query = new URLSearchParams({ pageSize: '100', ...(nextToken ? { nextToken } : {}) });
      const page = z
        .object({ transactions: z.array(publicEvent), nextToken: z.string().nullish() })
        .parse(await this.read(`/userapigateway/trading/${accountId}/history?${query}`));
      events.push(...page.transactions);
      if (events.length > 10000) throw new Error('Public history exceeds the safe import size.');
      nextToken = page.nextToken || undefined;
      if (nextToken) {
        if (cursors.has(nextToken) || cursors.size >= 1000)
          throw new Error('Public history pagination did not complete.');
        cursors.add(nextToken);
      }
    } while (nextToken);
    return events;
  }
}
