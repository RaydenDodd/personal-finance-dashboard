import { signupEmailAllowed } from './signup-email-policy';
describe('invited signup emails', () => {
  it('restricts configured signups to the invited address', () => {
    expect(signupEmailAllowed('MHEN9535@gmail.com', 'mhen9535@gmail.com')).toBe(true);
    expect(signupEmailAllowed('other@gmail.com', 'mhen9535@gmail.com')).toBe(false);
    expect(signupEmailAllowed('mhen9535+other@gmail.com', 'mhen9535@gmail.com')).toBe(false);
  });
  it('keeps existing unrestricted installations compatible', () => {
    expect(signupEmailAllowed('other@gmail.com', '')).toBe(true);
  });
});
