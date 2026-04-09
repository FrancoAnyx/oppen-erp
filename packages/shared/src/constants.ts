/**
 * Constantes globales del dominio.
 *
 * Estas son INVARIANTES — no van en config porque cambiarlas implicaría
 * romper datos existentes.
 */

/**
 * En modo single-tenant, todos los registros pertenecen a este tenant.
 * Cuando migremos a multi-tenant, este valor lo provee un middleware
 * en lugar de ser hardcoded.
 *
 * Es un UUID determinístico para que sea reproducible entre dev/staging/prod.
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Tasas de IVA válidas en Argentina.
 */
export const IVA_RATES = {
  EXEMPT: '0.00',
  REDUCED: '10.50',
  GENERAL: '21.00',
  INCREASED: '27.00',
} as const;

export type IvaRate = (typeof IVA_RATES)[keyof typeof IVA_RATES];

/**
 * Condiciones frente al IVA según ARCA.
 */
export const IVA_CONDITIONS = {
  RESPONSABLE_INSCRIPTO: 'RI',
  MONOTRIBUTO: 'MONOTRIBUTO',
  EXENTO: 'EXENTO',
  CONSUMIDOR_FINAL: 'CF',
  NO_RESPONSABLE: 'NO_RESPONSABLE',
} as const;

export type IvaCondition = (typeof IVA_CONDITIONS)[keyof typeof IVA_CONDITIONS];

/**
 * Códigos de tipo de comprobante de ARCA (los más usados).
 * La lista completa son ~80, los agregamos cuando hagan falta.
 */
export const AFIP_DOC_CODES = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  RECIBO_A: 4,
  RECIBO_B: 9,
  RECIBO_C: 15,
} as const;
