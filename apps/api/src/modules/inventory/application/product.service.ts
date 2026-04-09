import { Inject, Injectable } from '@nestjs/common';
import { AlreadyExistsError, BusinessRuleError, NotFoundError } from '@erp/shared';
import {
  Product,
  type CreateProductProps,
  type TrackingType,
} from '../../domain/entities/product';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '../../domain/repositories/inventory.repositories';

@Injectable()
export class ProductService {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly repo: IProductRepository,
  ) {}

  async create(input: CreateProductProps): Promise<Product> {
    const product = Product.create(input);

    const existing = await this.repo.findBySku(input.tenantId, product.sku);
    if (existing) {
      throw new AlreadyExistsError('Product', { sku: product.sku });
    }

    return this.repo.create(product);
  }

  async findById(tenantId: string, id: string): Promise<Product> {
    const product = await this.repo.findById(tenantId, id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async findBySku(tenantId: string, sku: string): Promise<Product> {
    const product = await this.repo.findBySku(tenantId, sku.toUpperCase());
    if (!product) throw new NotFoundError('Product', { sku });
    return product;
  }

  async list(params: {
    tenantId: string;
    search?: string;
    categoryId?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Product[]; total: number }> {
    return this.repo.findMany(params);
  }

  async updateListPrice(
    tenantId: string,
    id: string,
    expectedVersion: number,
    newPrice: string,
  ): Promise<Product> {
    const product = await this.findById(tenantId, id);
    if (product.version !== expectedVersion) {
      const { ConcurrencyError } = await import('@erp/shared');
      throw new ConcurrencyError('Product', expectedVersion, product.version);
    }
    product.updateListPrice(newPrice);
    return this.repo.update(product);
  }

  /**
   * Cambiar el tracking solo se permite si el producto NO tiene historia.
   * Una vez que hay stock moves, la categoría de tracking es parte del
   * registro histórico y cambiarla rompería la trazabilidad.
   */
  async changeTracking(
    tenantId: string,
    id: string,
    expectedVersion: number,
    newTracking: TrackingType,
  ): Promise<Product> {
    const product = await this.findById(tenantId, id);
    if (product.version !== expectedVersion) {
      const { ConcurrencyError } = await import('@erp/shared');
      throw new ConcurrencyError('Product', expectedVersion, product.version);
    }

    const hasMoves = await this.repo.hasAnyMoves(tenantId, id);
    if (hasMoves) {
      throw new BusinessRuleError(
        'PRODUCT_HAS_MOVES',
        'Cannot change tracking: product already has stock movements',
        { productId: id },
      );
    }

    product.changeTracking(newTracking);
    return this.repo.update(product);
  }
}




