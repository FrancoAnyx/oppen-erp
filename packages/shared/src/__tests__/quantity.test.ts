import { describe, it, expect } from 'vitest';
import { Quantity } from '../value-objects/quantity.js';
import { ValidationError } from '../errors/domain-error.js';

describe('Quantity', () => {
  it('creates from number', () => {
    expect(Quantity.of(5).toString()).toBe('5');
  });

  it('creates with decimals up to 4 places', () => {
    expect(Quantity.of('1.2345').toString()).toBe('1.2345');
  });

  it('rejects more than 4 decimals', () => {
    expect(() => Quantity.of('1.23456')).toThrow(ValidationError);
  });

  it('rejects negative', () => {
    expect(() => Quantity.of(-1)).toThrow(ValidationError);
  });

  it('rejects NaN', () => {
    expect(() => Quantity.of('abc')).toThrow(ValidationError);
  });

  it('add', () => {
    expect(Quantity.of(2).add(Quantity.of(3)).toString()).toBe('5');
  });

  it('subtract throws on negative result', () => {
    expect(() => Quantity.of(2).subtract(Quantity.of(3))).toThrow(ValidationError);
  });

  it('greaterThanOrEqual', () => {
    expect(Quantity.of(5).greaterThanOrEqual(Quantity.of(5))).toBe(true);
    expect(Quantity.of(5).greaterThanOrEqual(Quantity.of(6))).toBe(false);
  });

  it('isZero', () => {
    expect(Quantity.zero().isZero()).toBe(true);
    expect(Quantity.of(1).isZero()).toBe(false);
  });
});
