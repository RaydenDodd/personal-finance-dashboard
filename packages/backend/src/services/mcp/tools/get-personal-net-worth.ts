import { getFinanceDashboard } from '@services/personal-finance';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPersonalNetWorthTool = defineTool({
  name: 'get_personal_net_worth',
  toolset: 'core',
  access: 'read',
  description:
    'Read the custom net-worth dashboard, including actual dated balances, reporting accounts, principal and gains. No balances or contributions are inferred.',
  input: {
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    granularity: z.enum(['monthly', 'daily']).optional(),
  },
  run: async ({ userId, args }) => ({ data: await getFinanceDashboard(userId, args) }),
});
