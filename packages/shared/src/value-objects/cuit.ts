import { ValidationError } from '../errors/domain-error.js';

/**
 * CUIT — Clave Única de Identificación Tributaria (Argentina).
 *
 * Formato: XX-XXXXXXXX-X (11 dígitos).
 * Los primeros 2 dígitos indican el tipo:
 *   - 20, 23, 24, 27 → personas físicas (DNI prefijado)
 *   - 30, 33, 34     → personas jurídicas
 *   - 50, 51, 55     → otras
 *
 * El último dígito es verificador, calculado por algoritmo módulo 11.
 *
 * Este VO valida formato + dígito verificador. Si necesitás verificar
 * que el CUIT realmente existe en ARCA, eso lo hace PadronService.
 */
export class Cuit {
  private static readonly MULTIPLIERS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

  private static readonly VALID_PREFIXES = new Set([
    '20', '23', '24', '25', '26', '27',
    '30', '33', '34',
    '50', '51', '55',
  ]);

  public readonly value: string; // formato canonicalizado: 11 dígitos sin guiones

  private constructor(value: string) {
    this.value = value;
  }

  static of(input: string): Cuit {
    if (typeof input !== 'string') {
      throw new ValidationError('CUIT must be a string', { input });
    }

    // Aceptar con o sin guiones, pero canonicalizar a sin guiones
    const cleaned = input.replace(/[-\s]/g, '');

    if (!/^\d{11}$/.test(cleaned)) {
      throw new ValidationError(
        `CUIT must be 11 digits, got: ${input}`,
        { input },
      );
    }

    const prefix = cleaned.substring(0, 2);
    if (!Cuit.VALID_PREFIXES.has(prefix)) {
      throw new ValidationError(
        `Invalid CUIT prefix: ${prefix}`,
        { input, prefix },
      );
    }

    if (!Cuit.isCheckDigitValid(cleaned)) {
      throw new ValidationError(
        `Invalid CUIT check digit: ${input}`,
        { input },
      );
    }

    return new Cuit(cleaned);
  }

  /**
   * Construye un CUIT sin validar dígito verificador.
   * Usar SOLO al hidratar desde la base de datos donde ya sabemos
   * que es válido. Nunca desde input del usuario.
   */
  static unsafeFromDb(value: string): Cuit {
    return new Cuit(value);
  }

  /**
   * Algoritmo de validación módulo 11 oficial de ARCA.
   * Calcula el dígito verificador y lo compara con el último dígito.
   */
  private static isCheckDigitValid(cuit: string): boolean {
    const digits = cuit.split('').map(Number);
    const providedCheckDigit = digits[10];
    if (providedCheckDigit === undefined) return false;

    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const digit = digits[i];
      const multiplier = Cuit.MULTIPLIERS[i];
      if (digit === undefined || multiplier === undefined) return false;
      sum += digit * multiplier;
    }

    const remainder = sum % 11;
    let checkDigit: number;
    if (remainder === 0) checkDigit = 0;
    else if (remainder === 1) checkDigit = 9; // caso especial ARCA
    else checkDigit = 11 - remainder;

    return checkDigit === providedCheckDigit;
  }

  // ---- Métodos públicos ----

  /**
   * Devuelve el CUIT formateado con guiones: XX-XXXXXXXX-X
   */
  format(): string {
    return `${this.value.substring(0, 2)}-${this.value.substring(2, 10)}-${this.value.substring(10)}`;
  }

  /**
   * Indica si es persona jurídica (prefijo 30/33/34).
   */
  isLegalEntity(): boolean {
    const prefix = this.value.substring(0, 2);
    return prefix === '30' || prefix === '33' || prefix === '34';
  }

  isNaturalPerson(): boolean {
    const prefix = this.value.substring(0, 2);
    return ['20', '23', '24', '25', '26', '27'].includes(prefix);
  }

  equals(other: Cuit): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
