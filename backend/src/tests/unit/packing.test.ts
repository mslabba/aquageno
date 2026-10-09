import { describe, expect, it } from 'vitest';
import { grossWeightKg, netWeightKg, slabsFromCases, splitSlabs } from '../../lib/packing';

describe('slab/case split', () => {
  it('splits 415 slabs at 6 per case into 69 cases + 1 loose slab', () => {
    const split = splitSlabs('415.000', 6);
    expect(split.cases).toBe(69);
    expect(split.looseSlabs).toBe('1.000');
  });

  it('keeps an exact multiple with zero loose slabs', () => {
    const split = splitSlabs('300.000', 10);
    expect(split.cases).toBe(30);
    expect(split.looseSlabs).toBe('0.000');
  });

  it('never rounds the remainder into a case', () => {
    const split = splitSlabs('415.999', 6);
    expect(split.cases).toBe(69);
    expect(split.looseSlabs).toBe('1.999');
  });

  it('rejects invalid slabs-per-case', () => {
    expect(() => splitSlabs('10.000', 0)).toThrow();
    expect(() => splitSlabs('10.000', 2.5)).toThrow();
  });
});

describe('case entry conversion', () => {
  it('converts 20 cases at 10 slabs/case to 200 slabs', () => {
    expect(slabsFromCases('20', '0.000', 10)).toBe('200.000');
  });

  it('adds loose slabs to the case total', () => {
    expect(slabsFromCases('20', '4.000', 10)).toBe('204.000');
  });

  it('rejects a zero total', () => {
    expect(() => slabsFromCases('0', '0.000', 10)).toThrow();
  });
});

describe('weights', () => {
  it('computes net weight from slabs', () => {
    expect(netWeightKg('415.000', '1.600')).toBe('664.000');
  });

  it('adds tare per whole case for gross weight', () => {
    expect(grossWeightKg('664.000', 69, '0.700')).toBe('712.300');
  });
});
