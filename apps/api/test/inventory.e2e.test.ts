import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Quantity } from '@erp/shared';
import {
  createTestContext,
  cleanupTestData,
  teardownTestContext,
  type TestContext,
} from './test-setup.js';
import { ProductService } from '../src/modules/inventory/application/product.service.js';
import { StockCalculatorService } from '../src/modules/inventory/application/services/stock-calculator.service.js';
import { StockReservationService } from '../src/modules/inventory/application/services/stock-reservation.service.js';
import { StockReceiptService } from '../src/modules/inventory/application/services/stock-receipt.service.js';

/**
 * Test de integración del happy path completo de Inventory.
 *
 * Cubre: crear producto → recibir stock → reservar → confirmar delivery,
 * validando los 5 estados de stock en cada paso. También cubre el caso
 * de sobreventa (reservar más de lo disponible) y la liberación de reserva.
 *
 * Este es el test más importante del módulo — si pasa, sabés que la
 * integración DB + Prisma + domain + state machine funciona end-to-end.
 */
describe('Inventory — end to end flow', () => {
  let ctx: TestContext;
  let products: ProductService;
  let calculator: StockCalculatorService;
  let reservation: StockReservationService;
  let receipt: StockReceiptService;

  beforeAll(async () => {
    ctx = await createTestContext();
    products = ctx.moduleRef.get(ProductService);
    calculator = ctx.moduleRef.get(StockCalculatorService);
    reservation = ctx.moduleRef.get(StockReservationService);
    receipt = ctx.moduleRef.get(StockReceiptService);
  });

  afterAll(async () => {
    await cleanupTestData(ctx);
    await teardownTestContext(ctx);
  });

  beforeEach(async () => {
    await cleanupTestData(ctx);
  });

  it('full happy path: create → receive → reserve → deliver', async () => {
    // ---- 1. Create product ----
    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-NB-001',
      name: 'Test Notebook',
      ivaRate: '21.00',
      listPriceArs: '500000.00',
    });
    expect(product.sku).toBe('TEST-NB-001');
    expect(product.version).toBe(1);

    // Stock inicial: todo en cero
    const initial = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(initial.physical.toString()).toBe('0');
    expect(initial.available.toString()).toBe('0');
    expect(initial.committed.toString()).toBe('0');

    // ---- 2. Receive 10 units ----
    const { moveId: receiveMoveId } = await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(10),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'test-receipt-001',
      unitCost: '300000.00',
      createdById: ctx.userId,
    });
    expect(receiveMoveId).toBeTruthy();

    // Stock después de recibir: 10 physical, 10 available
    const afterReceive = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(afterReceive.physical.toString()).toBe('10');
    expect(afterReceive.available.toString()).toBe('10');
    expect(afterReceive.committed.toString()).toBe('0');

    // ---- 3. Reserve 3 units for a sales order ----
    const { moveId: reserveMoveId } = await reservation.reserveForCustomer({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(3),
      originDocType: 'SO',
      originDocId: 'test-so-001',
      createdById: ctx.userId,
    });
    expect(reserveMoveId).toBeTruthy();

    // Stock después de reservar: 10 physical, 7 available, 3 committed
    const afterReserve = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(afterReserve.physical.toString()).toBe('10');
    expect(afterReserve.available.toString()).toBe('7');
    expect(afterReserve.committed.toString()).toBe('3');

    // ---- 4. Confirm delivery (CONFIRMED → DONE) ----
    await receipt.confirmDelivery({
      tenantId: ctx.tenantId,
      moveId: reserveMoveId,
    });

    // Stock después de entregar: 7 physical, 7 available, 0 committed
    // (los 3 salieron del depósito hacia CUSTOMER virtual)
    const afterDelivery = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(afterDelivery.physical.toString()).toBe('7');
    expect(afterDelivery.available.toString()).toBe('7');
    expect(afterDelivery.committed.toString()).toBe('0');
  });

  it('blocks over-selling: reserving more than available fails', async () => {
    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-NB-002',
      name: 'Test Notebook 2',
    });

    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(5),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'test-receipt-002',
      createdById: ctx.userId,
    });

    // Reservar 3 ok
    await reservation.reserveForCustomer({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(3),
      originDocType: 'SO',
      originDocId: 'test-so-002a',
      createdById: ctx.userId,
    });

    // Reservar 3 más (total 6) debe fallar — solo hay 2 disponibles
    await expect(
      reservation.reserveForCustomer({
        tenantId: ctx.tenantId,
        productId: product.id,
        quantity: Quantity.of(3),
        originDocType: 'SO',
        originDocId: 'test-so-002b',
        createdById: ctx.userId,
      }),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);

    // El stock no cambió por la reserva fallida
    const stock = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(stock.physical.toString()).toBe('5');
    expect(stock.available.toString()).toBe('2');
    expect(stock.committed.toString()).toBe('3');
  });

  it('releases a reservation (cancel move) and restores availability', async () => {
    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-NB-003',
      name: 'Test Notebook 3',
    });

    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(10),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'test-receipt-003',
      createdById: ctx.userId,
    });

    const { moveId } = await reservation.reserveForCustomer({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(4),
      originDocType: 'SO',
      originDocId: 'test-so-003',
      createdById: ctx.userId,
    });

    let stock = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(stock.available.toString()).toBe('6');

    await reservation.release({
      tenantId: ctx.tenantId,
      moveId,
      reason: 'test rollback',
    });

    stock = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(stock.physical.toString()).toBe('10');
    expect(stock.available.toString()).toBe('10');
    expect(stock.committed.toString()).toBe('0');
  });

  it('concurrent reservations: only one wins, the other gets insufficient', async () => {
    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-NB-004',
      name: 'Test Concurrent',
    });

    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId: product.id,
      quantity: Quantity.of(1), // UN solo item — pelea por ese
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'test-receipt-004',
      createdById: ctx.userId,
    });

    // Dos reservas en paralelo por el último ítem
    const results = await Promise.allSettled([
      reservation.reserveForCustomer({
        tenantId: ctx.tenantId,
        productId: product.id,
        quantity: Quantity.of(1),
        originDocType: 'SO',
        originDocId: 'test-so-004a',
        createdById: ctx.userId,
      }),
      reservation.reserveForCustomer({
        tenantId: ctx.tenantId,
        productId: product.id,
        quantity: Quantity.of(1),
        originDocType: 'SO',
        originDocId: 'test-so-004b',
        createdById: ctx.userId,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactamente una reserva gana
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // El stock final es consistente
    const stock = await calculator.getTotalStock(ctx.tenantId, product.id);
    expect(stock.physical.toString()).toBe('1');
    expect(stock.available.toString()).toBe('0');
    expect(stock.committed.toString()).toBe('1');
  });
});
