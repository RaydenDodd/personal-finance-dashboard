import { isFundSecurity } from './registry';
describe('fund inventory identities', () => {
  it('keeps Invesco operating companies and mortgage REITs as direct companies', () => {
    expect(isFundSecurity({ symbol: 'IVR', name: 'Invesco Mortgage Capital Inc.' })).toBe(false);
    expect(isFundSecurity({ symbol: 'IVZ', name: 'Invesco Ltd.' })).toBe(false);
    expect(isFundSecurity({ symbol: 'QQQ', name: 'Invesco QQQ Trust Series 1' })).toBe(true);
    expect(isFundSecurity({ symbol: 'NEWFUND', name: 'Invesco New Strategy ETF' })).toBe(true);
  });
});
