import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate, requirePermissions } from '../middleware/auth';
interface PerformanceRow {
  periodo: Date;
  modelo: string;
  tipo_forecast: string;
  mape: number;
  rmse: number;
  forecast_count: number;
  accuracy_score: number;
}

interface QualityRow {
  tabla: string;
  registros_totales: number;
  registros_completos: number;
  completitud: number;
  duplicados: number;
  anomalias: number;
  ultima_actualizacion: Date;
}

interface PipelineRow {
  last_run: Date;
  last_status: string;
  records_processed: number;
  processing_time_minutes: number;
}

interface ApiUsageRow {
  total_requests: number;
  avg_response_time_ms: number;
  error_rate: number;
  unique_users: number;
}

interface DbMetricRow {
  table_name: string;
  row_count: bigint;
  size_mb: string;
}

interface ModelConfigRow {
  model_id: string;
  model_name: string;
  model_type: string;
  hyperparameters: Record<string, unknown>;
  is_active: boolean;
  last_trained: Date;
  next_training: Date;
}

interface ThresholdRow {
  alert_type: string;
  threshold_name: string;
  threshold_value: number;
  unit: string;
}

interface AuditRow {
  log_id: number;
  table_name: string;
  record_id: number;
  action: string;
  changed_by: number;
  changed_by_username: string;
  changed_at: Date;
  changes_summary: string;
}

export const superuserRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/superuser/modelo-performance
  app.get('/modelo-performance', {
    onRequest: [authenticate, requirePermissions('SUPERUSER')],
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
          diario: Prisma.raw("DATE(f.forecast_date)"),
          semanal: Prisma.raw("DATE_TRUNC('week', f.forecast_date)"),
          mensual: Prisma.raw("DATE_TRUNC('month', f.forecast_date)"),
          anual: Prisma.raw("DATE_TRUNC('year', f.forecast_date)")
        }[granularidad];

        const performance = await app.prisma.$queryRaw<PerformanceRow[]>`
          SELECT 
            ${dateGroup} as periodo,
            f.model_name as modelo,
            f.forecast_type as tipo_forecast,
            AVG(ABS((a.actual_value - f.predicted_value) / NULLIF(a.actual_value, 0)) * 100) as mape,
            SQRT(AVG(POWER(a.actual_value - f.predicted_value, 2))) as rmse,
            COUNT(*) as forecast_count,
            AVG(1 - ABS(a.actual_value - f.predicted_value) / NULLIF(a.actual_value, 0)) * 100 as accuracy_score
          FROM forecasts f
          LEFT JOIN actuals a ON f.product_id = a.product_id 
            AND f.forecast_date = a.actual_date
            AND f.forecast_type = a.metric_type
          WHERE f.forecast_date >= ${startDate}::date
            AND f.forecast_date <= ${endDate}::date
            AND a.actual_value IS NOT NULL
          GROUP BY periodo, f.model_name, f.forecast_type
          ORDER BY periodo, modelo, tipo_forecast
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            granularidad,
            performance
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

  // GET /v1/superuser/data-quality
  app.get('/data-quality', {
    onRequest: [authenticate, requirePermissions('SUPERUSER')],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin 
        } = req.query as TimeNavigationParams;

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const quality = await app.prisma.$queryRaw<QualityRow[]>`
          WITH data_stats AS (
            SELECT 
              'sales_partitioned' as tabla,
              COUNT(*) as registros_totales,
              COUNT(CASE WHEN product_id IS NOT NULL 
                AND client_id IS NOT NULL 
                AND quantity IS NOT NULL 
                AND unit_price IS NOT NULL THEN 1 END) as registros_completos,
              COUNT(DISTINCT (product_id, client_id, sale_datetime, quantity)) as unicos,
              MAX(sale_datetime) as ultima_actualizacion
            FROM sales_partitioned
            WHERE sale_datetime >= ${startDate}::date
              AND sale_datetime <= ${endDate}::date
              AND NOT is_deleted
            
            UNION ALL
            
            SELECT 
              'inventory_snapshots' as tabla,
              COUNT(*) as registros_totales,
              COUNT(CASE WHEN product_id IS NOT NULL 
                AND quantity_on_hand IS NOT NULL THEN 1 END) as registros_completos,
              COUNT(DISTINCT (product_id, snapshot_timestamp)) as unicos,
              MAX(snapshot_timestamp) as ultima_actualizacion
            FROM inventory_snapshots
            WHERE snapshot_timestamp >= ${startDate}::date
              AND snapshot_timestamp <= ${endDate}::date
              AND NOT is_deleted
              
            UNION ALL
            
            SELECT 
              'purchases' as tabla,
              COUNT(*) as registros_totales,
              COUNT(CASE WHEN product_id IS NOT NULL 
                AND quantity IS NOT NULL 
                AND unit_cost IS NOT NULL THEN 1 END) as registros_completos,
              COUNT(DISTINCT (product_id, purchase_datetime, quantity)) as unicos,
              MAX(purchase_datetime) as ultima_actualizacion
            FROM purchases
            WHERE purchase_datetime >= ${startDate}::date
              AND purchase_datetime <= ${endDate}::date
              AND NOT is_deleted
          )
          SELECT 
            tabla,
            registros_totales,
            registros_completos,
            ROUND(registros_completos * 100.0 / NULLIF(registros_totales, 0), 2) as completitud,
            registros_totales - unicos as duplicados,
            0 as anomalias, -- Placeholder para lógica de detección de anomalías
            ultima_actualizacion
          FROM data_stats
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            calidad_datos: quality
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

  // GET /v1/superuser/sistema-health
  app.get('/sistema-health', {
    onRequest: [authenticate, requirePermissions('SUPERUSER')],
    handler: async (req, res) => {
      try {
        const { fechaFin } = req.query as TimeNavigationParams;
        const checkDate = fechaFin || new Date().toISOString().split('T')[0];

        // Estado del pipeline
        const pipeline = await app.prisma.$queryRaw<PipelineRow[]>`
          SELECT 
            run_timestamp as last_run,
            status as last_status,
            records_processed,
            EXTRACT(EPOCH FROM (completed_at - started_at))/60 as processing_time_minutes
          FROM pipeline_runs
          WHERE run_timestamp <= ${checkDate}::date + INTERVAL '1 day'
          ORDER BY run_timestamp DESC
          LIMIT 1
        `;

        // Uso de API
        const apiUsage = await app.prisma.$queryRaw<ApiUsageRow[]>`
          SELECT 
            COUNT(*) as total_requests,
            AVG(response_time_ms) as avg_response_time_ms,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as error_rate,
            COUNT(DISTINCT user_id) as unique_users
          FROM api_logs
          WHERE request_timestamp >= ${checkDate}::date - INTERVAL '24 hours'
            AND request_timestamp <= ${checkDate}::date + INTERVAL '1 day'
        `;

        // Métricas de base de datos
        const dbMetrics = await app.prisma.$queryRaw<DbMetricRow[]>`
          SELECT 
            schemaname || '.' || tablename as table_name,
            n_live_tup as row_count,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))::text as size_mb
          FROM pg_stat_user_tables
          WHERE schemaname = 'public'
          ORDER BY n_live_tup DESC
          LIMIT 10
        `;

        res.send({
          success: true,
          data: {
            fechaAnalisis: checkDate,
            pipeline: pipeline[0] || {
              last_run: null,
              last_status: 'No ejecutado',
              records_processed: 0,
              processing_time_minutes: 0
            },
            api_usage: apiUsage[0] || {
              total_requests: 0,
              avg_response_time_ms: 0,
              error_rate: 0,
              unique_users: 0
            },
            database: {
              tables: dbMetrics,
              total_size_mb: dbMetrics.reduce((sum, t) => sum + parseFloat(t.size_mb.toString() || '0'), 0)
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

  // GET /v1/superuser/configuracion-modelos
  app.get('/configuracion-modelos', {
    onRequest: [authenticate, requirePermissions('SUPERUSER')],
    handler: async (req, res) => {
      try {
        // Configuración actual de modelos
        const modelos = await app.prisma.$queryRaw<ModelConfigRow[]>`
          SELECT 
            model_id,
            model_name,
            model_type,
            hyperparameters,
            is_active,
            last_trained_at as last_trained,
            last_trained_at + training_frequency_days * INTERVAL '1 day' as next_training
          FROM ml_models
          WHERE is_active = true
          ORDER BY model_type, model_name
        `;

        // Umbrales de alertas
        const umbrales = await app.prisma.$queryRaw<ThresholdRow[]>`
          SELECT 
            alert_type,
            threshold_name,
            threshold_value,
            unit
          FROM alert_thresholds
          WHERE is_active = true
          ORDER BY alert_type, threshold_name
        `;

        res.send({
          success: true,
          data: {
            modelos,
            umbrales
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

  // GET /v1/superuser/auditoria
  app.get('/auditoria', {
    onRequest: [authenticate, requirePermissions('SUPERUSER')],
    handler: async (req, res) => {
      try {
        const { 
          fechaInicio, 
          fechaFin,
          tabla,
          usuario
        } = req.query as TimeNavigationParams & { tabla?: string; usuario?: string };

        const endDate = fechaFin || new Date().toISOString().split('T')[0];
        const startDate = fechaInicio || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const tableFilter = tabla ? Prisma.sql`AND table_name = ${tabla}` : Prisma.empty;
        const userFilter = usuario ? Prisma.sql`AND changed_by = ${Number(usuario)}` : Prisma.empty;

        const auditLogs = await app.prisma.$queryRaw<AuditRow[]>`
          SELECT 
            a.log_id,
            a.table_name,
            a.record_id,
            a.action,
            a.changed_by,
            u.username as changed_by_username,
            a.changed_at,
            CASE 
              WHEN a.action = 'INSERT' THEN 'Nuevo registro creado'
              WHEN a.action = 'UPDATE' THEN 
                'Campos modificados: ' || (
                  SELECT string_agg(key, ', ')
                  FROM jsonb_each(a.old_values) o
                  WHERE o.value IS DISTINCT FROM (a.new_values->key)
                )
              WHEN a.action = 'SOFT_DELETE' THEN 'Registro eliminado'
            END as changes_summary
          FROM audit_logs a
          LEFT JOIN users u ON a.changed_by = u.user_id
            WHERE changed_at >= ${startDate}::date AND changed_at <= ${endDate}::date + INTERVAL '1 day'
            ${tableFilter}
            ${userFilter}
          ORDER BY a.changed_at DESC
          LIMIT 100
        `;

        res.send({
          success: true,
          data: {
            fechaInicio: startDate,
            fechaFin: endDate,
            filtros: { tabla, usuario },
            registros_auditoria: auditLogs
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