import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getFinanceDashboard } from '@services/personal-finance';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

export function registerGetPersonalNetWorth(server: McpServer) {
  server.registerTool('get_personal_net_worth', {
    description: 'Read the custom net-worth dashboard: reporting categories, included accounts, actual dated historical balances, missing valuations, contribution-based principal/gains, and monthly changes. No balances or contributions are inferred. Read-only.',
    inputSchema: { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      granularity: z.enum(['monthly', 'daily']).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async (args, extra) => jsonContent({ data: await getFinanceDashboard(getUserId({ extra }), args) }));
}
