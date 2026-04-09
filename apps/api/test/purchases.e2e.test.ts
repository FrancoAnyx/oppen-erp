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
import { SALES_ORDER_REPOSITORY } from '../src/modules/sales/domain/repositories/sales.repositories.js';
import type { ISalesOrderRepository } from '../src/modules/sales/domain/repositories/sales.repositories.js';
import { CreatePurchaseOrderUseCase } from '../src/modules/purchases/application/use-cases/create-purchase-order.use-case.js';
import { ConfirmPurchaseOrderUseCase } from '../src/modules/purchases/application/use-cases/confirm-purchase-order.use-case.js';
import { ReceivePurchaseOrderUseCase } from '../src/modules/purchases/application/use-cases/receive-purchase-order.use-case.js';
import { CreatePOFromBackordersUseCase } from '../src/modules/purchases/application/use-cases/create-po-from-backorders.use-case.js';
import { PURCHASE_ORDER_REPOSITORY } from '../src/modules/purchases/domain/repositories/purchases.repositories.js';
import type { IPurchaseOrderRepository } from '../src/modules/purchases/domain/repositories/purchases.repositories.js';
import { ProductService } from '../src/modules/inventory/application/product.service.js';
import { StockCalculatorService } from '../src/modules/inventory/application/services/stock-calculator.service.js';
import { StockReceiptService } from '../src/modules/inventory/application/services/stock-receipt.service.js';
import { EntityService } from '../src/modules/core/application/entity.service.js';

/**
 * Tests e2e del ciclo compra-venta completo:
 *
 *   FLUJO HAPPY PATH (con stock existente):
 *     1. Crear cliente y proveedor
 *     2. Crear producto y stock inicial
 *     3. OV → confirmar → stock committed
 *     4. OC → confirmar → stock incoming
 *     5. Recibir OC → stock physical sube
 *     6. Los stocks quedan coherentes
 *
 *   FLUJO BACK-TO-BACK (sin stock):
 *     1. OV sin stock → backorder
 *     2. Generar OC desde backorders → OC en DRAFT
 *     3. Confirmar OC → Incoming sube
 *     4. Recibir OC → Physical sube
 *     5. El stock disponible ahora cubre la OV
 *
 *   FLUJO RECEPCIÓN PARCIAL:
 *     1. OC con 10 unidades
 *     2. Recibir 4 → Physical=4, Incoming=6 (move nuevo por los 6 restantes)
 *     3. Recibir 6 → Physical=10, Incoming=0, OC en RECEIVED
 */
describe('Purchases — end to end (ciclo compra-venta completo)', () => {
  let ctx: TestContext;
  let createSO: CreateSalesOrderUseCase;
  let confirmSO: ConfirmSalesOrderUseCase;
  let soRepo: ISalesOrderRepository;
  let createPO: CreatePurchaseOrderUseCase;
  let confirmPO: ConfirmPurchaseOrderUseCase;
  let receivePO: ReceivePurchaseOrderUseCase;
  let poFromBackorders: CreatePOFromBackordersUseCase;
  let poRepo: IPurchaseOrderRepository;
  let products: ProductService;
  let calculator: StockCalculatorService;
  let receipt: StockReceiptService;
  let entities: EntityService;

  let customerId: string;
  let supplierId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    createSO = ctx.moduleRef.get(CreateSalesOrderUseCase);
    confirmSO = ctx.moduleRef.get(ConfirmSalesOrderUseCase);
    soRepo = ctx.moduleRef.get(SALES_ORDER_REPOSITORY);
    createPO = ctx.moduleRef.get(CreatePurchaseOrderUseCase);
    confirmPO = ctx.moduleRef.get(ConfirmPurchaseOrderUseCase);
    receivePO = ctx.moduleRef.get(ReceivePurchaseOrderUseCase);
    poFromBackorders = ctx.moduleRef.get(CreatePOFromBackordersUseCase);
    poRepo = ctx.moduleRef.get(PURCHASE_ORDER_REPOSITORY);
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

    const customer = await entities.create({
      tenantId: ctx.tenantId,
      roles: ['CUSTOMER'],
      legalName: 'Test Cliente SA',
      taxId: '20123456789',
      ivaCondition: 'RI',
    });
    customerId = customer.id;

    const supplier = await entities.create({
      tenantId: ctx.tenantId,
      roles: ['SUPPLIER'],
      legalName: 'Tech Distribuidor SA',
      taxId: '30500010912',
      ivaCondition: 'RI',
    });
    supplierId = supplier.id;

    const product = await products.create({
      tenantId: ctx.tenantId,
      sku: 'TEST-PO-PROD-001',
      name: 'Notebook Dell XPS',
      ivaRate: '21.00',
      listPriceArs: '800000.00',
      standardCostUsd: '700.00',
    });
    productId = product.id;
  });

  // ===========================================================================
  // 1. FLUJO COMPLETO: OV + OC + recepción
  // ===========================================================================

  it('complete cycle: SO confirmed → PO confirmed (Incoming) → PO received (Physical)', async () => {
    // ---- Stock inicial: 2 unidades ----
    await receipt.receiveDirect({
      tenantId: ctx.tenantId,
      productId,
      quantity: Quantity.of(2),
      destLocationId: ctx.mainWarehouseId,
      originDocType: 'RECEIPT',
      originDocId: 'initial-stock-001',
      createdById: ctx.userId,
    });

    // OV por 2 unidades (usa stock existente)
    const { orderId: soId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '2', unitPriceArs: '800000', ivaRate: '21.00' }],
    });

    await confirmSO.execute({ tenantId: ctx.tenantId, orderId: soId, confirmedById: ctx.userId });

    // Después de confirmar OV: 2 physical, 0 available, 2 committed
    const s1 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s1.physical.toString()).toBe('2');
    expect(s1.available.toString()).toBe('0');
    expect(s1.committed.toString()).toBe('2');

    // ---- OC: comprar 5 unidades más ----
    const { orderId: poId } = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '5', unitCostUsd: '700' }],
    });

    // Confirmar OC → crea StockMoves CONFIRMED (Incoming)
    const confirmResult = await confirmPO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      confirmedById: ctx.userId,
      fxRate: '1050.00',
    });
    expect(confirmResult.incomingMoveIds).toHaveLength(1);

    // Después de confirmar OC: physical=2, committed=2, incoming=5
    const s2 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s2.physical.toString()).toBe('2');
    expect(s2.committed.toString()).toBe('2');
    expect(s2.incoming.toString()).toBe('5');
    // available = physical - committed = 0
    expect(s2.available.toString()).toBe('0');

    // ---- Recibir la OC completa ----
    const po = await poRepo.findById(ctx.tenantId, poId);
    const lineId = po!.lines[0]!.id;

    const receiveResult = await receivePO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      receivedById: ctx.userId,
      lines: [{ lineId, quantityReceived: '5', unitCostArs: '735000.00' }],
      fxRateAtReceipt: '1050.00',
    });
    expect(receiveResult.newState).toBe('RECEIVED');
    expect(receiveResult.doneMoveIds).toHaveLength(1);

    // Después de recibir: physical=7, committed=2, incoming=0, available=5
    const s3 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s3.physical.toString()).toBe('7');
    expect(s3.committed.toString()).toBe('2');
    expect(s3.incoming.toString()).toBe('0');
    expect(s3.available.toString()).toBe('5');

    // OC en estado RECEIVED
    const receivedPO = await poRepo.findById(ctx.tenantId, poId);
    expect(receivedPO!.currentState).toBe('RECEIVED');
  });

  // ===========================================================================
  // 2. BACK-TO-BACK: OV con backorder → OC generada automáticamente
  // ===========================================================================

  it('back-to-back: SO backorder → generate PO → confirm PO → stock available for SO', async () => {
    // Sin stock inicial — todo irá a backorder

    // OV por 10 unidades (sin stock)
    const { orderId: soId } = await createSO.execute({
      tenantId: ctx.tenantId,
      customerId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '10', unitPriceArs: '800000', ivaRate: '21.00' }],
    });

    const confirmSoResult = await confirmSO.execute({
      tenantId: ctx.tenantId,
      orderId: soId,
      confirmedById: ctx.userId,
      allowBackorder: true,
    });

    // La OV se confirma con backorder
    expect(confirmSoResult.requiresBackorder).toBe(true);
    expect(confirmSoResult.backorderedLines).toHaveLength(1);

    // Stock: todo en cero (la línea fue a backorder, no se reservó)
    const s0 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s0.committed.toString()).toBe('0');
    expect(s0.physical.toString()).toBe('0');

    // ---- Generar OC desde los backorders de la OV ----
    const { orderId: poId, linesCreated, skippedLines } = await poFromBackorders.execute({
      tenantId: ctx.tenantId,
      salesOrderId: soId,
      supplierId,
      createdById: ctx.userId,
      expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 días
      costOverrides: [{ productId, unitCostUsd: '700' }],
    });

    expect(linesCreated).toBe(1);
    expect(skippedLines).toHaveLength(0);

    // OC en DRAFT, con soOriginId apuntando a la OV
    const po = await poRepo.findById(ctx.tenantId, poId);
    expect(po!.currentState).toBe('DRAFT');
    expect(po!.soOriginId).toBe(soId);
    expect(po!.lines[0]!.soLineOriginId).toBeTruthy();
    expect(po!.lines[0]!.quantity).toBe('10.0000');

    // ---- Confirmar OC → Incoming sube ----
    await confirmPO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      confirmedById: ctx.userId,
      fxRate: '1050.00',
    });

    const s1 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s1.incoming.toString()).toBe('10');
    expect(s1.physical.toString()).toBe('0');

    // ---- Recibir OC → Physical sube, Incoming baja ----
    const lineId = po!.lines[0]!.id;
    await receivePO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      receivedById: ctx.userId,
      lines: [{ lineId, quantityReceived: '10' }],
    });

    // Ahora hay 10 unidades físicas disponibles para la OV
    const s2 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s2.physical.toString()).toBe('10');
    expect(s2.incoming.toString()).toBe('0');
    expect(s2.available.toString()).toBe('10'); // las 10 están disponibles (el backorder de OV no reservó)
  });

  // ===========================================================================
  // 3. RECEPCIÓN PARCIAL — double-entry coherente
  // ===========================================================================

  it('partial receipt: receive 4 of 10 → incoming=6, physical=4; then receive 6 → RECEIVED', async () => {
    const { orderId: poId } = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '10', unitCostUsd: '700' }],
    });

    await confirmPO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      confirmedById: ctx.userId,
    });

    // Antes de recibir: incoming=10, physical=0
    const s0 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s0.incoming.toString()).toBe('10');
    expect(s0.physical.toString()).toBe('0');

    // ---- Primera recepción: 4 de 10 ----
    const po = await poRepo.findById(ctx.tenantId, poId);
    const lineId = po!.lines[0]!.id;

    const r1 = await receivePO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      receivedById: ctx.userId,
      lines: [{ lineId, quantityReceived: '4' }],
    });
    expect(r1.newState).toBe('PARTIAL');
    expect(r1.doneMoveIds).toHaveLength(1);

    // physical=4, incoming=6
    const s1 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s1.physical.toString()).toBe('4');
    expect(s1.incoming.toString()).toBe('6');

    // ---- Segunda recepción: 6 de 6 restantes ----
    // Necesitamos el nuevo lineId del estado actualizado de la OC
    const po2 = await poRepo.findById(ctx.tenantId, poId);
    expect(po2!.currentState).toBe('PARTIAL');
    expect(po2!.lines[0]!.quantityReceived).toBe('4.0000');

    const r2 = await receivePO.execute({
      tenantId: ctx.tenantId,
      orderId: poId,
      receivedById: ctx.userId,
      lines: [{ lineId, quantityReceived: '6' }],
    });
    expect(r2.newState).toBe('RECEIVED');

    // physical=10, incoming=0
    const s2 = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s2.physical.toString()).toBe('10');
    expect(s2.incoming.toString()).toBe('0');
    expect(s2.available.toString()).toBe('10');

    const finalPO = await poRepo.findById(ctx.tenantId, poId);
    expect(finalPO!.currentState).toBe('RECEIVED');
    expect(finalPO!.lines[0]!.quantityReceived).toBe('10.0000');
  });

  // ===========================================================================
  // 4. SECUENCIA: OCs tienen orderNumbers independientes de OVs
  // ===========================================================================

  it('PO orderNumbers are sequential and independent of SO orderNumbers', async () => {
    const r1 = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitCostUsd: '100' }],
    });
    const r2 = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '1', unitCostUsd: '200' }],
    });

    expect(r2.orderNumber).toBeGreaterThan(r1.orderNumber);
  });

  // ===========================================================================
  // 5. VALIDACIÓN: no se puede recibir más de lo pendiente
  // ===========================================================================

  it('over-receipt throws BusinessRuleError', async () => {
    const { orderId: poId } = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [{ productId, quantity: '5', unitCostUsd: '700' }],
    });

    await confirmPO.execute({ tenantId: ctx.tenantId, orderId: poId, confirmedById: ctx.userId });

    const po = await poRepo.findById(ctx.tenantId, poId);
    const lineId = po!.lines[0]!.id;

    await expect(
      receivePO.execute({
        tenantId: ctx.tenantId,
        orderId: poId,
        receivedById: ctx.userId,
        lines: [{ lineId, quantityReceived: '6' }], // más que 5
      }),
    ).rejects.toMatchObject({ code: 'PO_RECV_OVER_QUANTITY' });

    // Stock no debe haber cambiado
    const s = await calculator.getTotalStock(ctx.tenantId, productId);
    expect(s.physical.toString()).toBe('0');
    expect(s.incoming.toString()).toBe('5');
  });

  // ===========================================================================
  // 6. VALIDACIÓN: entidad sin rol SUPPLIER rechazada
  // ===========================================================================

  it('create PO with non-supplier entity throws BusinessRuleError', async () => {
    await expect(
      createPO.execute({
        tenantId: ctx.tenantId,
        supplierId: customerId, // customerId es CUSTOMER, no SUPPLIER
        createdById: ctx.userId,
        lines: [{ productId, quantity: '1', unitCostUsd: '100' }],
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_NOT_A_SUPPLIER' });
  });

  // ===========================================================================
  // 7. TOTALES OC: verificar cálculo subtotal + IVA + total en USD
  // ===========================================================================

  it('PO totals calculated correctly on create', async () => {
    const { orderId: poId } = await createPO.execute({
      tenantId: ctx.tenantId,
      supplierId,
      createdById: ctx.userId,
      lines: [
        { productId, quantity: '3', unitCostUsd: '700.00', ivaRate: '0' },
      ],
    });

    const po = await poRepo.findById(ctx.tenantId, poId);
    // subtotal = 700 * 3 = 2100, iva=0, total=2100
    expect(po!.subtotalUsd).toBe('2100.00');
    expect(po!.totalUsd).toBe('2100.00');
  });
});
