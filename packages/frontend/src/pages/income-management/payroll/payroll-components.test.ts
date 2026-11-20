import type { PayrollDashboard } from '@bt/shared/types/payroll';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

import ActualSummary from './actual-summary.vue';
import DateRange from './date-range.vue';
import PayrollManagement from './management.vue';

const calls = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/api/payroll', () => ({
  savePayrollManagement: calls.save,
  importPayroll: vi.fn(),
  linkPayrollDeposits: vi.fn(),
  parsePayrollPdf: vi.fn(),
  importReviewedPayroll: vi.fn(),
  reconcilePayrollRetirement: vi.fn(),
}));
vi.mock('./use-payroll', () => ({
  PAYROLL_QUERY_KEY: 'actual-payroll',
  usePayroll: () => ({ data: ref(undefined), isError: ref(false) }),
}));
vi.mock('@/api/personal-finance', () => ({ getPersonalFinanceDashboard: vi.fn() }));
vi.mock('@tanstack/vue-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/vue-query')>()),
  useQueryClient: () => ({ invalidateQueries: calls.invalidate }),
  useQuery: () => ({ data: ref(undefined), isError: ref(false) }),
}));
vi.mock('../index.vue', () => ({ default: { template: '<div />' } }));

function data(): PayrollDashboard {
  return {
    revision: 3,
    employments: [
      {
        id: 'employment',
        employerName: 'Example employer',
        jobTitle: 'Engineer',
        startDate: '2024-01-01',
        endDate: null,
        positionStartDate: '2024-01-01',
        positionEndDate: null,
        status: 'current',
        source: 'manual',
        payFrequency: 'biweekly',
        compensationType: 'salary',
        annualHours: null,
        manualAnnualSalary: null,
        notes: '',
      },
    ],
    statements: [],
    salaryEvents: [],
    manualSalaryEvents: [],
    received: [],
    reconciliation: [],
    issues: [],
    summary: {
      gross: 10000,
      net: 6000,
      regular: 9500,
      additional: 500,
      bonus: 500,
      noncashEarnings: 0,
      federal: 1000,
      state: 500,
      local: 0,
      socialSecurity: 600,
      medicare: 150,
      employeeRetirement: 1500,
      employerMatch: 400,
      employerOtherRetirement: 300,
      employerRetirement: 700,
      benefits: 200,
      otherDeductions: 50,
      noncashOffsets: 0,
      totalCompensation: 10700,
      from: '2025-01-01',
      through: '2025-12-31',
      count: 2,
      currentSalary: 120000,
      currentEmployer: 'Example employer',
      currentJobTitle: 'Engineer',
      startingSalary: 100000,
      previousSalary: 110000,
      salaryGrowth: 20000,
      salaryGrowthPercent: 20,
      lastRaiseDate: '2026-01-01',
      coverageFrom: '2024-01-12',
      coverageThrough: '2026-01-09',
    },
    status: {
      connectionStatus: 'assisted-export',
      lastSuccessfulSync: null,
      lastSuccessfulImport: '2026-01-10T12:00:00Z',
      latestPaycheck: '2026-01-09',
      statementCount: 2,
      reminderDue: false,
      settings: { reminderDays: 30, snoozedUntil: null, reminderDismissed: false },
      history: [],
    },
  };
}
describe('actual payroll components', () => {
  beforeEach(() => {
    calls.save.mockReset().mockResolvedValue({});
    calls.invalidate.mockReset().mockResolvedValue(undefined);
  });
  it('keeps current base salary distinct from historical earnings and employer-funded compensation', () => {
    const wrapper = mount(ActualSummary, { props: { data: data() } });
    expect(wrapper.text()).toContain('$120,000.00');
    expect(wrapper.text()).toContain('$10,000.00');
    expect(wrapper.text()).toContain('$6,000.00');
    expect(wrapper.text()).toContain('$10,700.00');
    expect(wrapper.text()).toContain('2025-01-01');
    expect(wrapper.text()).toContain('Withholding is not final tax liability');
    expect(calls.save).not.toHaveBeenCalled();
  });
  it('changes selected historical earnings without replacing the current salary headline', async () => {
    const original = data();
    const wrapper = mount(ActualSummary, { props: { data: original } });
    await wrapper.setProps({
      data: {
        ...original,
        summary: {
          ...original.summary,
          gross: 4000,
          net: 2500,
          totalCompensation: 4200,
          from: '2024-01-01',
          through: '2024-12-31',
        },
      },
    });
    expect(wrapper.text()).toContain('$120,000.00');
    expect(wrapper.text()).toContain('$4,000.00');
    expect(wrapper.text()).not.toContain('$10,000.00');
  });
  it('does not display incomplete reviewed payroll withholding as verified zero', () => {
    const sample = data();
    sample.statements = [
      {
        id: 'partial',
        employmentId: 'employment',
        payDate: '2025-06-01',
        incompleteFields: ['withholding'],
      } as PayrollDashboard['statements'][number],
    ];
    const wrapper = mount(ActualSummary, { props: { data: sample } });
    expect(wrapper.text()).toContain('Tax withholding is incomplete');
    expect(wrapper.text()).toContain('Unavailable');
    expect(wrapper.text()).not.toContain('$2,250.00');
  });
  it('shows all salary presets directly, including MAX, and keeps custom ranges available', () => {
    const wrapper = mount(DateRange, {
      props: { modelValue: { preset: 'all', from: '2024-01-01', through: '2026-11-19' }, earliest: '2024-01-01' },
    });
    const labels = wrapper.findAll('button').map((button) => button.text());
    for (const preset of ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', 'MAX']) expect(labels).toContain(preset);
    expect(wrapper.find('[aria-label="Custom payroll date range"]').exists()).toBe(true);
  });
  it('edits a private clone and closes payroll settings after a successful save', async () => {
    const original = reactive(data());
    const Slot = { template: '<div><slot /></div>' };
    const wrapper = mount(PayrollManagement, {
      props: { data: original, modelValue: 'settings' },
      global: {
        stubs: {
          Dialog: Slot,
          DialogScrollContent: Slot,
          DialogHeader: Slot,
          DialogTitle: Slot,
          DialogDescription: Slot,
        },
      },
    });
    await wrapper.get('input[type="number"]').setValue(45);
    expect(original.status.settings.reminderDays).toBe(30);
    await wrapper.get('form').trigger('submit');
    await nextTick();
    await nextTick();
    await nextTick();
    expect(calls.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3, settings: expect.objectContaining({ reminderDays: 45 }) }),
    );
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null]);
  });
});
