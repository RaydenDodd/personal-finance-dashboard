import type { SimplefinAccount, SimplefinAccountSet } from './types';

// Bridge account IDs can carry the MX- source prefix while errlist IDs omit it.
const connectionId = (value?: string) => value?.replace(/^MX-/, '');
export function simplefinAccountWarnings(accountSet: SimplefinAccountSet, account: SimplefinAccount): string[] {
  if (!accountSet.errlist?.length) return accountSet.errors ?? [];
  return accountSet.errlist
    .filter(
      (error) =>
        (!error.conn_id && !error.account_id) ||
        error.account_id === account.id ||
        (!!error.conn_id && connectionId(error.conn_id) === connectionId(account.conn_id)),
    )
    .map((error) => error.msg);
}
