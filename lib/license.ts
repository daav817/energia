/**
 * License utilities for CRNGS/CRES tracking.
 * Expiration is automatically set to 2 years from issue date per regulatory requirements.
 */

/**
 * Calculates expiration date exactly 2 years from the issue date.
 */
export function calculateLicenseExpiration(issueDate: Date): Date {
  const expiration = new Date(issueDate);
  expiration.setFullYear(expiration.getFullYear() + 2);
  return expiration;
}
