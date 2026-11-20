import { z } from 'zod';

import { incomeDate } from './schema';

const amount = z.number().finite().min(0).max(1e9);
const nullableDate = incomeDate.nullable();
export const payrollEmploymentSchema = z
  .object({
    id: z.string().uuid(),
    employerName: z.string().trim().min(1).max(200),
    jobTitle: z.string().trim().max(200),
    startDate: nullableDate,
    endDate: nullableDate,
    positionStartDate: nullableDate,
    positionEndDate: nullableDate,
    status: z.enum(['current', 'previous']),
    source: z.string().trim().min(1).max(100),
    payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual']),
    compensationType: z.enum(['salary', 'hourly']),
    annualHours: z.number().finite().gt(0).max(8784).nullable(),
    manualAnnualSalary: amount.nullable(),
    notes: z.string().max(3000),
  })
  .refine((e) => !e.startDate || !e.endDate || e.startDate <= e.endDate, 'Employment dates are reversed')
  .refine(
    (e) => !e.positionStartDate || !e.positionEndDate || e.positionStartDate <= e.positionEndDate,
    'Position dates are reversed',
  );
export const payrollSalaryEventSchema = z.object({
  id: z.string().min(1).max(250),
  employmentId: z.string().uuid(),
  date: incomeDate,
  effectiveDate: nullableDate,
  firstObservedDate: incomeDate,
  periodStart: nullableDate,
  employerName: z.string().max(200),
  jobTitle: z.string().max(200),
  salary: amount,
  previousSalary: amount.nullable(),
  change: z.number().finite().nullable(),
  changePercent: z.number().finite().nullable(),
  regularRate: amount.nullable(),
  source: z.enum(['payroll', 'manual']),
  kind: z.enum(['starting', 'raise', 'decrease', 'promotion', 'employment', 'correction']),
  notes: z.string().max(3000),
  confirmed: z.boolean(),
});
export const payrollSettingsSchema = z.object({
  reminderDays: z.number().int().min(1).max(366),
  snoozedUntil: z.iso.datetime().nullable(),
  reminderDismissed: z.boolean(),
});
export const payrollManagementSchema = z.object({
  revision: z.number().int().min(0),
  employments: z.array(payrollEmploymentSchema).max(200),
  manualSalaryEvents: z.array(payrollSalaryEventSchema).max(2000),
  settings: payrollSettingsSchema,
});
export const payrollQuerySchema = z
  .object({
    from: incomeDate.optional(),
    through: incomeDate.optional(),
    employmentId: z.string().uuid().optional(),
    aggregation: z.enum(['paycheck', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  })
  .refine((q) => !q.from || !q.through || q.from <= q.through, 'Start date must precede end date');
export const payrollImportSchema = z.object({
  employmentId: z.string().uuid(),
  source: z.literal('adp').default('adp'),
  content: z.string().min(2).max(8_000_000),
  revision: z.number().int().min(0),
  previewOnly: z.boolean().default(true),
});
