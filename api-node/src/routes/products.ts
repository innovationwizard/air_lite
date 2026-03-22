import { FastifyRequest } from 'fastify';
import type { AppWithPrisma } from '../types/app';
import { authenticate, requirePermissions } from '../middleware/auth';
import { successResponse } from '../utils/responses';

type ProductParams = {
  id: string;
};

export const productsRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/products
  app.get('/', {
    onRequest: [authenticate, requirePermissions('recommendation:read')],
  }, async (_request, reply) => {
    const products = await app.prisma.product.findMany({
      where: { isDeleted: false },
    });
    
    return successResponse(reply, products);
  });
  
  // GET /v1/products/:id
  app.get('/:id', {
    onRequest: [authenticate, requirePermissions('recommendation:read')],
  }, async (request: FastifyRequest, reply) => {
    const { id } = request.params as ProductParams;
    const productId = Number(id);

    if (Number.isNaN(productId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Product ID must be a number' },
      });
    }
    
    const product = await app.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });
    
    if (!product) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      });
    }
    
    return successResponse(reply, product);
  });
  
  // POST /v1/products
  app.post('/', {
    onRequest: [authenticate, requirePermissions('recommendation:write')],
  }, async (request: FastifyRequest, reply) => {
    const body = request.body as {
      productName?: string;
      sku?: string;
      cost?: number;
      category?: string;
      shelf_life_days?: number;
      moq?: number;
      supply_type?: string;
    };

    if (!body.productName) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'productName is required' },
      });
    }

    const product = await app.prisma.product.create({
      data: {
        productName: body.productName,
        sku: body.sku,
        cost: body.cost,
        category: body.category,
        shelf_life_days: body.shelf_life_days,
        moq: body.moq,
        supply_type: body.supply_type,
      },
    });

    return reply.status(201).send({ success: true, data: product });
  });

  // PUT /v1/products/:id
  app.put('/:id', {
    onRequest: [authenticate, requirePermissions('recommendation:write')],
  }, async (request: FastifyRequest, reply) => {
    const { id } = request.params as ProductParams;
    const productId = Number(id);

    if (Number.isNaN(productId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Product ID must be a number' },
      });
    }

    const body = request.body as {
      productName?: string;
      sku?: string;
      cost?: number;
      category?: string;
      shelf_life_days?: number;
      moq?: number;
      supply_type?: string;
    };

    const existing = await app.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      });
    }

    const product = await app.prisma.product.update({
      where: { id: productId },
      data: {
        ...(body.productName !== undefined && { productName: body.productName }),
        ...(body.sku !== undefined && { sku: body.sku }),
        ...(body.cost !== undefined && { cost: body.cost }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.shelf_life_days !== undefined && { shelf_life_days: body.shelf_life_days }),
        ...(body.moq !== undefined && { moq: body.moq }),
        ...(body.supply_type !== undefined && { supply_type: body.supply_type }),
      },
    });

    return successResponse(reply, product);
  });

  // DELETE /v1/products/:id  (soft delete)
  app.delete('/:id', {
    onRequest: [authenticate, requirePermissions('recommendation:write')],
  }, async (request: FastifyRequest, reply) => {
    const { id } = request.params as ProductParams;
    const productId = Number(id);

    if (Number.isNaN(productId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Product ID must be a number' },
      });
    }

    const existing = await app.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      });
    }

    await app.prisma.product.update({
      where: { id: productId },
      data: { isDeleted: true },
    });

    return successResponse(reply, { id: productId, deleted: true });
  });
};