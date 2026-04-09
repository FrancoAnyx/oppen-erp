import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Quantity } from '@erp/shared';
import {
  createTestContext,
  cleanupTestData,
  teardownTestContext,
  type TestContext,
} from './test-setup.js';
import { CreateSalesOrderUseCase } from '../src/modules/sales/application/use-cases/create-sales-order.use-case.js';
import { ConfirmSalesOrderUseCase } from '../src/modules/sales/application/use-cases/confirm-sales-order.use-case.js';
import { CancelSalesOrderUseCase } from '../src/modules/sales/application/use-cases/cancel-sales-order.use-case.js';
import { SALES_ORDER_REPOSITORY } from '../src/modules/sales/domain/repositories/sales.repositories.js';
import type { ISalesOrderRepository } from '../src/modules/sales/domain/repositories/sales.repositories.js';
import { ProductService } from '../src/modules/inventory/application/product.service.js';
import { StockCalculatorService } from '../src/modules/inventory/application/services/stock-calculator.service.js';
import { StockReceiptService } from '../src/modules/inventory/application/services/stock-receipt.service.js';
import { EntityService } from '../src/modules/core/application/entity.service.js';

/**
 * Tests e2e del módulo Sales — flujo cross-module Sales → Inventory.
 *
 * Cubre:
 *   1. Happy path: crear cliente → crear OV → confirmar → verificar stock committed
 *   2. Cancelación: cancelar OV confirmada → verificar stock liberado
 *   3. Backorder: confirmar OV sin stock → línea queda en backorder, OV confirmada igual
 *   4. Backorder rechazado: confirmar con allowBackorder=false → error 422
 *   5. Idempotencia: confirmar OV ya confirmada → responde el estado actual sin duplicar moves
 *   6. Secuencia de orderNumber: dos OVs tienen números diferentes
 *   7. OV con múltiples líneas: cada línea reserva stock independientemente
 */
describe('Sales — end to end flow (cross-module)', () => {
  let ctx: TestContext;
  let createSO: CreateSalesOrderUseCase;
  let confirmSO: ConfirmSalesOrderUseCase;
  let cancelSO: CancelSalesOrderUseCase;
  let salesRepo: ISalesOrderRepository;
  let products: ProductService;
  let calculator: StockCalculatorService;
  let receipt: StockReceiptService;
  let entities: EntityService;

  // IDs creados en el beforeEach para cada test
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    createSO = ctx.moduleRef.get(CreateSalesOrderUseCase);
    confirmSO = ctx.moduleRef.get(ConfirmSalesOrderUseCase);
    cancelSO = ctx.moduleRef.get(CancelSalesOrderUseCase);
    salesRepo = ctx.moduleRef.get(SALES_ORDER_REPOSITORY);
    products = ctx.moduleRef.get(ProductService);
    calculator = ctx.moduleRef.get(StockCalculatorService);
    receipt = ctx.moduleRef.get(StockReceiptService);
    entities = ctx.moduleRef.get(EntityService);
  });

  afterAll(async () => {
    await cleanupTestData(ctx);
    await teardownTestContext(ctx);
  });

  beforeEach(async () => {
    await cleanupTestData(ctx);

    // Crear cliente base para cada test
    const customer = await entities.create({
      tenantId: ctx.tenantId,
      roles: ['CUSTOMER'],
      legalName: 'Test Cliente SA',
      taxId: '20123456789',
      ivaCondition: 'RI',
      email: 'test@cliente.com',
    });
    customerId = customer.id;

    // Crear producto base
    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-SO-PROD-001',
      name: 'Notebook Test',
      ivaRate: '21.00',
      listPriceArs: '500000.00',
    });
    productId = product.id;
  });

  // ===========================================================================
  // 1. HAPPY PATH COMPLETO
  // ===========================================================================

  it('happy path: create SO in DRAFT → confirm → stock gets committed', async () => {
    // ---- Setup: 5 unidades en stock ----
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(5),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-receipt-001',
      unitCost: '300000.00',
      createdById: ctx.userId,
    });

    const stockBefore = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockBefore.physical.toString()).toBe('5');
    expect(stockBefore.available.toString()).toBe('5');
    expect(stockBefore.committed.toString()).toBe('0');

    // ---- Crear OV en DRAFT ----
    const { orderId, orderNumber } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      paymentTermDays: 30,
      lines: [
        {
          productId,
          quantity: '3',
          unitPriceArs: '600000.00',
          ivaRate: '21.00',
          discountPct: '0',
        },
      ],
    });

    expect(orderId).toBeTruthy();
    expect(orderNumber).toBeGreaterThan(0);

    // Verificar OV en DRAFT — aún no afecta stock
    const draftOrder = await salesRepo.findById(ctx.tenantId, orderId);
    expect(draftOrder).not.toBeNull();
    expect(draftOrder!.currentState).toBe('DRAFT');

    const stockAfterDraft = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterDraft.available.toString()).toBe('5'); // sin cambios

    // ---- Confirmar OV ----
    const confirmResult = await confirmSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      confirmedById: ctx.userId,
      fxRate: '1050.00',
      allowBackorder: true,
    });

    expect(confirmResult.requiresBackorder).toBe(false);
    expect(confirmResult.backorderedLines).toHaveLength(0);

    // Verificar OV en CONFIRMED
    const confirmedOrder = await salesRepo.findById(ctx.tenantId, orderId);
    expect(confirmedOrder!.currentState).toBe('CONFIRMED');
    expect(confirmedOrder!.fxRateAtConfirm).toBe('1050.000000');

    // Verificar que la línea tiene el reserveMoveId
    const line = confirmedOrder!.lines[0];
    expect(line).toBeDefined();
    expect(line!.reserveMoveId).toBeTruthy();
    expect(line!.requiresBackorder).toBe(false);

    // ---- Verificar stock: physical sin cambio, available bajó, committed subió ----
    const stockAfterConfirm = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterConfirm.physical.toString()).toBe('5');
    expect(stockAfterConfirm.available.toString()).toBe('2');   // 5 - 3
    expect(stockAfterConfirm.committed.toString()).toBe('3');   // reservada

    // ---- Verificar totales de la OV ----
    // subtotal = 600000 * 3 * (1 - 0) = 1800000
    // iva     = 1800000 * 21% = 378000
    // total   = 1800000 + 378000 = 2178000
    expect(confirmedOrder!.subtotalArs).toBe('1800000.00');
    expect(confirmedOrder!.taxAmountArs).toBe('378000.00');
    expect(confirmedOrder!.totalArs).toBe('2178000.00');
  });

  // ===========================================================================
  // 2. CANCELACIÓN — libera reservas
  // ===========================================================================

  it('cancel confirmed SO → stock reservation released', async () => {
    // Setup: stock + OV confirmada
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(10),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-receipt-002',
      createdById: ctx.userId,
    });

    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '4', unitPriceArs: '500000', ivaRate: '21.00' }],
    });

    await confirmSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      confirmedById: ctx.userId,
    });

    // Después de confirmar: 6 available, 4 committed
    const stockAfterConfirm = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterConfirm.committed.toString()).toBe('4');
    expect(stockAfterConfirm.available.toString()).toBe('6');

    // ---- Cancelar ----
    await cancelSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      cancelledById: ctx.userId,
      reason: 'Cliente canceló el pedido',
    });

    const cancelledOrder = await salesRepo.findById(ctx.tenantId, orderId);
    expect(cancelledOrder!.currentState).toBe('CANCELLED');

    // Stock debe estar liberado: 10 available, 0 committed
    const stockAfterCancel = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterCancel.physical.toString()).toBe('10');
    expect(stockAfterCancel.available.toString()).toBe('10');
    expect(stockAfterCancel.committed.toString()).toBe('0');
  });

  // ===========================================================================
  // 3. BACKORDER — stock insuficiente, allowBackorder=true
  // ===========================================================================

  it('confirm SO with insufficient stock and allowBackorder=true → line marked as backorder', async () => {
    // Solo 2 unidades pero pedimos 5
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(2),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-receipt-003',
      createdById: ctx.userId,
    });

    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '5', unitPriceArs: '500000', ivaRate: '21.00' }],
    });

    const result = await confirmSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      confirmedById: ctx.userId,
      allowBackorder: true,
    });

    // La OV se confirma igualmente
    expect(result.requiresBackorder).toBe(true);
    expect(result.backorderedLines).toHaveLength(1);
    expect(result.backorderedLines[0]!.productId).toBe(productId);

    const order = await salesRepo.findById(ctx.tenantId, orderId);
    expect(order!.currentState).toBe('CONFIRMED');
    expect(order!.requiresBackorder).toBe(true);
    expect(order!.lines[0]!.requiresBackorder).toBe(true);
    expect(order!.lines[0]!.reserveMoveId).toBeUndefined();

    // El stock NO se reservó (la línea fue a backorder)
    const stock = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stock.committed.toString()).toBe('0');
    expect(stock.available.toString()).toBe('2'); // stock intacto
  });

  // ===========================================================================
  // 4. BACKORDER RECHAZADO — allowBackorder=false
  // ===========================================================================

  it('confirm SO with insufficient stock and allowBackorder=false → throws BusinessRuleError', async () => {
    // Sin stock
    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitPriceArs: '500000', ivaRate: '21.00' }],
    });

    await expect(
      confirmSO.execute({
        tenantId: ctx.tenantId,
        orderId,
        confirmedById: ctx.userId,
        allowBackorder: false,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    // La OV debe seguir en DRAFT
    const order = await salesRepo.findById(ctx.tenantId, orderId);
    expect(order!.currentState).toBe('DRAFT');
  });

  // ===========================================================================
  // 5. IDEMPOTENCIA — confirmar dos veces
  // ===========================================================================

  it('confirm already-confirmed SO is idempotent — no duplicate stock moves', async () => {
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(10),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-receipt-005',
      createdById: ctx.userId,
    });

    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '2', unitPriceArs: '500000', ivaRate: '21.00' }],
    });

    // Primera confirmación
    await confirmSO.execute({ tenantId: ctx.tenantId, orderId, confirmedById: ctx.userId });

    const stockAfterFirst = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterFirst.committed.toString()).toBe('2');

    // Segunda confirmación (idempotente)
    await confirmSO.execute({ tenantId: ctx.tenantId, orderId, confirmedById: ctx.userId });

    // El committed NO debe haber cambiado (no se duplicaron moves)
    const stockAfterSecond = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(stockAfterSecond.committed.toString()).toBe('2');
  });

  // ===========================================================================
  // 6. SECUENCIA DE NÚMEROS — dos OVs tienen orderNumber diferente
  // ===========================================================================

  it('two sales orders get sequential orderNumbers', async () => {
    const r1 = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitPriceArs: '100', ivaRate: '21.00' }],
    });

    const r2 = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitPriceArs: '200', ivaRate: '21.00' }],
    });

    expect(r2.orderNumber).toBeGreaterThan(r1.orderNumber);
    expect(r1.orderNumber).not.toBe(r2.orderNumber);
  });

  // ===========================================================================
  // 7. MÚLTIPLES LÍNEAS — cada una reserva stock independiente
  // ===========================================================================

  it('SO with multiple lines reserves stock for each line independently', async () => {
    // Crear segundo producto
    const product2 = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-SO-PROD-002',
      name: 'Monitor Test',
      ivaRate: '21.00',
      listPriceArs: '200000.00',
    });

    // Stock para ambos productos
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(10),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-multi-001',
      createdById: ctx.userId,
    });
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId: product2.id,
      quantity: Quantity.of(5),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'setup-multi-002',
      createdById: ctx.userId,
    });

    // OV con 2 líneas
    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [
        { productId, quantity: '3', unitPriceArs: '500000', ivaRate: '21.00' },
        { productId: product2.id, quantity: '2', unitPriceArs: '200000', ivaRate: '21.00' },
      ],
    });

    const confirmResult = await confirmSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      confirmedById: ctx.userId,
    });

    expect(confirmResult.requiresBackorder).toBe(false);

    // Ambas líneas deben tener reserveMoveId
    const order = await salesRepo.findById(ctx.tenantId, orderId);
    expect(order!.lines).toHaveLength(2);
    expect(order!.lines[0]!.reserveMoveId).toBeTruthy();
    expect(order!.lines[1]!.reserveMoveId).toBeTruthy();

    // Stock de producto 1: 10 - 3 = 7 available, 3 committed
    const s1 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s1.available.toString()).toBe('7');
    expect(s1.committed.toString()).toBe('3');

    // Stock de producto 2: 5 - 2 = 3 available, 2 committed
    const s2 = await calculator.getTotalStock(ctx.tenantId, product2.id);
    expect(s2.available.toString()).toBe('3');
    expect(s2.committed.toString()).toBe('2');

    // Totales de la OV
    // Línea 1: 500000 * 3 = 1500000 + 21% = 1815000
    // Línea 2: 200000 * 2 = 400000 + 21% = 484000
    // Total: 2299000
    expect(order!.subtotalArs).toBe('1900000.00');
    expect(order!.taxAmountArs).toBe('399000.00');
    expect(order!.totalArs).toBe('2299000.00');
  });

  // ===========================================================================
  // 8. VALIDACIÓN — entity sin rol CUSTOMER falla
  // ===========================================================================

  it('create SO with non-customer entity throws BusinessRuleError', async () => {
    const supplier = await entities.create({
      tenantId: ctx.tenantId,
      roles: ['SUPPLIER'],
      legalName: 'Test Proveedor SRL',
      taxId: '20987654321',
      ivaCondition: 'RI',
    });

    await expect(
      createSO.execute({
        tenantId: ctx.tenantId,
        customerId: supplier.id,
        createdById: ctx.userId,
        lines: [{ productId, quantity: '1', unitPriceArs: '100', ivaRate: '21.00' }],
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_NOT_A_CUSTOMER' });
  });

  // ===========================================================================
  // 9. CANCELAR OV en DRAFT (sin stock moves) — debe funcionar directo
  // ===========================================================================

  it('cancel DRAFT SO does not touch stock', async () => {
    const { orderId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitPriceArs: '100', ivaRate: '21.00' }],
    });

    await cancelSO.execute({
      tenantId: ctx.tenantId,
      orderId,
      cancelledById: ctx.userId,
      reason: 'Test cancel draft',
    });

    const order = await salesRepo.findById(ctx.tenantId, orderId);
    expect(order!.currentState).toBe('CANCELLED');
    expect(order!.cancelReason).toBe('Test cancel draft');
  });
});
