import { payrollRange, type PayrollRange, type PayrollRangePreset } from '@/pages/income-management/payroll/date-range';

/** Retain shifted fixed-length periods when persisted settings are read back. */
export function investmentRange(settings: Record<string, unknown>, earliest: string): PayrollRange {
  const preset = (
    settings.dateRange === 'MAX' ? 'all' : String(settings.dateRange ?? '1Y').toLowerCase()
  ) as PayrollRangePreset;
  if (preset !== 'all' && typeof settings.from === 'string' && typeof settings.through === 'string') {
    return { preset, from: settings.from, through: settings.through };
  }
  return payrollRange(preset, undefined, earliest);
}

export function investmentRangeSettings(range: PayrollRange): Record<string, unknown> {
  return {
    dateRange: range.preset === 'all' ? 'MAX' : range.preset === 'custom' ? 'custom' : range.preset.toUpperCase(),
    from: range.from,
    through: range.through,
  };
}
