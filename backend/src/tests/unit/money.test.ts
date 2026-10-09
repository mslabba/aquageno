import { describe, expect, it } from 'vitest';
import { lineTotal, sumMoney } from '../../lib/money';
import { hasPerm } from '../../lib/permissions';

describe('multi-line totals', () => {
  it('rounds each line half up to paise before summing', () => {
    expect(lineTotal('0.335', '1.00')).toBe('0.34');
    expect(lineTotal('3.333', '10.10')).toBe('33.66');
    expect(lineTotal('1.125', '10.00')).toBe('11.25');
    expect(sumMoney([lineTotal('0.335', '1.00'), lineTotal('0.335', '1.00')])).toBe('0.68');
  });

  it('keeps a 3-decimal quantity times a 2-decimal price', () => {
    expect(lineTotal('10.500', '415.00')).toBe('4357.50');
    expect(sumMoney(['4357.50', '2500.00', '100.25'])).toBe('6957.75');
  });
});

describe('permission checks', () => {
  it('matches module and action exactly', () => {
    const grants = new Set(['PURCHASES:VIEW', 'STOCK:APPROVE']);
    expect(hasPerm(grants, 'PURCHASES', 'VIEW')).toBe(true);
    expect(hasPerm(grants, 'PURCHASES', 'CREATE')).toBe(false);
    expect(hasPerm(grants, 'STOCK', 'APPROVE')).toBe(true);
    expect(hasPerm(grants, 'APPROVALS', 'APPROVE')).toBe(false);
  });
});
