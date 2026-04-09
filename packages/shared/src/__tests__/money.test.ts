import { describe, it, expect } from 'vitest';
import { Money } from '../value-objects/money.js';
import { ValidationError } from '../errors/domain-error.js';

describe('Money', () => {
  describe('construction', () => {
    it('creates from string', () => {
      const m = Money.of('100.50', 'ARS');
      expect(m.toString()).toBe('100.50');
      expect(m.currency).toBe('ARS');
    });

    it('creates from number', () => {
      expect(Money.of(100, 'USD').toString()).toBe('100.00');
    });

    it('creates zero', () => {
      const z = Money.zero('ARS');
      expect(z.isZero()).toBe(true);
      expect(z.toString()).toBe('0.00');
    });

    it('rejects invalid currency', () => {
      // @ts-expect-error - testing runtime validation
      expect(() => Money.of(100, 'XYZ')).toThrow(ValidationError);
    });

    it('rejects NaN', () => {
      expect(() => Money.of('not a number', 'ARS')).toThrow(ValidationError);
    });

    it('rejects Infinity', () => {
      expect(() => Money.of(Infinity, 'ARS')).toThrow(ValidationError);
    });
  });

  describe('arithmetic — precision matters', () => {
    it('0.1 + 0.2 === 0.30 (NOT 0.30000000000000004)', () => {
      const a = Money.of('0.10', 'ARS');
      const b = Money.of('0.20', 'ARS');
      expect(a.add(b).toString()).toBe('0.30');
    });

    it('handles long decimal chains without drift', () => {
      let total = Money.zero('ARS');
      for (let i = 0; i < 1000; i++) {
        total = total.add(Money.of('0.01', 'ARS'));
      }
      expect(total.toString()).toBe('10.00');
    });

    it('multiplies by IVA percentage correctly', () => {
      const subtotal = Money.of('1000', 'ARS');
      const iva = subtotal.percentage(21);
      expect(iva.toString()).toBe('210.00');
    });

    it('rounds half-even (banker rounding)', () => {
      // 0.125 → 0.12 (round to even)
      // 0.135 → 0.14 (round to even)
      expect(Money.of('0.125', 'ARS').round(2).toString()).toBe('0.12');
      expect(Money.of('0.135', 'ARS').round(2).toString()).toBe('0.14');
    });
  });

  describe('currency safety', () => {
    it('throws on adding different currencies', () => {
      const ars = Money.of(100, 'ARS');
      const usd = Money.of(100, 'USD');
      expect(() => ars.add(usd)).toThrow(ValidationError);
    });

    it('throws on comparing different currencies', () => {
      expect(() => Money.of(100, 'ARS').greaterThan(Money.of(100, 'USD'))).toThrow();
    });
  });

  describe('serialization', () => {
    it('JSON includes both amount and currency', () => {
      const m = Money.of('1234.56', 'ARS');
      expect(JSON.parse(JSON.stringify(m))).toEqual({
        amount: '1234.56',
        currency: 'ARS',
      });
    });
  });
});
