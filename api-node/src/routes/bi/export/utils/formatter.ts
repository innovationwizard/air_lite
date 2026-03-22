export function formatDateSpanish(date: Date): string {
  const months = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
  ];
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

export function formatCurrency(amount: number): string {
  if (!amount || isNaN(amount)) return 'Q 0';
  
  return new Intl.NumberFormat('es-GT', {
    style: 'currency',
    currency: 'GTQ',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount).replace('GTQ', 'Q');
}

export function formatNumber(num: number): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  // Use period as decimal, comma as thousands
  return new Intl.NumberFormat('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

export function formatPercentage(value: number): string {
  if (value === null || value === undefined || isNaN(value)) return '0.0%';
  return `${formatNumber(value)}%`;
}

export interface CompareMode {
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}

export function formatFileName(
  role: string,
  dateRange: { start: string; end: string },
  compareMode: CompareMode | undefined,
  extension: string
): string {
  const startFormatted = formatDateSpanish(new Date(dateRange.start));
  const endFormatted = formatDateSpanish(new Date(dateRange.end));
  
  return `${role}_${startFormatted}_a_${endFormatted}.${extension}`;
}