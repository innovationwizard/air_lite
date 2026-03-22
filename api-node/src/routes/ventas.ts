import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate } from '../middleware/auth';
interface ResumenRow {
  ventas_totales: number;
  unidades_vendidas: number;
  ticket_promedio: number;
  margen_bruto: number;
  productos_distintos: number;
}

interface TendenciaRow {
  periodo: Date;
  ventas: number;
  unidades: number;
  transacciones: number;
}

interface TopProductRow {
  product_id: number;
  sku: string;
  product_name: string;
  ventas_totales: number;
  unidades_vendidas: number;
  margen_contribucion: number;
  ranking: number;
}

interface RiskRow {
  product_id: number;
  sku: string;
  product_name: string;
  stock_actual: number;
  venta_promedio_diaria: number;
  dias_inventario: number;
  fecha_agotamiento: Date;
  nivel_riesgo: string;
}

interface OpportunityRow {
  tipo_oportunidad: string;
  descripcion: string;
  impacto_estimado: number;
  productos_afectados: number;
  accion_recomendada: string;
}
export const ventasRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/ventas/resumen
  app.get('/resumen', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const resumen = await app.prisma.$queryRaw<ResumenRow[]>`
          SELECT
            COALESCE(SUM(v.net_revenue), 0) as ventas_totales,
            COALESCE(SUM(v.invoiced_quantity), 0) as unidades_vendidas,
            COALESCE(SUM(v.net_revenue) / NULLIF(COUNT(*), 0), 0) as ticket_promedio,
            COALESCE(
              (SUM(v.net_revenue) - SUM(v.invoiced_quantity * v.product_cost))
                / NULLIF(SUM(v.net_revenue), 0) * 100,
              0
            ) as margen_bruto,
            COUNT(DISTINCT v.product_id) as productos_distintos
          FROM v_invoice_product_sales v
          WHERE v.invoice_date >= ${startDate}::date
            AND v.invoice_date <= ${endDate}::date
        `;

        const [summary] = resumen;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            ventas_totales: Number(summary?.ventas_totales ?? 0),
            unidades_vendidas: Number(summary?.unidades_vendidas ?? 0),
            ticket_promedio: Number(summary?.ticket_promedio ?? 0),
            margen_bruto: Number(summary?.margen_bruto ?? 0),
            productos_distintos: Number(summary?.productos_distintos ?? 0),
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

  // GET /v1/ventas/tendencia
  app.get('/tendencia', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin, 
          granularidad = 'diario'
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const dateGroup = {
          diario: Prisma.raw("DATE(v.invoice_date)"),
          semanal: Prisma.raw("DATE_TRUNC('week', v.invoice_date)"),
          mensual: Prisma.raw("DATE_TRUNC('month', v.invoice_date)"),
          anual: Prisma.raw("DATE_TRUNC('year', v.invoice_date)")
        }[granularidad];

        const tendencia = await app.prisma.$queryRaw<TendenciaRow[]>`
          SELECT
            ${dateGroup} as periodo,
            COALESCE(SUM(v.net_revenue), 0) as ventas,
            COALESCE(SUM(v.invoiced_quantity), 0) as unidades,
            COUNT(*) as transacciones
          FROM v_invoice_product_sales v
          WHERE v.invoice_date >= ${startDate}::date
            AND v.invoice_date <= ${endDate}::date
          GROUP BY periodo
          ORDER BY periodo
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            granularidad,
            tendencia: tendencia.map(t => ({
              periodo: t.periodo,
              ventas: Number(t.ventas),
              unidades: Number(t.unidades),
              transacciones: Number(t.transacciones),
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

  // GET /v1/ventas/productos-top
  app.get('/productos-top', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin,
          modo = 'individual',
          fechaInicioComparacion,
          fechaFinComparacion,
          limite = '10'
        } = req.query as TimeNavigationParams & { limite?: string };

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const limitValue = Math.max(1, Math.min(parseInt(limite), 100));

        const obtenerTop = async (inicio: string, fin: string) => {
          const rows = await app.prisma.$queryRaw<TopProductRow[]>`
            SELECT
              v.product_id,
              v.sku,
              v.product_name,
              COALESCE(SUM(v.net_revenue), 0) as ventas_totales,
              COALESCE(SUM(v.invoiced_quantity), 0) as unidades_vendidas,
              COALESCE(SUM(v.net_revenue - v.invoiced_quantity * v.product_cost), 0) as margen_contribucion,
              ROW_NUMBER() OVER (ORDER BY SUM(v.net_revenue) DESC) as ranking
            FROM v_invoice_product_sales v
            WHERE v.invoice_date >= ${inicio}::date
              AND v.invoice_date <= ${fin}::date
            GROUP BY v.product_id, v.sku, v.product_name
            ORDER BY ventas_totales DESC
            LIMIT ${limitValue}
          `;
          return rows.map(r => ({
            product_id: Number(r.product_id),
            sku: r.sku,
            product_name: r.product_name,
            ventas_totales: Number(r.ventas_totales),
            unidades_vendidas: Number(r.unidades_vendidas),
            margen_contribucion: Number(r.margen_contribucion),
            ranking: Number(r.ranking),
          }));
        };

        if (modo === 'comparar' && fechaInicioComparacion && fechaFinComparacion) {
          const [periodA, periodB] = await Promise.all([
            obtenerTop(startDate, endDate),
            obtenerTop(fechaInicioComparacion, fechaFinComparacion)
          ]);

          res.send({
            success: true,
            data: {
              periodA: {
                fechaInicio: startDate,
                fechaFin: endDate,
                productos: periodA
              },
              periodB: {
                fechaInicio: fechaInicioComparacion,
                fechaFin: fechaFinComparacion,
                productos: periodB
              },
              comparison: calcularCambiosRanking(periodA, periodB)
            },
            traceId: req.id
          });
        } else {
          const productos = await obtenerTop(startDate, endDate);
          
          res.send({
            success: true,
            data: {
              fechaInicio: startDate,
              fechaFin: endDate,
              productos
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

  // GET /v1/ventas/riesgo-agotamiento
  app.get('/riesgo-agotamiento', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        const productosEnRiesgo = await app.prisma.$queryRaw<RiskRow[]>`
          WITH ventas_recientes AS (
            SELECT 
              s.product_id,
              AVG(s.quantity) as venta_promedio_diaria
            FROM sales_partitioned s
            WHERE s.sale_datetime >= ${checkDate}::date - INTERVAL '30 days'
              AND s.sale_datetime <= ${checkDate}::date
              AND NOT s.is_deleted
            GROUP BY s.product_id
          ),
          inventario_actual AS (
            SELECT DISTINCT ON (product_id)
              product_id,
              quantity_on_hand as stock_actual
            FROM inventory_snapshots
            WHERE snapshot_timestamp <= ${checkDate}::date
            ORDER BY product_id, snapshot_timestamp DESC
          )
          SELECT 
            p.product_id,
            p.sku,
            p.product_name,
            COALESCE(i.stock_actual, 0) as stock_actual,
            COALESCE(v.venta_promedio_diaria, 0) as venta_promedio_diaria,
            CASE 
              WHEN v.venta_promedio_diaria > 0 
              THEN FLOOR(i.stock_actual / v.venta_promedio_diaria)
              ELSE 999
            END as dias_inventario,
            CASE 
              WHEN v.venta_promedio_diaria > 0 
              THEN ${checkDate}::date + (i.stock_actual / v.venta_promedio_diaria)::integer
              ELSE ${checkDate}::date + INTERVAL '999 days'
            END as fecha_agotamiento,
            CASE 
              WHEN i.stock_actual / NULLIF(v.venta_promedio_diaria, 0) < 7 THEN 'critico'
              WHEN i.stock_actual / NULLIF(v.venta_promedio_diaria, 0) < 14 THEN 'alto'
              WHEN i.stock_actual / NULLIF(v.venta_promedio_diaria, 0) < 30 THEN 'medio'
              ELSE 'bajo'
            END as nivel_riesgo
          FROM products p
          LEFT JOIN ventas_recientes v ON p.product_id = v.product_id
          LEFT JOIN inventario_actual i ON p.product_id = i.product_id
          WHERE NOT p.is_deleted
            AND v.venta_promedio_diaria > 0
            AND i.stock_actual / v.venta_promedio_diaria < 30
          ORDER BY dias_inventario ASC
        `;

        res.send({
          success: true,
          data: {
            fechaAnalisis: checkDate,
            productosEnRiesgo
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

  // GET /v1/ventas/oportunidades-venta
  app.get('/oportunidades-venta', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin 
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const oportunidades = await app.prisma.$queryRaw<OpportunityRow[]>`
          WITH overstock AS (
            SELECT 
              'sobrestock' as tipo,
              COUNT(DISTINCT p.product_id) as productos,
              SUM(i.quantity_on_hand * p.cost) as valor_inventario
            FROM products p
            JOIN inventory_snapshots i ON p.product_id = i.product_id
            WHERE i.quantity_on_hand > p.moq * 3
              AND i.snapshot_timestamp = (
                SELECT MAX(snapshot_timestamp) 
                FROM inventory_snapshots 
                WHERE snapshot_timestamp <= ${endDate}::date
              )
          ),
          slow_movers AS (
            SELECT 
              'baja_rotacion' as tipo,
              COUNT(DISTINCT p.product_id) as productos,
              SUM(i.quantity_on_hand * COALESCE(p.list_price, p.cost, 0) * 0.3) as descuento_potencial
            FROM products p
            JOIN inventory_snapshots i ON p.product_id = i.product_id
            LEFT JOIN sales_partitioned s ON p.product_id = s.product_id
              AND s.sale_datetime >= ${startDate}::date
              AND s.sale_datetime <= ${endDate}::date
            WHERE i.snapshot_timestamp = (
              SELECT MAX(snapshot_timestamp) 
              FROM inventory_snapshots 
              WHERE snapshot_timestamp <= ${endDate}::date
            )
            GROUP BY p.product_id, i.quantity_on_hand
            HAVING COALESCE(SUM(s.quantity * s.uom_ratio), 0) < i.quantity_on_hand / 10
          )
          SELECT 
            'Exceso de inventario' as tipo_oportunidad,
            'Productos con inventario superior a 3x MOQ' as descripcion,
            o.valor_inventario as impacto_estimado,
            o.productos as productos_afectados,
            'Implementar promociones o descuentos' as accion_recomendada
          FROM overstock o
          UNION ALL
          SELECT 
            'Productos de baja rotación' as tipo_oportunidad,
            'Productos con ventas < 10% del inventario en 90 días' as descripcion,
            s.descuento_potencial as impacto_estimado,
            s.productos as productos_afectados,
            'Liquidar con 30% de descuento' as accion_recomendada
          FROM slow_movers s
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            oportunidades
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

// Función helper para calcular cambios en ranking
function calcularCambiosRanking(periodA: TopProductRow[], periodB: TopProductRow[]) {
  return periodA
    .map((prodA) => {
      const prodB = periodB.find((p) => p.product_id === prodA.product_id);
      return {
        product_id: prodA.product_id,
        sku: prodA.sku,
        product_name: prodA.product_name,
        ranking_actual: prodA.ranking,
        ranking_anterior: prodB?.ranking ?? null,
        cambio_ranking: prodB ? prodB.ranking - prodA.ranking : null,
        ventas_actual: prodA.ventas_totales,
        ventas_anterior: prodB?.ventas_totales ?? 0,
        cambio_ventas: prodB ? prodA.ventas_totales - prodB.ventas_totales : null,
        cambio_porcentual: prodB && prodB.ventas_totales > 0 
          ? ((prodA.ventas_totales - prodB.ventas_totales) / prodB.ventas_totales) * 100
          : null
      };
    })
    .filter((entry) => entry.ranking_anterior !== null);
}