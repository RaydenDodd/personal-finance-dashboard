/** Bank transfers between own accounts typically settle within 1-2 business days. */
export const TRANSFER_DATE_WINDOW_DAYS = 3;
/** Equal amounts are not evidence that an ordinary merchant purchase is an own-account transfer. */
export function hasExplicitTransferDescription(note: string | null | undefined): boolean {
  return /^(?:deposit from (?:safe )?checking|withdrawal (?:to|from) (?:safe checking|checking|car fund|travel fund|emergency fund|m1|robinhood)|online transfer\b|(?:mobile |autopay |automatic |internet )?payment(?:\s*-)?\s*thank|amex epayment\b|(?:m1|robinhood|public)(?:\s+(?:payments|funds|financial|securities))?$|discover cap one$|wf credit card$|wells fargo (?:card|ifi)$|u\.?s\.? bank$|transfer (?:to|from)\b)/i.test(
    (note ?? '').trim(),
  );
}

export function normalizeIban({ iban }: { iban: string }): string {
  return iban.replace(/\s/g, '').toUpperCase();
}
