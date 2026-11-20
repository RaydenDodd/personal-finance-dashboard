import { SUPPORTED_LOCALES } from '@bt/shared/i18n/locales';
import { describe, expect, it } from '@jest/globals';

import { mergeIntoStoredSettings } from '../services/user-settings/service-owned-slices';
import { ZodSettingsPatchSchema, ZodSettingsSchema } from './user-settings.model';

describe('page layout settings', () => {
  it('keeps reversible portfolio visibility separate from layouts and accepts restoring all', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const stored = ZodSettingsSchema.parse({
      ui: { hiddenPortfolioIds: [id], pageLayouts: { income: { widgets: [] } } },
    });
    const incoming = ZodSettingsPatchSchema.parse({ ui: { hiddenPortfolioIds: [] } });
    const merged = ZodSettingsSchema.parse(mergeIntoStoredSettings({ stored, incoming }));
    expect(merged.ui?.hiddenPortfolioIds).toEqual([]);
    expect(merged.ui?.pageLayouts).toEqual(stored.ui?.pageLayouts);
    expect(ZodSettingsPatchSchema.safeParse({ ui: { hiddenPortfolioIds: ['invalid'] } }).success).toBe(false);
  });
  it('accepts independent income and personal layouts using the existing widget schema', () => {
    const settings = ZodSettingsSchema.parse({
      ui: {
        pageLayouts: {
          income: { widgets: [{ widgetId: 'allocation', colSpan: 3 }] },
          personalFinance: { widgets: [{ widgetId: 'history', colSpan: 2 }] },
        },
      },
    });
    expect(settings.ui?.pageLayouts?.income?.widgets?.[0]?.widgetId).toBe('allocation');
    expect(settings.ui?.pageLayouts?.personalFinance?.widgets?.[0]?.colSpan).toBe(2);
  });
  it('patches one page without replacing other layouts or unrelated presentation settings', () => {
    const stored = ZodSettingsSchema.parse({
      dashboard: { widgets: [{ widgetId: 'balance-trend', colSpan: 2 }] },
      ui: {
        transactionsTable: { visibleColumns: ['date'], columnOrder: ['date'] },
        pageLayouts: { income: { widgets: [{ widgetId: 'summary', colSpan: 3 }] } },
      },
    });
    const patch = ZodSettingsPatchSchema.parse({
      ui: { pageLayouts: { personalFinance: { widgets: [{ widgetId: 'history', colSpan: 3 }] } } },
    });
    const merged = ZodSettingsSchema.parse(mergeIntoStoredSettings({ stored, incoming: patch }));
    expect(merged.dashboard).toEqual(stored.dashboard);
    expect(merged.ui?.transactionsTable).toEqual(stored.ui?.transactionsTable);
    expect(merged.ui?.pageLayouts?.income).toEqual(stored.ui?.pageLayouts?.income);
    expect(merged.ui?.pageLayouts?.personalFinance?.widgets?.[0]?.widgetId).toBe('history');
    expect(ZodSettingsPatchSchema.parse({ ui: {} }).ui).toEqual({});
  });
  it('rejects invalid block sizes before they can reach the stored preferences', () => {
    expect(
      ZodSettingsPatchSchema.safeParse({
        ui: { pageLayouts: { income: { widgets: [{ widgetId: 'allocation', colSpan: 9 }] } } },
      }).success,
    ).toBe(false);
  });
});

describe('ZodSettingsSchema – locale field', () => {
  it('accepts English locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: SUPPORTED_LOCALES.ENGLISH });
    expect(result.success).toBe(true);
  });

  it('accepts Ukrainian locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: SUPPORTED_LOCALES.UKRAINIAN });
    expect(result.success).toBe(true);
  });

  it.each(Object.values(SUPPORTED_LOCALES))('accepts every supported locale (%s)', (locale) => {
    const result = ZodSettingsSchema.safeParse({ locale });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(locale);
  });

  it('rejects an unsupported locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: 'xx' });
    expect(result.success).toBe(false);
  });

  it('defaults to English when locale is omitted', () => {
    const result = ZodSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(SUPPORTED_LOCALES.ENGLISH);
  });
});

describe('ZodSettingsPatchSchema – locale field', () => {
  it('accepts English locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: SUPPORTED_LOCALES.ENGLISH });
    expect(result.success).toBe(true);
  });

  it('accepts Ukrainian locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: SUPPORTED_LOCALES.UKRAINIAN });
    expect(result.success).toBe(true);
  });

  it.each(Object.values(SUPPORTED_LOCALES))('accepts every supported locale (%s)', (locale) => {
    const result = ZodSettingsPatchSchema.safeParse({ locale });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(locale);
  });

  it('rejects an unsupported locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: 'xx' });
    expect(result.success).toBe(false);
  });

  it('omits locale when not provided (patch schema has no default)', () => {
    const result = ZodSettingsPatchSchema.safeParse({});
    expect(result.success).toBe(true);
    // Patch schema intentionally has no default – absent locale stays undefined
    // so the deep-merge preserves the stored value instead of clobbering it
    if (result.success) expect(result.data.locale).toBeUndefined();
  });
});
