import type { Period } from '@/pages/dashboard/types';
import type { PayrollRange } from '@/pages/income-management/payroll/date-range';
import { format } from 'date-fns';
import { computed, inject, type Ref } from 'vue';

/** The main Dashboard owns its period. Page modules retain independent date controls. */
export function useDashboardPeriod() {
  const selected = inject<Ref<Period | undefined> | null>('dashboard-period', null);
  const range = computed<PayrollRange | null>(() =>
    selected?.value
      ? {
          preset: 'custom',
          from: format(selected.value.from, 'yyyy-MM-dd'),
          through: format(selected.value.to, 'yyyy-MM-dd'),
        }
      : null,
  );
  return { dashboardRange: range };
}
