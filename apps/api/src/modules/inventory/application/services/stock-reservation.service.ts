import { Inject, Injectable, Logger } from '@nestjs/common';
import { Quantity, BusinessRuleError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  ILocationRepository,
  LOCATION_REPOSITORY,
} from '../../domain/repositories/inventory.repositories';

/**
 * StockReservationService — previene over-selling garantizando que la lectura
 * del disponible y la creación del stock move sean atómicas.
 *
 * Este es EL servicio más importante del módulo. Si tiene un bug, el negocio
 * vende lo que no tiene.
 *
 * Estrategia:
 *   1. Abrir transacción en nivel SERIALIZABLE (el más estricto de Postgres).
 *   2. Leer el disponible con `get_available()` — Postgres garantiza que en
 *      SERIALIZABLE los conflictos de lectura-escritura se detectan.
 *   3. Validar que alcanza.
 *   4. Insertar el stock move en estado CONFIRMED (que afecta Committed).
 *   5. Commit.
 *
 * Si dos transacciones concurrentes intentan reservar el último ítem:
 *   - Una gana, la otra recibe error Prisma P2034 (code 40001 de Postgres).
 *   - Este servicio ATRAPA el P2034 y reintenta hasta N veces con backoff
 *     jitterizado. Si sigue fallando, propaga la falla al caller.
 *
 * Alternativa que NO usamos (y por qué):
 *   - Lock pesimista con SELECT FOR UPDATE: funciona pero serializa TODAS las
 *     operaciones sobre el mismo producto. Con SERIALIZABLE dejamos que
 *     Postgres detecte solo los conflictos reales.
 *
 * Este método es idempotente a nivel de aplicación pero NO a nivel de DB:
 * llamarlo dos veces con los mismos argumentos crea dos moves distintos.
 * La idempotencia real se maneja con una clave de idempotencia a nivel HTTP
 * (lo vamos a agregar en Sales cuando confirmemos OVs).
 */
@Injectable()
export class StockReservationService {
  private readonly logger = new Logger(StockReservationService.name);
  private readonly MAX_RETRIES = 3;
  private readonly BASE_BACKOFF_MS = 50;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOCATION_REPOSITORY)
    private readonly locationRepo: any,
  ) {}

  /**
   * Reserva de alto nivel para una venta: resuelve automáticamente las
   * locations virtuales (CUSTOMER) y el depósito default si no viene.
   *
   * Este es el método que deberían llamar los otros módulos (Sales, al
   * confirmar una OV). La primitiva `reserve()` queda disponible para casos
   * avanzados donde el caller ya tiene todas las locations resueltas.
   */
  async reserveForCustomer(input: {
    tenantId: string;
    productId: string;
    quantity: Quantity;
    sourceLocationId?: string;
    originDocType: 'SO' | 'TRANSFER';
    originDocId: string;
    originLineId?: string;
    createdById: string;
  }): Promise<{ moveId: string }> {
    // Resolver depósito source: si no viene, usar el primer INTERNAL.
    // Cuando haya multi-warehouse vamos a forzar que venga explícito.
    let sourceLocationId = input.sourceLocationId;
    if (!sourceLocationId) {
      const internal = await this.locationRepo.getDefaultByType(
        input.tenantId,
        'INTERNAL',
      );
      sourceLocationId = internal.id;
    }

    // Destino siempre es la location virtual CUSTOMER del tenant.
    const customerLoc = await this.locationRepo.getDefaultByType(
      input.tenantId,
      'CUSTOMER',
    );

    return this.reserve({
      tenantId: input.tenantId,
      productId: input.productId,
      quantity: input.quantity,
      sourceLocationId: sourceLocationId!,
      destLocationId: customerLoc.id,
      originDocType: input.originDocType,
      originDocId: input.originDocId,
      originLineId: input.originLineId,
      createdById: input.createdById,
    });
  }

  /**
   * Primitiva de reserva. Requiere que el caller haya resuelto source y dest.
   * Crea un StockMove en estado CONFIRMED. No lo marca como DONE — eso lo
   * hace StockReceiptService.confirmDelivery() cuando se emite el remito.
   */
  async reserve(input: {
    tenantId: string;
    productId: string;
    quantity: Quantity;
    sourceLocationId: string;
    destLocationId: string;
    originDocType: 'SO' | 'TRANSFER';
    originDocId: string;
    originLineId?: string;
    createdById: string;
  }): Promise<{ moveId: string }> {
    return this.withRetry(() => this.reserveOnce(input));
  }

  /**
   * Libera una reserva cancelando el stock move correspondiente.
   * No borra el move — lo marca como CANCELLED para preservar auditoría.
   */
  async release(input: {
    tenantId: string;
    moveId: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.stockMove.updateMany({
        where: {
          id: input.moveId,
          tenantId: input.tenantId,
          state: { in: ['CONFIRMED', 'ASSIGNED'] },
        },
        data: {
          state: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: input.reason,
        },
      });

      if (result.count === 0) {
        throw new BusinessRuleError(
          'RESERVATION_NOT_FOUND_OR_FINALIZED',
          'Cannot release: reservation not found, already cancelled, or already DONE',
          { moveId: input.moveId },
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Implementación interna
  // -------------------------------------------------------------------------

  private async reserveOnce(input: {
    tenantId: string;
    productId: string;
    quantity: Quantity;
    sourceLocationId: string;
    destLocationId: string;
    originDocType: 'SO' | 'TRANSFER';
    originDocId: string;
    originLineId?: string;
    createdById: string;
  }): Promise<{ moveId: string }> {
    return this.prisma.serializable(async (tx) => {
      // ------------------------------------------------------------------
      // 1. Verificar que el producto exista y esté activo.
      //    Lo hacemos DENTRO de la tx para que SERIALIZABLE detecte si
      //    alguien lo desactiva en el medio.
      // ------------------------------------------------------------------
      const product = await tx.product.findFirst({
        where: {
          id: input.productId,
          tenantId: input.tenantId,
          isActive: true,
        },
        select: { id: true, sku: true, tracking: true },
      });
      if (!product) {
        throw new NotFoundError('Product', input.productId);
      }

      // ------------------------------------------------------------------
      // 2. Verificar que la location source exista, esté activa y sea
      //    del tipo correcto (no se reserva desde una virtual).
      // ------------------------------------------------------------------
      const sourceLoc = await tx.location.findFirst({
        where: {
          id: input.sourceLocationId,
          tenantId: input.tenantId,
          isActive: true,
        },
        select: { id: true, code: true, locationType: true },
      });
      if (!sourceLoc) {
        throw new NotFoundError('Location', input.sourceLocationId);
      }
      if (sourceLoc.locationType !== 'INTERNAL') {
        throw new BusinessRuleError(
          'RESERVE_FROM_NON_INTERNAL',
          `Cannot reserve from location of type ${sourceLoc.locationType}`,
          { locationCode: sourceLoc.code },
        );
      }

      // ------------------------------------------------------------------
      // 3. Leer el disponible. Esta lectura, dentro de SERIALIZABLE, hace
      //    que cualquier escritura concurrente que cambie el disponible
      //    cause un conflict error (P2034) al commit.
      // ------------------------------------------------------------------
      const availableRows = await tx.$queryRaw<Array<{ available: string }>>`
        SELECT COALESCE(inventory.get_available(
          ${input.tenantId}::text,
          ${input.productId}::text,
          ${input.sourceLocationId}::text
        ), 0)::text AS available
      `;

      const availableStr = availableRows[0]?.available ?? '0';
      const available = Quantity.of(availableStr);

      if (available.lessThan(input.quantity)) {
        throw new BusinessRuleError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock for product ${product.sku}`,
          {
            productId: product.id,
            sku: product.sku,
            requested: input.quantity.toString(),
            available: available.toString(),
            shortage: this.computeShortage(input.quantity, available),
          },
        );
      }

      // ------------------------------------------------------------------
      // 4. Crear el stock move CONFIRMED. Esto afecta `committed` en la
      //    vista y reduce el disponible para futuras reservas.
      // ------------------------------------------------------------------
      const move = await tx.stockMove.create({
        data: {
          tenantId: input.tenantId,
          productId: input.productId,
          quantity: input.quantity.toString(),
          uom: 'UN',
          sourceLocationId: input.sourceLocationId,
          destLocationId: input.destLocationId,
          state: 'CONFIRMED',
          originDocType: input.originDocType,
          originDocId: input.originDocId,
          originLineId: input.originLineId ?? null,
          scheduledDate: new Date(),
          createdById: input.createdById,
        },
        select: { id: true },
      });

      this.logger.log(
        `Reserved ${input.quantity} of product ${product.sku} from ${sourceLoc.code} [move=${move.id}]`,
      );

      return { moveId: move.id };
    });
  }

  /**
   * Ejecuta un callback con retry automático sobre conflictos SERIALIZABLE.
   *
   * Postgres devuelve SQLSTATE 40001 ("could not serialize access") cuando
   * detecta un conflicto. Prisma lo expone como error con code P2034.
   *
   * Los conflictos son esperables bajo carga concurrente — NO son bugs.
   * Retry con backoff exponencial + jitter evita thundering herd si muchas
   * requests fallan simultáneamente.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.MAX_RETRIES) {
      try {
        return await fn();
      } catch (err) {
        if (!this.isSerializationError(err)) throw err;
        lastError = err;
        attempt++;

        if (attempt < this.MAX_RETRIES) {
          const backoff = this.BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          const jitter = Math.random() * backoff;
          await this.sleep(backoff + jitter);
          this.logger.warn(
            `Serialization conflict, retrying (${attempt}/${this.MAX_RETRIES})`,
          );
        }
      }
    }

    this.logger.error(`Reservation failed after ${this.MAX_RETRIES} retries`);
    throw lastError;
  }

  private isSerializationError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: string; meta?: { code?: string } };
    // Prisma P2034 = transaction write conflict or deadlock
    if (e.code === 'P2034') return true;
    // A veces Postgres 40001 llega como string
    const message = (err as Error).message ?? '';
    return message.includes('could not serialize') || message.includes('40001');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private computeShortage(requested: Quantity, available: Quantity): string {
    try {
      // Si available >= requested esto no se llama — defensive
      if (available.greaterThanOrEqual(requested)) return '0';
      // subtract lanza si iría negativo — usar toNumber para restar safe
      return (requested.toNumber() - available.toNumber()).toString();
    } catch {
      return 'unknown';
    }
  }
}









