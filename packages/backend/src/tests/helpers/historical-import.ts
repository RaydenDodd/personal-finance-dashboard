import type { HistoricalTransactionRow } from '@bt/shared/types';
import type {
  executeHistoricalImport,
  previewHistoricalImport,
} from '@services/import-export/core/historical-transactions.service';

import { makeRequest } from './common';

export const previewHistory = <R extends boolean | undefined = undefined>({
  rows,
  raw,
}: {
  rows: HistoricalTransactionRow[];
  raw?: R;
}) =>
  makeRequest<Awaited<ReturnType<typeof previewHistoricalImport>>, R>({
    method: 'post',
    url: '/import/historical/preview',
    payload: { rows },
    raw,
  });

export const executeHistory = <R extends boolean | undefined = undefined>({
  rows,
  previewToken,
  raw,
}: {
  rows: HistoricalTransactionRow[];
  previewToken: string;
  raw?: R;
}) =>
  makeRequest<Awaited<ReturnType<typeof executeHistoricalImport>>, R>({
    method: 'post',
    url: '/import/historical/execute',
    payload: { rows, previewToken },
    raw,
  });
