import { describe, it, expect } from 'vitest';
import { BusinessRuleError, ValidationError } from '@erp/shared';
import { Entity } from './entity';

describe('Entity aggregate', () => {
  const validInput = {
    tenantId: 'tenant-1',
    roles: ['CUSTOMER' as const],
    legalName: 'Test S.A.',
    taxId: '30-50001091-2',
    ivaCondition: 'RI' as const,
  };

  describe('create', () => {
    it('creates a valid entity', () => {
      const e = Entity.create(validInput);
      expect(e.legalName).toBe('Test S.A.');
      expect(e.taxId).toBe('30500010912'); // canonicalizado
      expect(e.isCustomer()).toBe(true);
      expect(e.isSupplier()).toBe(false);
      expect(e.isActive).toBe(true);
      expect(e.version).toBe(1);
    });

    it('canonicalizes CUIT (removes dashes)', () => {
      const e = Entity.create({ ...validInput, taxId: '30-50001091-2' });
      expect(e.taxId).toBe('30500010912');
      expect(e.cuit.format()).toBe('30-50001091-2');
    });

    it('trims legalName', () => {
      const e = Entity.create({ ...validInput, legalName: '  Acme  ' });
      expect(e.legalName).toBe('Acme');
    });

    it('lowercases email', () => {
      const e = Entity.create({ ...validInput, email: 'FOO@BAR.COM' });
      expect(e.email).toBe('foo@bar.com');
    });

    it('rejects invalid CUIT', () => {
      expect(() =>
        Entity.create({ ...validInput, taxId: '30-50001091-9' }),
      ).toThrow(ValidationError);
    });

    it('rejects empty roles', () => {
      expect(() => Entity.create({ ...validInput, roles: [] })).toThrow(BusinessRuleError);
    });

    it('rejects empty legalName', () => {
      expect(() => Entity.create({ ...validInput, legalName: '  ' })).toThrow(ValidationError);
    });

    it('rejects negative credit limit', () => {
      expect(() =>
        Entity.create({ ...validInput, creditLimit: '-100' }),
      ).toThrow(ValidationError);
    });

    it('accepts multi-role (customer + supplier)', () => {
      const e = Entity.create({ ...validInput, roles: ['CUSTOMER', 'SUPPLIER'] });
      expect(e.isCustomer()).toBe(true);
      expect(e.isSupplier()).toBe(true);
    });
  });

  describe('deactivate/reactivate', () => {
    it('deactivates an active entity', () => {
      const e = Entity.create(validInput);
      e.deactivate();
      expect(e.isActive).toBe(false);
    });

    it('throws when deactivating already inactive', () => {
      const e = Entity.create(validInput);
      e.deactivate();
      expect(() => e.deactivate()).toThrow(BusinessRuleError);
    });

    it('reactivates', () => {
      const e = Entity.create(validInput);
      e.deactivate();
      e.reactivate();
      expect(e.isActive).toBe(true);
    });
  });

  describe('updateContactInfo', () => {
    it('updates email lowercased and trimmed', () => {
      const e = Entity.create(validInput);
      e.updateContactInfo({ email: '  NEW@MAIL.COM  ' });
      expect(e.email).toBe('new@mail.com');
    });
  });
});

