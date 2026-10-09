import { Prisma } from '@prisma/client';
import { d, qty } from './money';

export type PackingRule = {
  slabWeightKg: Prisma.Decimal;
  slabsPerCase: number;
  tareWeightKg: Prisma.Decimal;
};

/**
 * Split a slab total into whole cases + loose slabs.
 * The remainder is NEVER rounded into a case — it stays as loose slabs.
 * Example: 415 slabs, 6 per case -> 69 cases + 1 loose slab.
 */
export function splitSlabs(totalSlabs: Prisma.Decimal.Value, slabsPerCase: number) {
  const total = d(totalSlabs);
  if (total.isNegative()) throw new Error('Slab quantity cannot be negative.');
  if (!Number.isInteger(slabsPerCase) || slabsPerCase <= 0) {
    throw new Error('Slabs per case must be a positive whole number.');
  }
  const cases = total.div(slabsPerCase).floor();
  const looseSlabs = total.minus(cases.mul(slabsPerCase));
  return { cases: cases.toNumber(), looseSlabs: qty(looseSlabs) };
}

/** Convert a case-based entry (cases + loose slabs) back to total slabs. */
export function slabsFromCases(
  cases: Prisma.Decimal.Value,
  looseSlabs: Prisma.Decimal.Value,
  slabsPerCase: number,
) {
  const total = d(cases).mul(slabsPerCase).plus(d(looseSlabs));
  if (total.lessThanOrEqualTo(0)) throw new Error('Case/slab quantity must be greater than zero.');
  return qty(total);
}

/** Net product weight in kg for a slab total. */
export function netWeightKg(totalSlabs: Prisma.Decimal.Value, slabWeightKg: Prisma.Decimal.Value) {
  return qty(d(totalSlabs).mul(d(slabWeightKg)));
}

/** Gross packed weight: net + tare (box/carton) weight per whole case. */
export function grossWeightKg(
  netKg: Prisma.Decimal.Value,
  cases: number,
  tareWeightKg: Prisma.Decimal.Value,
) {
  return qty(d(netKg).plus(d(cases).mul(d(tareWeightKg))));
}
