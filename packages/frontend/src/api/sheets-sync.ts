import { api } from '@/api/_api';

export interface SheetsSyncConfig {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  mirrorSimplefin: boolean;
  mappings: Array<{ accountId: string; balanceRow: number; principalRow?: number }>;
}
export interface SheetsSyncConflict {
  id: string;
  accountId: string;
  date: string;
  kind: 'balance' | 'principal';
  sheetValue: number | null;
  dashboardValue: number | null;
  reason: string;
  status: 'open';
}
export interface SheetsSyncStatus {
  config: SheetsSyncConfig | null;
  credentialsConfigured: boolean;
  oauthConfigured: boolean;
  authKind: 'service-account' | 'oauth-refresh' | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  pendingWrites: number;
  conflicts: SheetsSyncConflict[];
  issues?: Array<{ accountId: string; reason: string; cell?: string }>;
}
export interface SheetsSyncResult {
  skipped?: boolean;
  failed?: boolean;
  reason?: string;
  importedBalances: number;
  importedContributions: number;
  writtenBalances: number;
  writtenContributions: number;
  conflicts: number;
}
const path = '/personal-finance/sheets-sync';
export const getSheetsSyncStatus = (): Promise<SheetsSyncStatus> => api.get(path, {}, { silent: true });
export const saveSheetsSyncConfig = (config: SheetsSyncConfig): Promise<SheetsSyncStatus> => api.put(path, config);
export const runSheetsSync = (): Promise<SheetsSyncResult> => api.post(`${path}/run`);
export const resolveSheetsSyncConflict = (id: string, resolution: 'sheet' | 'dashboard') =>
  api.post(`${path}/conflicts/${id}/resolve`, { resolution });
export const saveSheetsServiceAccount = (credential: {
  clientEmail: string;
  privateKey: string;
}): Promise<SheetsSyncStatus> => api.post(`${path}/credentials`, { kind: 'service-account', ...credential });
export const startSheetsOAuth = (): Promise<{ authorizationUrl: string }> => api.get(`${path}/oauth/start`);
