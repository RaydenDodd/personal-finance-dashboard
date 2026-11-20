import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';

export type PayrollRangePreset = '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all' | 'custom';
export interface PayrollRange {
  preset: PayrollRangePreset;
  from: string;
  through: string;
}
export const payrollToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function payrollRange(
  preset: PayrollRangePreset,
  today = payrollToday(),
  earliest = '1900-01-01',
): PayrollRange {
  const end = parseISO(today);
  const from =
    preset === 'all'
      ? earliest
      : preset === 'ytd'
        ? format(startOfYear(end), 'yyyy-MM-dd')
        : format(
            /^\d+m$/.test(preset) ? subMonths(end, Number(preset[0])) : subYears(end, Number(preset[0]) || 1),
            'yyyy-MM-dd',
          );
  return { preset, from, through: today };
}
export function shiftPayrollRange(range: PayrollRange, direction: -1 | 1, today = payrollToday()): PayrollRange {
  if (range.preset === 'all') return range;
  const move = (value: string) => {
    const date = parseISO(value);
    if (/^\d+m$/.test(range.preset)) return addMonths(date, Number(range.preset[0]) * direction);
    if (range.preset.endsWith('y') || range.preset === 'ytd')
      return addYears(date, (Number(range.preset[0]) || 1) * direction);
    return addDays(date, (differenceInCalendarDays(parseISO(range.through), parseISO(range.from)) + 1) * direction);
  };
  const through = format(move(range.through), 'yyyy-MM-dd');
  if (direction > 0 && through > today) return range;
  return { ...range, from: format(move(range.from), 'yyyy-MM-dd'), through };
}
