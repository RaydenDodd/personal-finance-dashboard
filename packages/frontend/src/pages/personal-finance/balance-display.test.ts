import type { FinanceCashFlow } from '@/api/personal-finance';
import { describe, expect, it } from 'vitest';

import { accountManagementLabel, recordedPrincipal, valuationSourceLabel } from './balance-display';

describe('dated personal balance and contribution display', () => {
  it('does not add a contribution twice when a cumulative checkpoint already includes that date', () => {
    expect(
      recordedPrincipal(
        'a',
        [
          { id: 'deposit', accountId: 'a', date: '2025-04-28', amount: 89, type: 'contribution' },
          {
            id: 'basis',
            accountId: 'a',
            date: '2025-04-28',
            amount: 939.21,
            type: 'adjustment',
            opening: true,
            evidence: { checkpoint: true },
          },
        ],
        '2025-04-28',
      ),
    ).toBe(939.21);
  });
  it('does not invent principal before a known opening or count returns as new capital', () => {
    const flows: FinanceCashFlow[] = [
      { id: 'opening', accountId: 'invest', type: 'contribution', date: '2026-01-02', amount: 100.1, opening: true },
      { id: 'return', accountId: 'invest', type: 'dividend', date: '2026-01-03', amount: 20 },
      { id: 'deposit', accountId: 'invest', type: 'contribution', date: '2026-01-05', amount: 0.2 },
      { id: 'move', accountId: 'invest', toAccountId: 'retire', type: 'transfer', date: '2026-01-06', amount: 10 },
      { id: 'withdraw', accountId: 'invest', type: 'withdrawal', date: '2026-02-01', amount: 5 },
    ];
    expect(recordedPrincipal('invest', flows, '2026-01-01')).toBeNull();
    expect(recordedPrincipal('invest', flows, '2026-01-05')).toBe(100.3);
    expect(recordedPrincipal('invest', flows, '2026-01-31')).toBe(90.3);
    expect(recordedPrincipal('invest', flows, '2026-02-02')).toBe(85.3);
  });
  it('preserves zero opening principal and the destination side of owned transfers', () => {
    const flows: FinanceCashFlow[] = [
      { id: 'basis', accountId: 'saving', type: 'adjustment', date: '2026-01-01', amount: 0, opening: true },
      { id: 'move', accountId: 'invest', toAccountId: 'saving', type: 'transfer', date: '2026-01-02', amount: 10.25 },
    ];
    expect(recordedPrincipal('saving', flows, '2026-01-01')).toBe(0);
    expect(recordedPrincipal('saving', flows, '2026-01-02')).toBe(10.25);
  });
  it('describes unavailable bank connections without disabling manual management', () => {
    expect(accountManagementLabel({ preferredSource: 'simplefin', connectionStatus: 'disconnected' })).toContain(
      'Manual fallback',
    );
    expect(accountManagementLabel({ preferredSource: 'manual', connectionStatus: 'manual' })).toBe('Manually managed');
    expect(valuationSourceLabel('google-sheets')).toBe('Google Sheets');
    expect(valuationSourceLabel(null)).toBe('Unknown source');
  });
  it('leaves gains unavailable after the last verified contribution period', () => {
    const checkpoint: FinanceCashFlow = {
      id: 'checkpoint',
      accountId: 'retirement',
      date: '2026-05-29',
      type: 'adjustment',
      amount: 150,
      opening: true,
      evidence: { principalValidThrough: '2026-05-29' },
    };
    expect(recordedPrincipal('retirement', [checkpoint], '2026-05-29')).toBe(150);
    expect(recordedPrincipal('retirement', [checkpoint], '2026-11-05')).toBeNull();
  });
});
