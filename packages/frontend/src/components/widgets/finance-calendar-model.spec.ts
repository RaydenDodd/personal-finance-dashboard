import { describe, expect, it } from 'vitest';
import { calendarRoles, fundingEntries, monthBounds, monthCells, spendingEntries, summarizeDay, summarizeDayTotals, calendarTransactionFilters } from './finance-calendar-model';

describe('monthly finance calendar', () => {
  it('deep links to the selected date with spending filters or all real activity for contributions', () => {
    expect(calendarTransactionFilters('2026-11-16', true)).toEqual({
      start: '2026-11-16', end: '2026-11-16', plannedFilter: 'exclude', transferFilter: 'exclude', transactionType: 'expense',
    });
    expect(calendarTransactionFilters('2026-11-16', false, ['robinhood-65', 'robinhood-90', 'robinhood-65'])).toEqual({
      start: '2026-11-16', end: '2026-11-16', plannedFilter: 'exclude', transferFilter: 'all', calendarIds: 'robinhood-65,robinhood-90',
    });
  });
  it('keeps an empty funding date explicitly empty', () => {
    expect(calendarTransactionFilters('2026-11-13', false, [])).toMatchObject({ calendarIds: 'none' });
  });
  it('keeps tooltip totals and percentage denominators separate by currency', () => {
    const groups = summarizeDay([
      { id:'1', date:'2026-11-01', group:'Food', label:'Food', color:'#ff0000', amount:80, currency:'USD' },
      { id:'2', date:'2026-11-01', group:'Transport', label:'Transport', color:'#00ff00', amount:-20, currency:'USD' },
      { id:'3', date:'2026-11-01', group:'Other', label:'Other', color:'#0000ff', amount:10, currency:'EUR' },
    ]);
    expect(summarizeDayTotals(groups)).toEqual([
      { currency:'USD', amount:60, activity:100 },
      { currency:'EUR', amount:10, activity:10 },
    ]);
  });
  it('uses calendar days and correct Sunday offsets including leap years', () => {
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthCells('2026-11')[0]).toEqual({ date: '2026-11-01', day: 1 });
    expect(monthCells('2024-02').slice(0, 4)).toEqual([null, null, null, null]);
    expect(monthCells('2026-11')).toHaveLength(35);
    expect(monthCells('2026-08')).toHaveLength(42);
    expect(monthCells('2026-02')).toHaveLength(28);
  });
  it('colors actual funding transactions without a separate payroll or principal source', () => {
    expect(fundingEntries({ entries: [{ id: 'a', date: '2026-11-21', group: 'Investments', label: 'M1', amount: 200, currency: 'USD' }] }))
      .toMatchObject([{ id: 'a', group: 'Investments', color: calendarRoles[1]!.color, amount: 200 }]);
  });
  it('sizes activity bands proportionally without treating a withdrawal as zero', () => {
    const rows = calendarRoles.map((role, i) => ({
      ...role, label: role.group, id: String(i), date: '2026-11-01', amount: [100, -50, 50][i]!, currency: 'USD',
    }));
    const groups = summarizeDay(rows);
    expect(groups.map((group) => group.width)).toEqual([50, 25, 25]);
    expect(groups.find((group) => group.group === 'Investments')?.amount).toBe(-50);
    expect(summarizeDay([{ ...rows[0]!, currency: 'EUR' }, rows[1]!]).map(g => g.width)).toEqual([50, 50]);
  });
  it('uses server category totals, avoids child double counts, preserves refunds and ignores zero cells', () => {
    const entries = spendingEntries({
      columns: [{ key: '2026-11-01', periodStart: '2026-11-01', periodEnd: '2026-11-01', label: 'Nov 1' }],
      rows: [
        { id: 'food', label: 'Food', color: '#ef4444', parentId: null, kind: 'parent', values: { '2026-11-01': 25 }, total: 25 },
        { id: 'restaurant', label: 'Restaurant', color: '#ef4444', parentId: 'food', kind: 'child', values: { '2026-11-01': 25 }, total: 25 },
        { id: 'other', label: 'Other', color: '#123456', parentId: null, kind: 'flat', values: { '2026-11-01': -5 }, total: -5 },
      ],
      currencyCode: 'USD', columnTotals: { '2026-11-01': 20 }, grandTotal: 20,
    });
    expect(entries.map(r => r.amount)).toEqual([25, -5]);
    expect(entries.map(r => r.color)).toEqual(['#ef4444', '#123456']);
  });
});

// The compact layout must still fit every possible month (including six weeks).
