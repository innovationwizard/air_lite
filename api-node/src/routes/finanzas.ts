import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate } from '../middleware/auth';interface KpiRow {
  kpi_name: string;
  kpi_value: string;
  period: string;
  created_at: Date;
}

interface KpiItem {
  key: string;
  value: number;
  period: string;
}

interface ComparisonEntry {
  key: string;
  valorActual: number;
  valorAnterior: number;
  delta: number;
  porcentajeCambio: number;
  tendencia: 'subida' | 'bajada' | 'sin_cambio';
}

export const finanzasRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/finanzas/kpis
  app.get('/kpis', {
    onRequest: [authenticate],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin, 
          granularidad = 'mensual',
          modo = 'individual',
          fechaInicioComparacion,
          fechaFinComparacion
        } = req.query as TimeNavigationParams;

        // Valores por defecto: últimos 30 días si no se especifica
        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Función helper para obtener KPIs de un período
        const obtenerKPIs = async (inicio: string, fin: string): Promise<KpiItem[]> => {
          // Primero intentamos obtener KPIs precalculados
          let kpis = await app.prisma.$queryRaw<KpiRow[]>`
            SELECT kpi_name, kpi_value, period, created_at 
            FROM kpis 
            WHERE created_at >= ${inicio}::date 
              AND created_at <= ${fin}::date
            ORDER BY created_at DESC
          `;

          // Si no hay KPIs precalculados, calculamos en tiempo real
          if (kpis.length === 0) {
            kpis = await calcularKPIsEnTiempoReal(app, inicio, fin);
          }

          return kpis.map((k) => ({
            key: k.kpi_name,
            value: parseFloat(k.kpi_value),
            period: k.period
          }));
        };

        // Modo comparar: obtener KPIs para ambos períodos
        if (modo === 'comparar' && fechaInicioComparacion && fechaFinComparacion) {
          const [periodA, periodB] = await Promise.all([
            obtenerKPIs(startDate, endDate),
            obtenerKPIs(fechaInicioComparacion, fechaFinComparacion)
          ]);

          // Calcular deltas
          const comparison = calcularComparacion(periodA, periodB);

          res.send({
            success: true,
            data: {
              periodA: {
                fechaInicio: startDate,
                fechaFin: endDate,
                kpis: periodA
              },
              periodB: {
                fechaInicio: fechaInicioComparacion,
                fechaFin: fechaFinComparacion,
                kpis: periodB
              },
              comparison
            },
            traceId: req.id
          });
        } else {
          // Modo individual o tendencia
          const kpis = await obtenerKPIs(startDate, endDate);
          
          res.send({
            success: true,
            data: {
              fechaInicio: startDate,
              fechaFin: endDate,
              granularidad,
              kpis
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
};

// Función helper para calcular KPIs en tiempo real cuando no existen precalculados
async function calcularKPIsEnTiempoReal(
  app: AppWithPrisma, 
  inicio: string, 
  fin: string
): Promise<KpiRow[]> {
  // Margen bruto
  const margenBruto = await app.prisma.$queryRaw<[{margin: number}]>`
    SELECT 
      COALESCE(
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) * 100,
        0
      ) as margin
    FROM sales_partitioned s
    JOIN products p ON s.product_id = p.product_id
    WHERE s.sale_datetime >= ${inicio}::date 
      AND s.sale_datetime <= ${fin}::date
      AND NOT s.is_deleted
      AND s.total_price > 0
  `;

  // Rotación de inventario
  const rotacion = await app.prisma.$queryRaw<[{turnover: number}]>`
    SELECT
      COALESCE(
        SUM(s.quantity * p.cost) / NULLIF(AVG(GREATEST(i.quantity_on_hand, 0) * p.cost), 0),
        0
      ) as turnover
    FROM sales_partitioned s
    JOIN products p ON s.product_id = p.product_id
    LEFT JOIN inventory_snapshots i ON i.product_id = s.product_id
    WHERE s.sale_datetime >= ${inicio}::date 
      AND s.sale_datetime <= ${fin}::date
      AND NOT s.is_deleted
  `;

  // Costo de mantenimiento
  const costoMantenimiento = await app.prisma.$queryRaw<[{holding_cost: number}]>`
    SELECT 
      COALESCE(
        SUM(GREATEST(i.quantity_on_hand, 0) * p.cost * 0.25 / 365), -- 25% anual / 365 días
        0
      ) as holding_cost
    FROM inventory_snapshots i
    JOIN products p ON i.product_id = p.product_id
    WHERE i.snapshot_timestamp >= ${inicio}::date 
      AND i.snapshot_timestamp <= ${fin}::date
      AND NOT i.is_deleted
  `;

  return [
    {
      kpi_name: 'gross_margin_percentage',
      kpi_value: margenBruto[0]?.margin?.toString() || '0',
      period: `${inicio} - ${fin}`,
      created_at: new Date()
    },
    {
      kpi_name: 'inventory_turnover',
      kpi_value: rotacion[0]?.turnover?.toString() || '0',
      period: `${inicio} - ${fin}`,
      created_at: new Date()
    },
    {
      kpi_name: 'holding_cost',
      kpi_value: costoMantenimiento[0]?.holding_cost?.toString() || '0',
      period: `${inicio} - ${fin}`,
      created_at: new Date()
    }
  ];
}

// Función para calcular comparaciones entre períodos
function calcularComparacion(periodA: KpiItem[], periodB: KpiItem[]): ComparisonEntry[] {
  return periodA.reduce<ComparisonEntry[]>((acc, kpiA) => {
    const kpiB = periodB.find((k) => k.key === kpiA.key);
    if (!kpiB) return acc;

    const delta = kpiA.value - kpiB.value;
    const porcentajeCambio = kpiB.value !== 0
      ? ((kpiA.value - kpiB.value) / kpiB.value) * 100
      : 0;

    acc.push({
      key: kpiA.key,
      valorActual: kpiA.value,
      valorAnterior: kpiB.value,
      delta,
      porcentajeCambio,
      tendencia: delta > 0 ? 'subida' : delta < 0 ? 'bajada' : 'sin_cambio'
    });

    return acc;
  }, []);
}