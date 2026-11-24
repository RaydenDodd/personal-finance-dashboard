import { describe, it, expect } from 'vitest';

import { shouldOpenDashboardAtLaunch } from './pwa-start-route';
const start = { initialNavigation: true, standalone: true, path: '/personal-finance', query: {} };
describe('installed app start page', () => {
  it('opens Dashboard for an old Personal Net Worth shortcut', () =>
    expect(shouldOpenDashboardAtLaunch(start)).toBe(true));
  it('allows navigating to Personal Net Worth inside the app', () =>
    expect(shouldOpenDashboardAtLaunch({ ...start, initialNavigation: false })).toBe(false));
  it('preserves account and dated deep links', () =>
    expect(shouldOpenDashboardAtLaunch({ ...start, query: { accountId: 'a', date: '2026-11-24' } })).toBe(false));
  it('does not redirect a regular browser refresh', () =>
    expect(shouldOpenDashboardAtLaunch({ ...start, standalone: false })).toBe(false));
});
