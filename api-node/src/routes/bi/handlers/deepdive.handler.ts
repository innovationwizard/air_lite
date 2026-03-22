import { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse, errorResponseFromError } from '../../../utils/responses';
import { RateLimiterService } from '../services/rate-limiter.service';
import { validateDeepDiveOptions } from '../utils/validators';
import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma, DeepDiveOptions } from '../types';

type DeepDiveEntity =
  | 'sales'
  | 'inventory'
  | 'purchases'
  | 'customers'
  | 'products'
  | 'recommendations'
  | 'forecasts'
  | 'inventory-details'
  | 'sales-details';

interface DeepDiveRequestQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  filters?: Record<string, string | number>;
}

interface DeepDiveQueryOptions extends DeepDiveOptions {
  offset: number;
  filters: Record<string, string>;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface DeepDiveResponse<T> {
  entity: DeepDiveEntity;
  data: T[];
  pagination: Pagination;
  filters: Record<string, string>;
  sortBy: string;
  sortOrder: string;
}

interface CountRow {
  total: number;
}

interface SalesDeepDiveRow {
  sale_id: number;
  sale_datetime: Date;
  client_id: number;
  sku: string;
  product_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  profit: number;
  margin: number | null;
}

interface InventoryDeepDiveRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  cost: number;
  quantity_on_hand: number;
  value: number;
  snapshot_timestamp: Date;
  daily_sales: number | null;
  days_of_stock: number;
}

interface PurchasesDeepDiveRow {
  purchase_id: number;
  purchase_datetime: Date;
  sku: string;
  product_name: string;
  category: string;
  supplier: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier_id: string;
}

interface CustomersDeepDiveRow {
  client_id: number;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  first_purchase: Date;
  last_purchase: Date;
  customer_lifespan_days: number;
}

interface ProductsDeepDiveRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  cost: number;
  moq: number;
  shelf_life_days: number;
  supply_type: string;
  current_stock: number;
  total_sold: number;
  total_revenue: number;
  avg_selling_price: number;
  avg_margin: number;
}

interface RecommendationsDeepDiveRow {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  recommended_quantity: number;
  confidence: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  current_stock: number;
  order_value: number;
}

interface ForecastsDeepDiveRow {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  forecast_date: Date;
  predicted_demand: number;
  actual_value: number | null;
  accuracy_score: number | null;
  confidence: number | null;
  processing_time_ms: number | null;
  created_at: Date;
}

interface InventoryDetailsDeepDiveRow {
  snapshot_id: number;
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  quantity_on_hand: number;
  cost: number;
  inventory_value: number;
  snapshot_timestamp: Date;
  status: string;
}

interface SalesDetailsDeepDiveRow {
  sale_id: number;
  sale_datetime: Date;
  sku: string;
  product_name: string;
  client_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category: string;
}

type DeepDiveRowMap = {
  sales: SalesDeepDiveRow;
  inventory: InventoryDeepDiveRow;
  purchases: PurchasesDeepDiveRow;
  customers: CustomersDeepDiveRow;
  products: ProductsDeepDiveRow;
  recommendations: RecommendationsDeepDiveRow;
  forecasts: ForecastsDeepDiveRow;
  'inventory-details': InventoryDetailsDeepDiveRow;
  'sales-details': SalesDetailsDeepDiveRow;
};

const buildPagination = (page: number, limit: number, total: number): Pagination => ({
  page,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0
});

export class DeepDiveHandler {
  static async getDeepDive(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { entity } = request.params as { entity: DeepDiveEntity };
      const {
        page = 1,
        limit = 100,
        sortBy = 'created_at',
        sortOrder = 'DESC',
        filters = {}
      } = request.query as DeepDiveRequestQuery;

      request.log.info(`[DEEPDIVE HANDLER] Getting deep-dive for entity: ${entity}, page: ${page}, limit: ${limit}`);

      const validated = validateDeepDiveOptions({
        page,
        limit,
        sortBy,
        sortOrder,
        filters
      });

      const normalizedFilters = Object.entries(validated.filters ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
          acc[key] = String(value);
        }
        return acc;
      }, {});

      const options: DeepDiveQueryOptions = {
        ...validated,
        filters: normalizedFilters,
        offset: (validated.page - 1) * validated.limit
      };

      const userId = request.user?.id;
      if (!userId) {
        throw new Error('El usuario no está autenticado');
      }

      const app = request.server;
      RateLimiterService.checkRateLimit(userId);

      const data = await this.getLevel2DeepDive(app, entity, options);

      request.log.info(`[DEEPDIVE HANDLER] Successfully retrieved deep-dive data for entity: ${entity}`);
      return successResponse(reply, data);
    } catch (error) {
      request.log.error({ err: error }, '[DEEPDIVE HANDLER] Error getting deep-dive:');
      return errorResponseFromError(reply, error instanceof Error ? error : new Error('Error desconocido en deep dive'));
    }
  }

  private static async getLevel2DeepDive(
    app: AppWithPrisma,
    entity: DeepDiveEntity,
    options: DeepDiveQueryOptions
  ): Promise<unknown> {
    switch (entity) {
      case 'sales':
        return this.getSalesDeepDive(app, options);
      case 'inventory':
        return this.getInventoryDeepDive(app, options);
      case 'purchases':
        return this.getPurchasesDeepDive(app, options);
      case 'customers':
        return this.getCustomersDeepDive(app, options);
      case 'products':
        return this.getProductsDeepDive(app, options);
      case 'recommendations':
        return this.getRecommendationsDeepDive(app, options);
      case 'forecasts':
        return this.getForecastsDeepDive(app, options);
      case 'inventory-details':
        return this.getInventoryDetailsDeepDive(app, options);
      case 'sales-details':
        return this.getSalesDetailsDeepDive(app, options);
      default:
        throw new Error(`Unknown entity: ${entity}`);
    }
  }

  private static async getSalesDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<SalesDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      client_id: 's.client_id',
      date: 'DATE(s.sale_datetime)'
    });

    const query = `
      SELECT 
        s.sale_id,
        s.sale_datetime,
        s.client_id,
        p.sku,
        p.product_name,
        p.category,
        s.quantity,
        s.unit_price,
        s.total_price,
        (s.unit_price - p.cost) as profit,
        ((s.unit_price - p.cost) / NULLIF(s.unit_price, 0)) as margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<SalesDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getSalesDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getSalesDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'sales',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getInventoryDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<InventoryDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      sku: 'p.sku'
    });

    const query = `
      SELECT 
        i.product_id,
        p.sku,
        p.product_name,
        p.category,
        p.cost,
        i.quantity_on_hand,
        i.quantity_on_hand * p.cost as value,
        i.snapshot_timestamp,
        COALESCE(s.daily_sales, 0) as daily_sales,
        CASE 
          WHEN s.daily_sales > 0 THEN i.quantity_on_hand / s.daily_sales
          ELSE 999
        END as days_of_stock
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY product_id
      ) s ON i.product_id = s.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<InventoryDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getInventoryDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getInventoryDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'inventory',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getPurchasesDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<PurchasesDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      supplier: 'p.supply_type',
      date: 'DATE(pur.purchase_datetime)'
    });

    const query = `
      SELECT 
        pur.purchase_id,
        pur.purchase_datetime,
        p.sku,
        p.product_name,
        p.category,
        p.supply_type as supplier,
        pur.quantity,
        pur.unit_cost,
        pur.total_cost,
        pur.supplier_id
      FROM purchases pur
      JOIN products p ON pur.product_id = p.product_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM purchases pur
      JOIN products p ON pur.product_id = p.product_id
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<PurchasesDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getPurchasesDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getPurchasesDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'purchases',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getCustomersDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<CustomersDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      client_id: 's.client_id'
    });

    const query = `
      SELECT 
        s.client_id,
        COUNT(*) as total_orders,
        SUM(s.total_price) as total_spent,
        AVG(s.total_price) as avg_order_value,
        MIN(s.sale_datetime) as first_purchase,
        MAX(s.sale_datetime) as last_purchase,
        EXTRACT(days FROM MAX(s.sale_datetime) - MIN(s.sale_datetime)) as customer_lifespan_days
      FROM sales_partitioned s
      ${whereClause}
      GROUP BY s.client_id
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT client_id) as total
      FROM sales_partitioned s
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<CustomersDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getCustomersDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getCustomersDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'customers',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getProductsDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<ProductsDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      sku: 'p.sku'
    });

    const query = `
      SELECT 
        p.product_id,
        p.sku,
        p.product_name,
        p.category,
        p.cost,
        p.moq,
        p.shelf_life_days,
        p.supply_type,
        COALESCE(i.quantity_on_hand, 0) as current_stock,
        COALESCE(s.total_quantity, 0) as total_sold,
        COALESCE(s.total_revenue, 0) as total_revenue,
        COALESCE(s.avg_price, 0) as avg_selling_price,
        COALESCE(s.margin, 0) as avg_margin
      FROM products p
      LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      LEFT JOIN (
        SELECT 
          product_id,
          SUM(quantity * uom_ratio) as total_quantity,
          SUM(total_price) as total_revenue,
          AVG(unit_price) as avg_price,
          (SUM(total_price) - SUM(quantity * (SELECT cost FROM products WHERE product_id = sales_partitioned.product_id))) / NULLIF(SUM(total_price), 0) as margin
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
          AND total_price > 0
        GROUP BY product_id
      ) s ON p.product_id = s.product_id
      WHERE p.is_deleted = false
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      WHERE p.is_deleted = false
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<ProductsDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getProductsDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getProductsDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'products',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getRecommendationsDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<RecommendationsDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      status: 'r.status',
      confidence: 'r.confidence'
    });

    const query = `
      SELECT 
        r.id,
        r.product_id,
        p.sku,
        p.product_name,
        p.category,
        r.recommended_quantity,
        r.confidence,
        r.status,
        r.created_at,
        r.updated_at,
        COALESCE(i.quantity_on_hand, 0) as current_stock,
        r.recommended_quantity * p.cost as order_value
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      LEFT JOIN inventory_snapshots i ON r.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<RecommendationsDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getRecommendationsDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getRecommendationsDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'recommendations',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getForecastsDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<ForecastsDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      forecast_date: 'DATE(f.forecast_date)'
    });

    const query = `
      SELECT 
        f.id,
        f.product_id,
        p.sku,
        p.product_name,
        p.category,
        f.forecast_date,
        f.predicted_demand,
        f.actual_value,
        f.accuracy_score,
        f.confidence,
        f.processing_time_ms,
        f.created_at
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<ForecastsDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getForecastsDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getForecastsDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'forecasts',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static buildWhereClause(filters: Record<string, string>, fieldMap: Record<string, string>): string {
    const conditions = Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        const field = fieldMap[key] || key;
        return `${field} ILIKE '%${value}%'`;
      });

    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  private static async getInventoryDetailsDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<InventoryDetailsDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      sku: 'p.sku',
      status: 'status'
    });

    const query = `
      SELECT 
        i.snapshot_id,
        i.product_id,
        p.sku,
        p.product_name,
        p.category,
        i.quantity_on_hand,
        p.cost,
        i.quantity_on_hand * p.cost as inventory_value,
        i.snapshot_timestamp,
        CASE 
          WHEN i.quantity_on_hand = 0 THEN 'STOCKOUT'
          WHEN i.quantity_on_hand < COALESCE(r.recommended_quantity, 10) * 0.5 THEN 'CRITICAL'
          WHEN i.quantity_on_hand < COALESCE(r.recommended_quantity, 10) THEN 'LOW'
          WHEN i.quantity_on_hand > COALESCE(r.recommended_quantity, 10) * 2 THEN 'OVERSTOCK'
          ELSE 'OPTIMAL'
        END as status
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN recommendations r ON i.product_id = r.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<InventoryDetailsDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getInventoryDetailsDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getInventoryDetailsDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'inventory-details',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }

  private static async getSalesDetailsDeepDive(app: AppWithPrisma, options: DeepDiveQueryOptions): Promise<DeepDiveResponse<SalesDetailsDeepDiveRow>> {
    const { page, limit, sortBy, sortOrder, filters, offset } = options;
    const whereClause = this.buildWhereClause(filters, {
      product_name: 'p.product_name',
      category: 'p.category',
      client_name: 'c.client_name',
      date: 'DATE(s.sale_datetime)'
    });

    const query = `
      SELECT 
        s.sale_id,
        s.sale_datetime,
        p.sku,
        p.product_name,
        c.client_name,
        s.quantity,
        s.unit_price,
        s.total_price,
        p.category
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      JOIN clients c ON s.client_id = c.client_id
      WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      JOIN clients c ON s.client_id = c.client_id
      WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
      ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      QueryBuilder.executeWithDebug<SalesDetailsDeepDiveRow[]>(app.prisma, query, [], 'DeepDiveHandler.getSalesDetailsDeepDive'),
      QueryBuilder.executeWithDebug<CountRow[]>(app.prisma, countQuery, [], 'DeepDiveHandler.getSalesDetailsDeepDiveCount')
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      entity: 'sales-details',
      data,
      pagination: buildPagination(page, limit, total),
      filters,
      sortBy,
      sortOrder
    };
  }
}

