import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate } from '../middleware/auth';
interface InventoryLevelRow {
  product_id: number;
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  safety_stock: number;
  reorder_point: number;
  stock_status: string;
  value_on_hand: number;
}

interface MovementRow {
  periodo: Date;
  entradas: number;
  salidas: number;
  ajustes: number;
  saldo_neto: number;
}

interface PrecisionRow {
  total_conteos: number;
  conteos_exactos: number;
  precision_porcentaje: number;
  discrepancia_promedio: number;
  valor_discrepancia: number;
}

interface RotationRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  costo_vendido: number;
  inventario_promedio: number;
  rotacion_anualizada: number;
  dias_inventario: number;
  clasificacion: string;
}

interface ObsolescenceRow {
  product_id: number;
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  ultima_venta: Date | null;
  dias_sin_venta: number;
  valor_obsoleto: number;
  riesgo: string;
}

export const inventarioRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/inventario/niveles-actuales
  app.get('/niveles-actuales', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        
        // Para niveles actuales, usamos la fecha fin o fecha actual
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        const niveles = await app.prisma.$queryRaw<InventoryLevelRow[]>`
          WITH latest_inventory AS (
            SELECT DISTINCT ON (product_id)
              product_id,
              quantity_on_hand,
              snapshot_timestamp
            FROM inventory_snapshots
            WHERE snapshot_timestamp <= ${checkDate}::date + INTERVAL '1 day'
              AND NOT is_deleted
            ORDER BY product_id, snapshot_timestamp DESC
          )
          SELECT 
            p.product_id,
            p.sku,
            p.product_name,
            COALESCE(i.quantity_on_hand, 0) as quantity_on_hand,
            COALESCE(p.safety_stock, 0) as safety_stock,
            COALESCE(p.reorder_point, 0) as reorder_point,
            CASE 
              WHEN i.quantity_on_hand <= 0 THEN 'agotado'
              WHEN i.quantity_on_hand < p.safety_stock THEN 'critico'
              WHEN i.quantity_on_hand < p.reorder_point THEN 'bajo'
              WHEN i.quantity_on_hand > p.reorder_point * 3 THEN 'exceso'
              ELSE 'optimo'
            END as stock_status,
            COALESCE(i.quantity_on_hand * p.cost, 0) as value_on_hand
          FROM products p
          LEFT JOIN latest_inventory i ON p.product_id = i.product_id
          WHERE NOT p.is_deleted
          ORDER BY stock_status, p.sku
        `;

        res.send({
          success: true,
          data: {
            fechaConsulta: checkDate,
            niveles
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

  // GET /v1/inventario/movimientos
  app.get('/movimientos', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin, 
          granularidad = 'diario',
          productId
        } = req.query as TimeNavigationParams & { productId?: string };

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const dateGroup = {
          diario: Prisma.raw("DATE(m.movement_date)"),
          semanal: Prisma.raw("DATE_TRUNC('week', m.movement_date)"),
          mensual: Prisma.raw("DATE_TRUNC('month', m.movement_date)"),
          anual: Prisma.raw("DATE_TRUNC('year', m.movement_date)")
        }[granularidad];

        const movimientos = await app.prisma.$queryRaw<MovementRow[]>`
          SELECT 
            ${dateGroup} as periodo,
            COALESCE(SUM(CASE WHEN m.movement_type = 'entrada' THEN m.quantity ELSE 0 END), 0) as entradas,
            COALESCE(SUM(CASE WHEN m.movement_type = 'salida' THEN m.quantity ELSE 0 END), 0) as salidas,
            COALESCE(SUM(CASE WHEN m.movement_type = 'ajuste' THEN m.quantity ELSE 0 END), 0) as ajustes,
            COALESCE(SUM(
              CASE 
                WHEN m.movement_type = 'entrada' THEN m.quantity
                WHEN m.movement_type = 'salida' THEN -m.quantity
                ELSE m.quantity
              END
            ), 0) as saldo_neto
          FROM inventory_movements m
          WHERE m.movement_date >= ${startDate}::date
            AND m.movement_date <= ${endDate}::date
            AND NOT m.is_deleted
            ${productId ? Prisma.sql`AND m.product_id = ${parseInt(productId)}` : Prisma.empty}
          GROUP BY periodo
          ORDER BY periodo
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            granularidad,
            productId,
            movimientos
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

  // GET /v1/inventario/precision
  app.get('/precision', {
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

        const calcularPrecision = async (inicio: string, fin: string): Promise<PrecisionRow[]> => {
          return await app.prisma.$queryRaw<PrecisionRow[]>`
            WITH conteos AS (
              SELECT 
                c.count_id,
                c.product_id,
                c.system_quantity,
                c.physical_quantity,
                ABS(c.system_quantity - c.physical_quantity) as discrepancia,
                p.cost
              FROM inventory_counts c
              JOIN products p ON c.product_id = p.product_id
              WHERE c.count_date >= ${inicio}::date
                AND c.count_date <= ${fin}::date
                AND NOT c.is_deleted
            )
            SELECT 
              COUNT(*) as total_conteos,
              COUNT(CASE WHEN discrepancia = 0 THEN 1 END) as conteos_exactos,
              COALESCE(
                COUNT(CASE WHEN discrepancia = 0 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
                0
              ) as precision_porcentaje,
              COALESCE(AVG(discrepancia), 0) as discrepancia_promedio,
              COALESCE(SUM(discrepancia * cost), 0) as valor_discrepancia
            FROM conteos
          `;
        };

        if (modo === 'comparar' && fechaInicioComparacion && fechaFinComparacion) {
          const [periodA, periodB] = await Promise.all([
            calcularPrecision(startDate, endDate),
            calcularPrecision(fechaInicioComparacion, fechaFinComparacion)
          ]);

          res.send({
            success: true,
            data: {
              periodA: {
                fechaInicio: startDate,
                fechaFin: endDate,
                metricas: periodA[0]
              },
              periodB: {
                fechaInicio: fechaInicioComparacion,
                fechaFin: fechaFinComparacion,
                metricas: periodB[0]
              },
              comparison: {
                mejora_precision: periodA[0].precision_porcentaje - periodB[0].precision_porcentaje,
                reduccion_discrepancia: periodB[0].discrepancia_promedio - periodA[0].discrepancia_promedio
              }
            },
            traceId: req.id
          });
        } else {
        const precision = await calcularPrecision(startDate, endDate);
          
          res.send({
            success: true,
            data: {
              fechaInicio: startDate,
              fechaFin: endDate,
              metricas: precision[0]
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

  // GET /v1/inventario/rotacion
  app.get('/rotacion', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin,
          categoria
        } = req.query as TimeNavigationParams & { categoria?: string };

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const daysSpan = Math.max(
          1,
          (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        const annualizationFactor = 365.0 / daysSpan;

        const categoryFilter = categoria ? Prisma.sql`AND p.category = ${categoria}` : Prisma.empty;

        const rotacion = await app.prisma.$queryRaw<RotationRow[]>`
          WITH ventas_periodo AS (
            SELECT 
              s.product_id,
              SUM(s.quantity * p.cost) as costo_vendido,
              SUM(s.quantity * s.uom_ratio) as unidades_vendidas
            FROM sales_partitioned s
            JOIN products p ON s.product_id = p.product_id
            WHERE s.sale_datetime >= ${startDate}::date
              AND s.sale_datetime <= ${endDate}::date
              AND NOT s.is_deleted
            GROUP BY s.product_id
          ),
          inventario_promedio AS (
            SELECT 
              i.product_id,
              AVG(i.quantity_on_hand * p.cost) as inventario_promedio_valor,
              AVG(i.quantity_on_hand) as inventario_promedio_unidades
            FROM inventory_snapshots i
            JOIN products p ON i.product_id = p.product_id
            WHERE i.snapshot_timestamp >= ${startDate}::date
              AND i.snapshot_timestamp <= ${endDate}::date
              AND NOT i.is_deleted
            GROUP BY i.product_id
          )
          SELECT 
            p.product_id,
            p.sku,
            p.product_name,
            p.category,
            COALESCE(v.costo_vendido, 0) as costo_vendido,
            COALESCE(i.inventario_promedio_valor, 0) as inventario_promedio,
            CASE 
              WHEN i.inventario_promedio_valor > 0 
              THEN (v.costo_vendido / i.inventario_promedio_valor) * ${annualizationFactor}
              ELSE 0
            END as rotacion_anualizada,
            CASE 
              WHEN v.unidades_vendidas > 0 
              THEN FLOOR(i.inventario_promedio_unidades / (v.unidades_vendidas / ${daysSpan}))
              ELSE 999
            END as dias_inventario,
            CASE 
              WHEN (v.costo_vendido / NULLIF(i.inventario_promedio_valor, 0)) * ${annualizationFactor} > 12 THEN 'A - Alta rotación'
              WHEN (v.costo_vendido / NULLIF(i.inventario_promedio_valor, 0)) * ${annualizationFactor} > 4 THEN 'B - Media rotación'
              ELSE 'C - Baja rotación'
            END as clasificacion
          FROM products p
          LEFT JOIN ventas_periodo v ON p.product_id = v.product_id
          LEFT JOIN inventario_promedio i ON p.product_id = i.product_id
          WHERE NOT p.is_deleted
            ${categoryFilter}
          ORDER BY rotacion_anualizada DESC
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            categoria,
            rotacion
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

  // GET /v1/inventario/obsolescencia
  app.get('/obsolescencia', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        const obsoletos = await app.prisma.$queryRaw<ObsolescenceRow[]>`
          WITH ultima_venta AS (
            SELECT 
              product_id,
              MAX(sale_datetime) as ultima_fecha_venta
            FROM sales_partitioned
            WHERE NOT is_deleted
            GROUP BY product_id
          ),
          inventario_actual AS (
            SELECT DISTINCT ON (product_id)
              product_id,
              quantity_on_hand
            FROM inventory_snapshots
            WHERE snapshot_timestamp <= ${checkDate}::date
              AND NOT is_deleted
            ORDER BY product_id, snapshot_timestamp DESC
          )
          SELECT 
            p.product_id,
            p.sku,
            p.product_name,
            COALESCE(i.quantity_on_hand, 0) as quantity_on_hand,
            v.ultima_fecha_venta as ultima_venta,
            COALESCE(
              EXTRACT(DAY FROM ${checkDate}::date - v.ultima_fecha_venta),
              999
            ) as dias_sin_venta,
            COALESCE(i.quantity_on_hand * p.cost, 0) as valor_obsoleto,
            CASE 
              WHEN v.ultima_fecha_venta IS NULL THEN 'muy_alto'
              WHEN EXTRACT(DAY FROM ${checkDate}::date - v.ultima_fecha_venta) > 180 THEN 'alto'
              WHEN EXTRACT(DAY FROM ${checkDate}::date - v.ultima_fecha_venta) > 90 THEN 'medio'
              ELSE 'bajo'
            END as riesgo
          FROM products p
          LEFT JOIN ultima_venta v ON p.product_id = v.product_id
          LEFT JOIN inventario_actual i ON p.product_id = i.product_id
          WHERE NOT p.is_deleted
            AND i.quantity_on_hand > 0
            AND (
              v.ultima_fecha_venta IS NULL 
              OR EXTRACT(DAY FROM ${checkDate}::date - v.ultima_fecha_venta) > 90
            )
          ORDER BY dias_sin_venta DESC
        `;

        res.send({
          success: true,
          data: {
            fechaAnalisis: checkDate,
            obsoletos
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
