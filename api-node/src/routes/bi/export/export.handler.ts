import type { FastifyRequest, FastifyReply } from 'fastify';
import { PDFGenerator } from './generators/pdf.generator';
import { ExcelGenerator } from './generators/excel.generator';
import { CSVGenerator } from './generators/csv.generator';
import { SectionMapper, DashboardSection } from './utils/section-mapper';
import { formatFileName, CompareMode } from './utils/formatter';
import type { Dashboard } from '../types';

interface ExportRequest {
  format: 'pdf' | 'excel' | 'csv';
  sections: DashboardSection[];
  dateRange: {
    start: string;
    end: string;
  };
  compareMode?: CompareMode;
  role: string;
}

interface ExportUser {
  username: string;
  id: number;
}

type FilteredData = Partial<Dashboard> & { periodB?: Partial<Dashboard>; compareMode?: boolean };

/**
 * Maps FilteredData (Partial<Dashboard>) to the shape each generator expects:
 * - ensures alerts.actionRequired is always boolean (DashboardAlert has it optional)
 * - extracts chart data arrays from ChartConfig wrappers
 * - wraps table rows in { data: [...] } to match generator TableSection shape
 */
function toExportPayload(data: FilteredData) {
  return {
    kpis: data.kpis,
    alerts: data.alerts?.map(a => ({ ...a, actionRequired: a.actionRequired ?? false })),
    charts: data.charts
      ? Object.fromEntries(
          Object.entries(data.charts).map(([k, chart]) => [
            k,
            { data: ((chart as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>> },
          ])
        )
      : undefined,
    tables: data.tables
      ? Object.fromEntries(
          Object.entries(data.tables).map(([k, rows]) => [k, { data: rows }])
        )
      : undefined,
  };
}

export class ExportHandler {
  static async handleExport(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as ExportRequest;
      const { format, sections, dateRange, compareMode, role } = body;

      // Validate request
      if (!format || !sections || !dateRange || !role) {
        return reply.status(400).send({
          success: false,
          error: 'Faltan campos requeridos: format, sections, dateRange, role'
        });
      }

      // Get user from JWT (already attached by auth middleware)
      const user = (req as FastifyRequest & { user?: ExportUser }).user;

      if (!user) {
        return reply.status(401).send({
          success: false,
          error: 'Usuario no autenticado'
        });
      }
      
      req.log.info(`[EXPORT] User ${user.username} requesting ${format} export for ${role}`);
      req.log.info(`[EXPORT] Sections: ${sections.join(', ')}`);
      req.log.info(`[EXPORT] Date range: ${dateRange.start} to ${dateRange.end}`);

      // Fetch dashboard data for the specified role and date range
      const dashboardData = await SectionMapper.fetchDashboardData(
        req.server,
        role,
        dateRange.start,
        dateRange.end,
        compareMode
      );

      // Filter data based on selected sections, then adapt to generator shape
      const filteredData = SectionMapper.filterSections(dashboardData, sections);
      const exportPayload = toExportPayload(filteredData);

      // Generate file based on format
      let buffer: Buffer;
      let contentType: string;
      let fileName: string;

      switch (format) {
        case 'pdf':
          buffer = await PDFGenerator.generate(exportPayload, role, dateRange, compareMode);
          contentType = 'application/pdf';
          fileName = formatFileName(role, dateRange, compareMode, 'pdf');
          break;

        case 'excel':
          buffer = await ExcelGenerator.generate(exportPayload, role, dateRange, compareMode);
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          fileName = formatFileName(role, dateRange, compareMode, 'xlsx');
          break;

        case 'csv':
          buffer = await CSVGenerator.generate(exportPayload, role, dateRange, compareMode);
          contentType = 'application/zip';
          fileName = formatFileName(role, dateRange, compareMode, 'zip');
          break;

        default:
          return reply.status(400).send({
            success: false,
            error: 'Formato inválido. Debe ser pdf, excel o csv'
          });
      }

      req.log.info(`[EXPORT] Generated ${format} file: ${fileName} (${buffer.length} bytes)`);

      // Send file
      reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Content-Length', buffer.length)
        .send(buffer);

    } catch (error) {
      req.log.error({ err: error }, '[EXPORT] Error:');
      reply.status(500).send({
        success: false,
        error: 'Error al generar exportación',
        details: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }
}