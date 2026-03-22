import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate, requirePermissions } from '../middleware/auth';interface RecommendationRow {
  recommendation_id: number;
  sku: string;
  product_name: string;
  recommended_order_quantity: number;
  priority: 'critical' | 'high';
  estimated_stockout_date: Date | null;
  supplier_name: string;
  total_cost: number;
  generated_at: Date;
}

interface SupplierMetricsRow {
  supplier_id: number;
  supplier_name: string;
  on_time_delivery_rate: number;
  average_lead_time: number;
  total_orders: number;
  quality_score: number;
}

interface SavingsRow {
  periodo: Date;
  ahorro_negociacion: number;
  ahorro_optimizacion: number;
  ahorro_total: number;
}

interface TransitOrderRow {
  purchase_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  supplier_name: string;
  expected_arrival: Date;
  days_until_arrival: number;
  is_delayed: boolean;
}

interface SupplierComparisonEntry {
  supplier_id: number;
  supplier_name: string;
  metricas: {
    on_time_delivery: {
      actual: number;
      anterior: number;
      delta: number;
    };
    lead_time: {
      actual: number;
      anterior: number;
      delta: number;
    };
    quality: {
      actual: number;
      anterior: number;
      delta: number;
    };
  };
}

export const comprasRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/compras/ordenes-pendientes
  app.get('/ordenes-pendientes', {
    onRequest: [authenticate, requirePermissions('recommendation:read')],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin
        } = req.query as TimeNavigationParams;

        // Valores por defecto: últimos 30 días
        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const ordenes = await app.prisma.$queryRaw<RecommendationRow[]>`
            r.recommendation_id,
            r.sku,
            r.product_name,
            r.recommended_order_quantity,
            r.priority,
            r.estimated_stockout_date,
            r.supplier_name,
            r.total_cost,
            r.generated_at
          FROM recommendations r
          WHERE r.generated_at >= ${startDate}::date
            AND r.generated_at <= ${endDate}::date
            AND r.priority IN ('critical', 'high')
          ORDER BY 
            CASE r.priority
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
            END,
            r.estimated_stockout_date ASC
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            ordenes: ordenes.map((row) => ({
              recommendationId: row.recommendation_id,
              sku: row.sku,
              productName: row.product_name,
              recommendedOrderQuantity: row.recommended_order_quantity,
              priority: row.priority,
              estimatedStockoutDate: row.estimated_stockout_date,
              supplierName: row.supplier_name,
              totalCost: row.total_cost,
              generatedAt: row.generated_at
            }))
          },
          traceId: req.id
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          error: { message: error instanceof Error ? error.message : 'Error desconocido' },
          traceId: req.id
        });
      }
    }
  });

  // GET /v1/compras/metricas-proveedores
  app.get('/metricas-proveedores', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin, 
          modo = 'individual',
          fechaInicioComparacion,
          fechaFinComparacion
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const obtenerMetricas = async (inicio: string, fin: string): Promise<SupplierMetricsRow[]> => {
          return await app.prisma.$queryRaw<SupplierMetricsRow[]>`
            SELECT 
              s.supplier_id,
              s.supplier_name,
              COALESCE(
                COUNT(CASE WHEN p.delivered_on_time THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
                0
              ) as on_time_delivery_rate,
              COALESCE(AVG(p.actual_lead_time_days), 0) as average_lead_time,
              COUNT(*) as total_orders,
              COALESCE(AVG(p.quality_score), 0) as quality_score
            FROM suppliers s
            LEFT JOIN purchases p ON s.supplier_id = p.supplier_id
            WHERE p.purchase_datetime >= ${inicio}::date
              AND p.purchase_datetime <= ${fin}::date
              AND NOT p.is_deleted
            GROUP BY s.supplier_id, s.supplier_name
            ORDER BY on_time_delivery_rate DESC
          `;
        };

        if (modo === 'comparar' && fechaInicioComparacion && fechaFinComparacion) {
          const [periodA, periodB] = await Promise.all([
            obtenerMetricas(startDate, endDate),
            obtenerMetricas(fechaInicioComparacion, fechaFinComparacion)
          ]);

          const comparison = calcularComparacionProveedores(periodA, periodB);

          res.send({
            success: true,
            data: {
            periodA: {
                fechaInicio: startDate,
                fechaFin: endDate,
              metricas: periodA
              },
              periodB: {
                fechaInicio: fechaInicioComparacion,
                fechaFin: fechaFinComparacion,
              metricas: periodB
              },
              comparison
            },
            traceId: req.id
          });
        } else {
          const metricas = await obtenerMetricas(startDate, endDate);
          
          res.send({
            success: true,
            data: {
              fechaInicio: startDate,
              fechaFin: endDate,
              metricas
            },
            traceId: req.id
          });
        }
      } catch (error) {
        res.status(500).send({
          success: false,
          error: { message: error instanceof Error ? error.message : 'Error desconocido' },
          traceId: req.id
        });
      }
    }
  });

  // GET /v1/compras/ahorro-acumulado
  app.get('/ahorro-acumulado', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin, 
          granularidad = 'mensual'
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Determinar agrupación por granularidad
        const dateGroup = {
          diario: "DATE(p.purchase_datetime)",
          semanal: "DATE_TRUNC('week', p.purchase_datetime)",
          mensual: "DATE_TRUNC('month', p.purchase_datetime)",
          anual: "DATE_TRUNC('year', p.purchase_datetime)"
        }[granularidad];

        const dateGroupSql = Prisma.raw(dateGroup);

        const ahorros = await app.prisma.$queryRaw<SavingsRow[]>`
          SELECT 
            ${dateGroupSql} as periodo,
            COALESCE(SUM(p.negotiated_savings), 0) as ahorro_negociacion,
            COALESCE(SUM(p.optimization_savings), 0) as ahorro_optimizacion,
            COALESCE(SUM(p.negotiated_savings + p.optimization_savings), 0) as ahorro_total
          FROM purchases p
          WHERE p.purchase_datetime >= ${startDate}::date
            AND p.purchase_datetime <= ${endDate}::date
            AND NOT p.is_deleted
          GROUP BY periodo
          ORDER BY periodo
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            granularidad,
            ahorros
          },
          traceId: req.id
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          error: { message: error instanceof Error ? error.message : 'Error desconocido' },
          traceId: req.id
        });
      }
    }
  });

  // GET /v1/compras/ordenes-en-transito
  app.get('/ordenes-en-transito', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        const ordenesEnTransito = await app.prisma.$queryRaw<TransitOrderRow[]>`
          SELECT 
            p.purchase_id,
            pr.sku,
            pr.product_name,
            p.quantity,
            s.supplier_name,
            p.expected_arrival_date as expected_arrival,
            EXTRACT(DAY FROM p.expected_arrival_date - ${checkDate}::date) as days_until_arrival,
            CASE 
              WHEN p.expected_arrival_date < ${checkDate}::date THEN true
              ELSE false
            END as is_delayed
          FROM purchases p
          JOIN products pr ON p.product_id = pr.product_id
          JOIN suppliers s ON p.supplier_id = s.supplier_id
          WHERE p.status = 'in_transit'
            AND NOT p.is_deleted
          ORDER BY p.expected_arrival_date ASC
        `;

        res.send({
          success: true,
          data: {
            fechaConsulta: checkDate,
            ordenesEnTransito: ordenesEnTransito.map((row) => ({
              purchaseId: row.purchase_id,
              sku: row.sku,
              productName: row.product_name,
              quantity: row.quantity,
              supplierName: row.supplier_name,
              expectedArrival: row.expected_arrival,
              daysUntilArrival: row.days_until_arrival,
              isDelayed: row.is_delayed
            }))
          },
          traceId: req.id
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          error: { message: error instanceof Error ? error.message : 'Error desconocido' },
          traceId: req.id
        });
      }
    }
  });
};

// Función helper para calcular comparación de proveedores
function calcularComparacionProveedores(
  periodA: SupplierMetricsRow[],
  periodB: SupplierMetricsRow[]
): SupplierComparisonEntry[] {
  return periodA
    .map((provA) => {
      const provB = periodB.find((p) => p.supplier_id === provA.supplier_id);
      if (!provB) return null;

      return {
        supplier_id: provA.supplier_id,
        supplier_name: provA.supplier_name,
        metricas: {
          on_time_delivery: {
            actual: provA.on_time_delivery_rate,
            anterior: provB.on_time_delivery_rate,
            delta: provA.on_time_delivery_rate - provB.on_time_delivery_rate
          },
          lead_time: {
            actual: provA.average_lead_time,
            anterior: provB.average_lead_time,
            delta: provA.average_lead_time - provB.average_lead_time
          },
          quality: {
            actual: provA.quality_score,
            anterior: provB.quality_score,
            delta: provA.quality_score - provB.quality_score
          }
        }
      };
    })
    .filter((entry): entry is SupplierComparisonEntry => Boolean(entry));
}