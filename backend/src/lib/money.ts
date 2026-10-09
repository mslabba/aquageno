import { Prisma } from '@prisma/client';

export function d(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function qty(value: Prisma.Decimal.Value): string {
  return d(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
}

export function money(value: Prisma.Decimal.Value): string {
  return d(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

export function lineTotal(quantity: string, unitPrice: string): string {
  return money(d(quantity).mul(d(unitPrice)));
}

export function sumMoney(values: string[]): string {
  return money(values.reduce((sum, value) => sum.plus(d(value)), d(0)));
}

export function sumQty(values: string[]): string {
  return qty(values.reduce((sum, value) => sum.plus(d(value)), d(0)));
}

export const ZERO_QTY = '0.000';
export const ZERO_MONEY = '0.00';
