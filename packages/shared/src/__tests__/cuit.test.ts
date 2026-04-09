import { describe, it, expect } from 'vitest';
import { Cuit } from '../value-objects/cuit.js';
import { ValidationError } from '../errors/domain-error.js';

describe('Cuit', () => {
  // CUITs reales válidos para testing (públicos):
  //   30-50001091-2 → AFIP/ARCA
  //   30-71659554-1 → ejemplo persona jurídica con DV calculado a mano
  //   20-12345678-? → calcular abajo

  describe('validation', () => {
    it('accepts valid legal entity CUIT', () => {
      const c = Cuit.of('30-50001091-2'); // ARCA real
      expect(c.value).toBe('30500010912');
      expect(c.isLegalEntity()).toBe(true);
      expect(c.isNaturalPerson()).toBe(false);
    });

    it('accepts CUIT without dashes', () => {
      const c = Cuit.of('30500010912');
      expect(c.format()).toBe('30-50001091-2');
    });

    it('rejects invalid check digit', () => {
      expect(() => Cuit.of('30-50001091-9')).toThrow(ValidationError);
    });

    it('rejects wrong length', () => {
      expect(() => Cuit.of('305000109')).toThrow(ValidationError);
      expect(() => Cuit.of('305000109123')).toThrow(ValidationError);
    });

    it('rejects non-numeric input', () => {
      expect(() => Cuit.of('30-ABCDEFGH-2')).toThrow(ValidationError);
    });

    it('rejects invalid prefix', () => {
      expect(() => Cuit.of('99-50001091-2')).toThrow(ValidationError);
    });

    it('rejects empty string', () => {
      expect(() => Cuit.of('')).toThrow(ValidationError);
    });
  });

  describe('formatting', () => {
    it('format returns XX-XXXXXXXX-X', () => {
      const c = Cuit.of('30500010912');
      expect(c.format()).toBe('30-50001091-2');
    });

    it('toString returns canonical 11 digits', () => {
      const c = Cuit.of('30-50001091-2');
      expect(c.toString()).toBe('30500010912');
    });
  });

  describe('equality', () => {
    it('two CUITs with same value are equal', () => {
      expect(Cuit.of('30500010912').equals(Cuit.of('30-50001091-2'))).toBe(true);
    });
  });
});
