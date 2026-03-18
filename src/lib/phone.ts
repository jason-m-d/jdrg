/**
 * Normalize a phone number to +1XXXXXXXXXX format.
 * - Strips all non-digit characters
 * - 10 digits → prepend +1
 * - 11 digits starting with 1 → prepend +
 * - Anything else (international, email handle) → returned as-is trimmed
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.trim()
}
