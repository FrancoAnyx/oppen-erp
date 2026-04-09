import { Decimal } from 'decimal.js';
import { ValidationError } from '../errors/index.js';

export class Quantity {
  private readonly value: Decimal;

  private constructor(value: Decimal) {
    if (value.isNegative()) {
      throw new ValidationError(`Cantidad no puede ser negativa: ${value.toString()}`);
    }
    this.value = value;
  }

  static of(input: string | number | Decimal): Quantity {
    let decimal: Decimal;
    try {
      decimal = new Decimal(input as string | number);
    } catch {
      throw new ValidationError(`Cantidad inválida: ${input}`);
    }
    return new Quantity(decimal);
  }

  static zero(): Quantity { return new Quantity(new Decimal(0)); }

  add(other: Quantity): Quantity {
    return new Quantity(this.value.plus(other.value));
  }

  subtract(other: Quantity): Quantity {
    const result = this.value.minus(other.value);
    if (result.isNegative()) {
      throw new ValidationError(
        `Resta daría negativo: ${this.value} - ${other.value}`,
      );
    }
    return new Quantity(result);
  }

  isZero(): boolean         { return this.value.isZero(); }
  isPositive(): boolean     { return this.value.isPositive() && !this.value.isZero(); }
  greaterThan(other: Quantity): boolean { return this.value.greaterThan(other.value); }
  lessThan(other: Quantity): boolean    { return this.value.lessThan(other.value); }
  equals(other: Quantity): boolean      { return this.value.equals(other.value); }

  greaterThanOrEqual(other: Quantity): boolean {
    return this.value.greaterThanOrEqualTo(other.value);
  }

  toNumber(): number  { return this.value.toNumber(); }
  toString(): string  { return this.value.toFixed(4); }
  getValue(): Decimal { return this.value; }

  toJSON() { return { value: this.value.toFixed(4) }; }
}
