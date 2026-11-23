/**
 * Opaque client-generated id (32 hex chars). crypto.randomUUID needs a secure context,
 * which a self-hosted app opened over plain http lacks; getRandomValues does not.
 */
export const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** UUID v4 also works on the private HTTP origin, where randomUUID is unavailable. */
export const randomUuid = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
