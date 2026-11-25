import {
  createInvestmentTransactionBodySchema,
  createInvestmentTransactionBodyShape,
} from '@controllers/investments/transactions/schemas';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

const rowSchema = z
  .strictObject({
    ...createInvestmentTransactionBodyShape,
    sourceRowId: createInvestmentTransactionBodyShape.sourceRowId.unwrap().describe(
      'Stable SHA-256 broker source row identity; reuse the exact same ID on retries and overlapping exports',
    ),
  })
  .omit({ portfolioId: true });

export const bulkImportInvestmentTransactionsTool = defineTool({
  name: 'bulk_import_investment_transactions',
  toolset: 'investments',
  access: 'write',
  description:
    'Import up to 50 reviewed investment trades into one portfolio. Resolve securities and create any missing holdings first, and submit actual execution details in chronological order. Each row requires its stable broker sourceRowId, matching the existing broker import convention. Do not invent executions from deposit or trading-window summaries. Replaying a source row returns the existing transaction without changing cash or holdings again. A batch can partially succeed; inspect each result and retry with the original IDs.',
  input: {
    portfolioId: createInvestmentTransactionBodyShape.portfolioId.describe('Target portfolio ID from get_portfolios'),
    trades: z.array(rowSchema).min(1).max(50).describe('Reviewed execution rows in chronological order'),
  },
  run: async ({ userId, args }) => {
    // Validate every row, including the REST settlement refinements, before the first write.
    const rows = args.trades.map((trade) =>
      createInvestmentTransactionBodySchema.parse({ ...trade, portfolioId: args.portfolioId }),
    );
    const sourceIds = args.trades.map((trade) => trade.sourceRowId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new Error('Each sourceRowId must be unique within the batch.');
    }

    const results: Array<{
      sourceRowId: string;
      status: 'recorded_or_existing' | 'failed';
      transactionId?: string;
      message?: string;
    }> = [];

    // Each canonical service call owns its transaction and source-row advisory lock.
    // Sequential writes preserve the submitted trade order and avoid replaying cash twice.
    for (const [index, row] of rows.entries()) {
      const sourceRowId = sourceIds[index]!;
      try {
        const transaction = await createInvestmentTransaction({ userId, ...row, sourceRowId });
        results.push({ sourceRowId, status: 'recorded_or_existing', transactionId: transaction.id });
      } catch {
        // Never disclose database/provider errors to the client; prior successful rows remain committed.
        results.push({
          sourceRowId,
          status: 'failed',
          message: 'Trade could not be recorded. Check portfolio ownership, holding, quantity and settlement details.',
        });
        // Stop to avoid applying dependent sells after a failed earlier acquisition.
        break;
      }
    }

    return {
      results,
      remainingSourceRowIds: sourceIds.slice(results.length),
    };
  },
});
