/**
 * Formats a Date as YYYY-MM-DD in the device's local timezone (avoids UTC day/month shifts).
 */
export function getLocalISODate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date as YYYY-MM in the device's local timezone.
 */
export function getLocalYearMonth(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Validates strict YYYY-MM-DD syntax and ensures it represents a real calendar date.
 */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const candidate = new Date(y, m - 1, d);
  return (
    candidate.getFullYear() === y &&
    candidate.getMonth() === m - 1 &&
    candidate.getDate() === d
  );
}
