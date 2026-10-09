import { env } from './env';

export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.businessTz }).format(now);
}

export function parseDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
