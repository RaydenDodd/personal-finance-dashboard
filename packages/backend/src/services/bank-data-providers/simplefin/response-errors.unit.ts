import { simplefinAccountWarnings } from './response-errors';
import type { SimplefinAccount, SimplefinAccountSet } from './types';
const account = { id: 'account-1', conn_id: 'MX-MBR-m1' } as SimplefinAccount;
describe('SimpleFIN institution error mapping', () => {
  it('matches an unprefixed error to its MX-prefixed institution, without flagging another bank', () => {
    const response = {
      accounts: [account],
      errlist: [{ code: 'con.auth', msg: 'Reconnect M1', conn_id: 'MBR-m1' }],
    } as SimplefinAccountSet;
    expect(simplefinAccountWarnings(response, account)).toEqual(['Reconnect M1']);
    expect(simplefinAccountWarnings(response, { ...account, conn_id: 'MX-MBR-usbank' })).toEqual([]);
  });
  it('preserves account-specific, global and legacy warnings', () => {
    expect(
      simplefinAccountWarnings(
        {
          accounts: [],
          errlist: [
            { code: 'act.failed', msg: 'Incomplete account', account_id: 'account-1' },
            { code: 'gen.api', msg: 'Request warning' },
          ],
        },
        account,
      ),
    ).toEqual(['Incomplete account', 'Request warning']);
    expect(simplefinAccountWarnings({ accounts: [], errors: ['Legacy notice'] }, account)).toEqual(['Legacy notice']);
  });
});
