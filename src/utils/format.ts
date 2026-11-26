export interface FormatEUROptions {
  showSign?: boolean;
  decimals?: number;
}

/**
 * Formats numeric amounts using Spanish locale grouping and comma decimals (e.g. "1.250,00 €").
 */
export function formatEUR(amount: number, options: FormatEUROptions = {}): string {
  const { showSign = false, decimals = 2 } = options;
  const safeValue = Number.isFinite(amount) ? amount : 0;
  const absValue = Math.abs(safeValue);

  let formattedNumber: string;
  try {
    formattedNumber = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(absValue);
  } catch {
    formattedNumber = absValue.toFixed(decimals).replace('.', ',');
  }

  let prefix = '';
  if (safeValue < 0) {
    prefix = '-';
  } else if (showSign && safeValue > 0) {
    prefix = '+';
  }

  return `${prefix}${formattedNumber} €`;
}
