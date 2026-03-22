import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate } from '../middleware/auth';interface MetricasResumen {
  ventas_totales: number;
  ingresos_facturados: number;
  margen_bruto: number;
  valor_inventario: number;
  perfect_order_rate: number;
}

interface RoiRow {
  periodo: Date;
  ahorros_stockout: number;
  ahorros_optimizacion: number;
  reduccion_inventario: number;
  roi_total: number;
  recomendaciones_aceptadas: number;
}

interface StrategicAlertRow {
  tipo: string;
  prioridad: string;
  titulo: string;
  descripcion: string;
  impacto_estimado: number;
  accion_requerida: string;
}

interface SalesDepartmentRow {
  revenue: number;
  growth: number;
  conversion_rate: number;
}

interface ComprasDepartmentRow {
  savings: number;
  otif: number;
  supplier_performance: number;
}

interface InventarioDepartmentRow {
  accuracy: number;
  turnover: number;
  stockouts: number;
}

interface FinanzasDepartmentRow {
  working_capital: number;
  cash_conversion_cycle: number;
  gmroi: number;
}
export const gerenciaRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/gerencia/resumen-ejecutivo
  app.get('/resumen-ejecutivo', {
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

        const obtenerResumen = async (inicio: string, fin: string): Promise<MetricasResumen> => {
          // Ventas totales
          const ventas = await app.prisma.$queryRaw<[{total: number}]>`
            SELECT COALESCE(SUM(total_price), 0) as total
            FROM sales_partitioned
            WHERE sale_datetime >= ${inicio}::date
              AND sale_datetime <= ${fin}::date
              AND NOT is_deleted
          `;

          // Margen bruto
          const margen = await app.prisma.$queryRaw<[{margen: number}]>`
            SELECT COALESCE(
              (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) * 100,
              0
            ) as margen
            FROM sales_partitioned s
            JOIN products p ON s.product_id = p.product_id
            WHERE s.sale_datetime >= ${inicio}::date
              AND s.sale_datetime <= ${fin}::date
              AND NOT s.is_deleted
              AND s.total_price > 0
          `;

          // Valor del inventario
          const inventario = await app.prisma.$queryRaw<[{valor: number}]>`
            SELECT COALESCE(SUM(GREATEST(i.quantity_on_hand, 0) * p.cost), 0) as valor
            FROM (
              SELECT DISTINCT ON (product_id)
                product_id,
                quantity_on_hand
              FROM inventory_snapshots
              WHERE snapshot_timestamp <= ${fin}::date + INTERVAL '1 day'
                AND NOT is_deleted
              ORDER BY product_id, snapshot_timestamp DESC
            ) i
            JOIN products p ON i.product_id = p.product_id
          `;

          // Perfect Order Rate (on-time delivery from purchases)
          const perfectOrder = await app.prisma.$queryRaw<[{rate: number}]>`
            SELECT COALESCE(
              COUNT(CASE WHEN p.on_time_delivery THEN 1 END) * 100.0 /
              NULLIF(COUNT(*), 0),
              0
            ) as rate
            FROM purchases p
            WHERE p.purchase_datetime >= ${inicio}::date
              AND p.purchase_datetime <= ${fin}::date
              AND NOT p.is_deleted
          `;

          // Ingresos facturados (from accounting data)
          let ingresosFacturados = 0;
          try {
            const facturado = await app.prisma.$queryRaw<[{total: number}]>`
              SELECT COALESCE(SUM(net_revenue), 0) as total
              FROM invoice_revenue_by_product
              WHERE invoice_month >= DATE_TRUNC('month', ${inicio}::date)
                AND invoice_month <= DATE_TRUNC('month', ${fin}::date)
            `;
            ingresosFacturados = facturado[0]?.total ?? 0;
          } catch {
            // Materialized view may not exist yet — graceful fallback
          }

          return {
            ventas_totales: ventas[0]?.total ?? 0,
            ingresos_facturados: ingresosFacturados,
            margen_bruto: margen[0]?.margen ?? 0,
            valor_inventario: inventario[0]?.valor ?? 0,
            perfect_order_rate: perfectOrder[0]?.rate ?? 0
          };
        };

        if (modo === 'comparar' && fechaInicioComparacion && fechaFinComparacion) {
          const [actual, anterior] = await Promise.all([
            obtenerResumen(startDate, endDate),
            obtenerResumen(fechaInicioComparacion, fechaFinComparacion)
          ]);

          res.send({
            success: true,
            data: {
              periodoActual: {
                fechaInicio: startDate,
                fechaFin: endDate,
                metricas: actual
              },
              periodoAnterior: {
                fechaInicio: fechaInicioComparacion,
                fechaFin: fechaFinComparacion,
                metricas: anterior
              },
              variaciones: {
                ventas: {
                  valor: actual.ventas_totales - anterior.ventas_totales,
                  porcentaje: anterior.ventas_totales > 0 
                    ? ((actual.ventas_totales - anterior.ventas_totales) / anterior.ventas_totales) * 100
                    : 0
                },
                margen: {
                  valor: actual.margen_bruto - anterior.margen_bruto,
                  porcentaje: ((actual.margen_bruto - anterior.margen_bruto) / anterior.margen_bruto) * 100
                }
              }
            },
            traceId: req.id
          });
        } else {
          const resumen = await obtenerResumen(startDate, endDate);
          
          res.send({
            success: true,
            data: {
              fechaInicio: startDate,
              fechaFin: endDate,
              metricas: resumen
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

  // GET /v1/gerencia/roi-airefill
  app.get('/roi-airefill', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin,
          granularidad = 'mensual'
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const dateGroup = {
          diario: "DATE(generated_at)",
          semanal: "DATE_TRUNC('week', generated_at)",
          mensual: "DATE_TRUNC('month', generated_at)",
          anual: "DATE_TRUNC('year', generated_at)"
        }[granularidad];

        const dateGroupSql = Prisma.raw(dateGroup);

        const roi = await app.prisma.$queryRaw<RoiRow[]>`
          WITH savings AS (
            SELECT 
              ${dateGroupSql} as periodo,
              COALESCE(SUM(
                CASE WHEN insight_type = 'stockout_prevention' 
                THEN impact_value 
                ELSE 0 END
              ), 0) as ahorros_stockout,
              COALESCE(SUM(
                CASE WHEN recommendation_status = 'accepted' 
                THEN total_cost * 0.05
                ELSE 0 END
              ), 0) as ahorros_optimizacion,
              COUNT(CASE WHEN recommendation_status = 'accepted' THEN 1 END) as recomendaciones_aceptadas
            FROM recommendations r
            LEFT JOIN insights i ON r.generated_at::date = i.generated_at::date
            WHERE r.generated_at >= ${startDate}::date
              AND r.generated_at <= ${endDate}::date
            GROUP BY periodo
          ),
          inventory_reduction AS (
            SELECT 
              ${dateGroupSql} as periodo,
              FIRST_VALUE(total_value) OVER (PARTITION BY ${dateGroupSql} ORDER BY snapshot_timestamp) -
              LAST_VALUE(total_value) OVER (PARTITION BY ${dateGroupSql} ORDER BY snapshot_timestamp) as reduccion
            FROM (
              SELECT 
                snapshot_timestamp,
                SUM(GREATEST(quantity_on_hand, 0) * p.cost) as total_value
              FROM inventory_snapshots i
              JOIN products p ON i.product_id = p.product_id
              WHERE snapshot_timestamp >= ${startDate}::date
                AND snapshot_timestamp <= ${endDate}::date
                AND NOT i.is_deleted
              GROUP BY snapshot_timestamp
            ) inv
          )
          SELECT 
            s.periodo,
            s.ahorros_stockout,
            s.ahorros_optimizacion,
            COALESCE(MAX(ir.reduccion), 0) as reduccion_inventario,
            s.ahorros_stockout + s.ahorros_optimizacion + COALESCE(MAX(ir.reduccion), 0) as roi_total,
            s.recomendaciones_aceptadas
          FROM savings s
          LEFT JOIN inventory_reduction ir ON s.periodo = ir.periodo
          GROUP BY s.periodo, s.ahorros_stockout, s.ahorros_optimizacion, s.recomendaciones_aceptadas
          ORDER BY s.periodo
        `;

        const totalROI = roi.reduce((sum, r) => sum + r.roi_total, 0);

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            granularidad,
            roi_por_periodo: roi,
            resumen: {
              roi_total: totalROI,
              ahorros_stockout_total: roi.reduce((sum, r) => sum + r.ahorros_stockout, 0),
              ahorros_optimizacion_total: roi.reduce((sum, r) => sum + r.ahorros_optimizacion, 0),
              reduccion_inventario_total: roi.reduce((sum, r) => sum + r.reduccion_inventario, 0),
              recomendaciones_aceptadas_total: roi.reduce((sum, r) => sum + r.recomendaciones_aceptadas, 0)
            }
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

  // GET /v1/gerencia/metricas-departamentales
  app.get('/metricas-departamentales', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin 
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Métricas de Ventas
        const ventas = await app.prisma.$queryRaw<SalesDepartmentRow[]>`
          WITH current_sales AS (
            SELECT SUM(total_price) as revenue
            FROM sales_partitioned
            WHERE sale_datetime >= ${startDate}::date
              AND sale_datetime <= ${endDate}::date
              AND NOT is_deleted
          ),
          previous_sales AS (
            SELECT SUM(total_price) as revenue
            FROM sales_partitioned
            WHERE sale_datetime >= ${startDate}::date - INTERVAL '30 days'
              AND sale_datetime < ${startDate}::date
              AND NOT is_deleted
          )
          SELECT 
            c.revenue,
            COALESCE((c.revenue - p.revenue) / NULLIF(p.revenue, 0) * 100, 0) as growth,
            85.5 as conversion_rate -- Placeholder hasta tener datos reales
          FROM current_sales c, previous_sales p
        `;

        // Métricas de Compras
        const compras = await app.prisma.$queryRaw<ComprasDepartmentRow[]>`
          SELECT 
            COALESCE(SUM(negotiated_savings + optimization_savings), 0) as savings,
            COALESCE(
              COUNT(CASE WHEN delivered_on_time AND delivered_complete THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0),
              0
            ) as otif,
            92.3 as supplier_performance -- Placeholder
          FROM purchases
          WHERE purchase_datetime >= ${startDate}::date
            AND purchase_datetime <= ${endDate}::date
            AND NOT is_deleted
        `;

        // Métricas de Inventario
        const inventario = await app.prisma.$queryRaw<InventarioDepartmentRow[]>`
          SELECT 
            95.8 as accuracy, -- Placeholder
            COALESCE(
              SUM(s.quantity * p.cost) / NULLIF(AVG(GREATEST(i.quantity_on_hand, 0) * p.cost), 0),
              0
            ) as turnover,
            COUNT(DISTINCT CASE WHEN i.quantity_on_hand = 0 THEN p.product_id END) as stockouts
          FROM products p
          LEFT JOIN sales_partitioned s ON p.product_id = s.product_id
            AND s.sale_datetime >= ${startDate}::date
            AND s.sale_datetime <= ${endDate}::date
          LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
            AND i.snapshot_timestamp >= ${startDate}::date
            AND i.snapshot_timestamp <= ${endDate}::date
          WHERE NOT p.is_deleted
        `;

        // Métricas Financieras
        const finanzas = await app.prisma.$queryRaw<FinanzasDepartmentRow[]>`
          SELECT 
            COALESCE(SUM(GREATEST(i.quantity_on_hand, 0) * p.cost), 0) as working_capital,
            45 as cash_conversion_cycle, -- Placeholder
            COALESCE(
              (SUM(s.total_price) - SUM(s.quantity * p.cost)) /
              NULLIF(AVG(GREATEST(i.quantity_on_hand, 0) * p.cost), 0),
              0
            ) as gmroi
          FROM products p
          LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
            AND i.snapshot_timestamp = (
              SELECT MAX(snapshot_timestamp) 
              FROM inventory_snapshots 
              WHERE snapshot_timestamp <= ${endDate}::date
            )
          LEFT JOIN sales_partitioned s ON p.product_id = s.product_id
            AND s.sale_datetime >= ${startDate}::date
            AND s.sale_datetime <= ${endDate}::date
          WHERE NOT p.is_deleted
        `;

        const [ventasRow] = ventas;
        const [comprasRow] = compras;
        const [inventarioRow] = inventario;
        const [finanzasRow] = finanzas;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            departamentos: {
              ventas: ventasRow ?? { revenue:0, growth:0, conversion_rate:0 },
              compras: comprasRow ?? { savings:0, otif:0, supplier_performance:0 },
              inventario: inventarioRow ?? { accuracy:0, turnover:0, stockouts:0 },
              finanzas: finanzasRow ?? { working_capital:0, cash_conversion_cycle:0, gmroi:0 }
            }
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

  // GET /v1/gerencia/alertas-estrategicas
  app.get('/alertas-estrategicas', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        const alertas = await app.prisma.$queryRaw<StrategicAlertRow[]>`
          SELECT * FROM (
            -- Alertas de ruptura de stock inminente
            SELECT 
              'operacional' as tipo,
              'critica' as prioridad,
              'Riesgo de ruptura de stock' as titulo,
              COUNT(*) || ' productos con menos de 7 días de inventario' as descripcion,
              SUM(p.price_min * v.daily_sales * 7) as impacto_estimado,
              'Autorizar órdenes de compra urgentes' as accion_requerida
            FROM products p
            JOIN (
              SELECT product_id, AVG(quantity) as daily_sales
              FROM sales_partitioned
              WHERE sale_datetime >= ${checkDate}::date - INTERVAL '30 days'
                AND sale_datetime <= ${checkDate}::date
              GROUP BY product_id
            ) v ON p.product_id = v.product_id
            JOIN (
              SELECT DISTINCT ON (product_id) product_id, quantity_on_hand
              FROM inventory_snapshots
              WHERE snapshot_timestamp <= ${checkDate}::date
              ORDER BY product_id, snapshot_timestamp DESC
            ) i ON p.product_id = i.product_id
            WHERE i.quantity_on_hand / v.daily_sales < 7

            UNION ALL

            -- Alertas de capital inmovilizado
            SELECT 
              'financiera' as tipo,
              'alta' as prioridad,
              'Capital inmovilizado excesivo' as titulo,
              'Inventario sin movimiento valorado en $' || ROUND(SUM(i.quantity_on_hand * p.cost)::numeric, 0) as descripcion,
              SUM(i.quantity_on_hand * p.cost) as impacto_estimado,
              'Implementar estrategia de liquidación' as accion_requerida
            FROM products p
            JOIN (
              SELECT DISTINCT ON (product_id) product_id, quantity_on_hand
              FROM inventory_snapshots
              WHERE snapshot_timestamp <= ${checkDate}::date
              ORDER BY product_id, snapshot_timestamp DESC
            ) i ON p.product_id = i.product_id
            LEFT JOIN sales_partitioned s ON p.product_id = s.product_id
              AND s.sale_datetime >= ${checkDate}::date - INTERVAL '90 days'
              AND s.sale_datetime <= ${checkDate}::date
            WHERE s.product_id IS NULL
              AND i.quantity_on_hand > 0
            HAVING SUM(i.quantity_on_hand * p.cost) > 10000

            UNION ALL

            -- Alertas de desempeño de proveedores
            SELECT 
              'proveedor' as tipo,
              'media' as prioridad,
              'Degradación en desempeño de proveedores' as titulo,
              COUNT(*) || ' proveedores con OTIF < 80%' as descripcion,
              0 as impacto_estimado,
              'Revisar contratos y buscar alternativas' as accion_requerida
            FROM (
              SELECT 
                supplier_id,
                COUNT(CASE WHEN delivered_on_time AND delivered_complete THEN 1 END) * 100.0 / COUNT(*) as otif
              FROM purchases
              WHERE purchase_datetime >= ${checkDate}::date - INTERVAL '30 days'
                AND purchase_datetime <= ${checkDate}::date
              GROUP BY supplier_id
              HAVING COUNT(CASE WHEN delivered_on_time AND delivered_complete THEN 1 END) * 100.0 / COUNT(*) < 80
            ) poor_suppliers
          ) alerts
          WHERE impacto_estimado > 0 OR tipo = 'proveedor'
          ORDER BY 
            CASE prioridad 
              WHEN 'critica' THEN 1 
              WHEN 'alta' THEN 2 
              WHEN 'media' THEN 3 
              ELSE 4 
            END
        `;

        res.send({
          success: true,
          data: {
            fechaAnalisis: checkDate,
            alertas
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