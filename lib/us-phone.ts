/** US 10-digit phone as ###-###-#### (area code – exchange – line). */

const NON_DIGIT = /\D/g;

/** Strip to digits; drop leading US country code 1 when present (11-digit NANP). */
export function extractUsPhoneDigits(input: string): string {
  let d = input.replace(NON_DIGIT, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Format digit string with hyphens while typing / after paste. */
export function formatUsPhoneDigits(input: string): string {
  const d = extractUsPhoneDigits(input);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isCompleteUsPhone(formatted: string): boolean {
  return /^\d{3}-\d{3}-\d{4}$/.test(formatted.trim());
}

/** Non-empty value that is not exactly ###-###-####. */
export function usPhoneNeedsAttention(formatted: string): boolean {
  const t = formatted.trim();
  if (t === "") return false;
  return !isCompleteUsPhone(formatted);
}
