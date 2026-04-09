import { Injectable } from '@nestjs/common';
import { Prisma, type Product as PrismaProduct } from '@erp/database';
import { ConcurrencyError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  Product,
  type ProductState,
  type TrackingType,
  type CostMethod,
} from '../../domain/entities/product';
import { IProductRepository } from '../../domain/repositories/inventory.repositories';

@Injectable()
export class PrismaProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findBySku(tenantId: string, sku: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findMany(params: {
    tenantId: string;
    search?: string;
    categoryId?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Product[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      tenantId: params.tenantId,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.search
        ? {
            OR: [
              { sku: { contains: params.search, mode: 'insensitive' } },
              { name: { contains: params.search, mode: 'insensitive' } },
              { barcode: { contains: params.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 200),
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  async create(product: Product): Promise<Product> {
    const s = product.toState();
    const row = await this.prisma.product.create({
      data: {
        tenantId: s.tenantId,
        sku: s.sku,
        barcode: s.barcode ?? null,
        name: s.name,
        description: s.description ?? null,
        categoryId: s.categoryId ?? null,
        tracking: s.tracking,
        ivaRate: s.ivaRate,
        internalTaxRate: s.internalTaxRate,
        costMethod: s.costMethod,
        standardCostUsd: s.standardCostUsd ?? null,
        listPriceArs: s.listPriceArs ?? null,
        weightKg: s.weightKg ?? null,
        uom: s.uom,
        isActive: s.isActive,
        version: 1,
      },
    });
    return this.toDomain(row);
  }

  async update(product: Product): Promise<Product> {
    const s = product.toState();
    const result = await this.prisma.product.updateMany({
      where: { id: s.id, tenantId: s.tenantId, version: s.version },
      data: {
        name: s.name,
        description: s.description ?? null,
        barcode: s.barcode ?? null,
        categoryId: s.categoryId ?? null,
        tracking: s.tracking,
        ivaRate: s.ivaRate,
        internalTaxRate: s.internalTaxRate,
        costMethod: s.costMethod,
        standardCostUsd: s.standardCostUsd ?? null,
        listPriceArs: s.listPriceArs ?? null,
        weightKg: s.weightKg ?? null,
        isActive: s.isActive,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await this.prisma.product.findFirst({
        where: { id: s.id, tenantId: s.tenantId },
        select: { version: true },
      });
      throw new ConcurrencyError('Product', s.version, current?.version ?? -1);
    }

    const updated = await this.prisma.product.findFirstOrThrow({
      where: { id: s.id, tenantId: s.tenantId },
    });
    return this.toDomain(updated);
  }

  async hasAnyMoves(tenantId: string, productId: string): Promise<boolean> {
    const count = await this.prisma.stockMove.count({
      where: {
        tenantId,
        productId,
        state: { not: 'CANCELLED' },
      },
    });
    return count > 0;
  }

  private toDomain(row: PrismaProduct): Product {
    const state: ProductState = {
      id: row.id,
      tenantId: row.tenantId,
      sku: row.sku,
      barcode: row.barcode ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      categoryId: row.categoryId ?? undefined,
      tracking: row.tracking as TrackingType,
      ivaRate: row.ivaRate.toString(),
      internalTaxRate: row.internalTaxRate.toString(),
      costMethod: row.costMethod as CostMethod,
      standardCostUsd: row.standardCostUsd?.toString(),
      listPriceArs: row.listPriceArs?.toString(),
      weightKg: row.weightKg?.toString(),
      uom: row.uom,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return Product.hydrate(state);
  }
}

