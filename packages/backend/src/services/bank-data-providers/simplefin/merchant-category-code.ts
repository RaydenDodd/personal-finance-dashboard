/** Preserve leading zeroes. Missing/invalid provider data is never inferred. */
export function normalizeMerchantCategoryCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9999) {
    return String(value).padStart(4, '0');
  }
  if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) return value.trim();
  return null;
}
