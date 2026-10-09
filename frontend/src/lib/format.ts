import Decimal from 'decimal.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value?: string | null) {
  if (!value) return '';
  const day = value.slice(0, 10);
  const [year, month, date] = day.split('-');
  const index = Number(month) - 1;
  if (!year || !month || !date || index < 0 || index > 11) return day;
  return `${date} ${MONTHS[index]} ${year}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatQty(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '0.000';
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.000';
  return number.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function formatInr(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '₹0.00';
  const number = Number(value);
  if (!Number.isFinite(number)) return '₹0.00';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

export function lineTotal(quantity: string, unitPrice: string) {
  try {
    if (!quantity || !unitPrice) return '0.00';
    return new Decimal(quantity).mul(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  } catch {
    return '0.00';
  }
}

export function sumMoney(values: string[]) {
  return values
    .reduce((sum, value) => sum.plus(value || 0), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export function scaleQty(perUnit: string, quantity: string) {
  return new Decimal(perUnit || 0).mul(quantity || 0).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function todayInput() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  REJECTED: 'Rejected',
  POSTED: 'Posted',
  REVERSED: 'Reversed',
};

export function statusTone(status: string) {
  if (status === 'POSTED') return 'ok';
  if (status === 'PENDING_APPROVAL') return 'warn';
  if (status === 'REJECTED') return 'danger';
  if (status === 'REVERSED') return 'info';
  return 'neutral';
}

export function itemTypeLabel(value: string) {
  if (value === 'RAW_MATERIAL') return 'Raw material';
  if (value === 'PACKING_MATERIAL') return 'Packing material';
  if (value === 'FINISHED_GOOD') return 'Finished good';
  return value;
}

export function reasonLabel(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}
