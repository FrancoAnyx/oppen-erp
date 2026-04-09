import { Decimal } from 'decimal.js';
import { ValidationError } from '../errors/index.js';

type CurrencyCode = 'ARS' | 'USD' | 'EUR';

Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9,
  toExpPos: 20,
});

export class Money {
  private readonly amount: Decimal;
  private readonly currency: CurrencyCode;

  private constructor(amount: Decimal, currency: CurrencyCode) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(amount: string | number | Decimal, currency: CurrencyCode): Money {
    let decimal: Decimal;
    try {
      decimal = new Decimal(amount as string | number);
    } catch {
      throw new ValidationError(`Monto inválido: ${amount}`);
    }
    return new Money(decimal, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(new Decimal(0), currency);
  }

  static ARS(amount: string | number): Money { return Money.of(amount, 'ARS'); }
  static USD(amount: string | number): Money { return Money.of(amount, 'USD'); }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  multiply(factor: string | number | Decimal): Money {
    return new Money(this.amount.times(factor as string | number), this.currency);
  }

  divide(divisor: string | number | Decimal): Money {
    const d = new Decimal(divisor as string | number);
    if (d.isZero()) throw new ValidationError('División por cero');
    return new Money(this.amount.dividedBy(d), this.currency);
  }

  percentage(pct: string | number | Decimal): Money {
    return this.multiply(new Decimal(pct as string | number).dividedBy(100));
  }

  isZero(): boolean     { return this.amount.isZero(); }
  isPositive(): boolean { return this.amount.isPositive() && !this.amount.isZero(); }
  isNegative(): boolean { return this.amount.isNegative(); }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.greaterThan(other.amount);
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lessThan(other.amount);
  }

  round(decimals = 2): Money {
    return new Money(
      this.amount.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN),
      this.currency,
    );
  }

  toNumber(): number  { return this.amount.toNumber(); }
  toString(): string  { return `${this.currency} ${this.amount.toFixed(2)}`; }
  getCurrency(): CurrencyCode { return this.currency; }
  getAmount(): Decimal { return this.amount; }

  toJSON() {
    return { amount: this.amount.toFixed(2), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ValidationError(
        `Monedas incompatibles: ${this.currency} vs ${other.currency}`,
      );
    }
  }
}
