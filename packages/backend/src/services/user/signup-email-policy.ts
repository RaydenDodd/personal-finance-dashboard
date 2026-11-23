/** Optional invitation allowlist, applied only when creating a new identity. */
export function signupEmailAllowed(email: string, configured = process.env.FINANCE_SIGNUP_ALLOWED_EMAILS): boolean {
  const allowed = (configured ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return !allowed.length || allowed.includes(email.trim().toLowerCase());
}
