import ExcelJS from 'exceljs';
import { formatDateSpanish, formatCurrency } from '../utils/formatter';

interface ChartSection {
  data: Array<Record<string, unknown>>;
}

interface TableSection {
  data: Array<Record<string, unknown>>;
}

interface ExportPayload {
  kpis?: ExportKpi[];
  alerts?: ExportAlert[];
  charts?: Record<string, ChartSection>;
  tables?: Record<string, TableSection>;
}

interface CompareMode {
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}

interface ExportKpi {
  name: string;
  value?: number | null;
  target?: number | null;
  unit: string;
  trend?: string;
}

interface ExportAlert {
  type: string;
  message: string;
  severity: string;
  actionRequired: boolean;
  impact?: number | null;
}

export class ExcelGenerator {
  static async generate(
    data: ExportPayload,
    role: string,
    dateRange: { start: string; end: string },
    compareMode?: CompareMode
  ): Promise<Buffer> {

    const workbook = new ExcelJS.Workbook();
    
    // Set workbook properties
    workbook.creator = 'AI Refill';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Add Summary sheet
    this.addSummarySheet(workbook, role, dateRange, compareMode);

    // Add KPIs sheet
    if (data.kpis && data.kpis.length > 0) {
      this.addKPIsSheet(workbook, data.kpis);
    }

    // Add Alerts sheet
    if (data.alerts && data.alerts.length > 0) {
      this.addAlertsSheet(workbook, data.alerts);
    }

    // Add Charts data sheets
    if (data.charts) {
      Object.entries(data.charts).forEach(([chartKey, chart]) => {
        if (chart.data && chart.data.length > 0) {
          this.addChartSheet(workbook, chartKey, chart.data);
        }
      });
    }

    // Add Tables sheets
    if (data.tables) {
      Object.entries(data.tables).forEach(([tableKey, table]) => {
        if (table.data && table.data.length > 0) {
          this.addTableSheet(workbook, tableKey, table.data);
        }
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    
    return Buffer.from(buffer);
  }

  private static addSummarySheet(
    workbook: ExcelJS.Workbook,
    role: string,
    dateRange: { start: string; end: string },
    compareMode?: CompareMode
  ): void {
    const sheet = workbook.addWorksheet('Resumen', {
      properties: { tabColor: { argb: 'FF3B82F6' } }
    });

    // Title
    sheet.mergeCells('A1:D1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `Reporte ${role}`;
    titleCell.font = { size: 18, bold: true, color: { argb: 'FF3B82F6' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 30;

    // Date info
    let row = 3;
    if (compareMode) {
      sheet.getCell(`A${row}`).value = 'Período A:';
      sheet.getCell(`B${row}`).value = `${formatDateSpanish(new Date(compareMode.periodA.start))} a ${formatDateSpanish(new Date(compareMode.periodA.end))}`;
      row++;
      sheet.getCell(`A${row}`).value = 'Período B:';
      sheet.getCell(`B${row}`).value = `${formatDateSpanish(new Date(compareMode.periodB.start))} a ${formatDateSpanish(new Date(compareMode.periodB.end))}`;
    } else {
      sheet.getCell(`A${row}`).value = 'Período:';
      sheet.getCell(`B${row}`).value = `${formatDateSpanish(new Date(dateRange.start))} a ${formatDateSpanish(new Date(dateRange.end))}`;
    }
    
    row += 2;
    sheet.getCell(`A${row}`).value = 'Generado el:';
    sheet.getCell(`B${row}`).value = formatDateSpanish(new Date());

    // Style date section
    for (let i = 3; i <= row; i++) {
      sheet.getCell(`A${i}`).font = { bold: true };
      sheet.getCell(`A${i}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' }
      };
    }

    // Column widths
    sheet.getColumn('A').width = 20;
    sheet.getColumn('B').width = 40;
  }

  private static addKPIsSheet(workbook: ExcelJS.Workbook, kpis: ExportKpi[]): void {
    const sheet = workbook.addWorksheet('KPIs', {
      properties: { tabColor: { argb: 'FF10B981' } }
    });

    // Headers
    sheet.columns = [
      { header: 'Indicador', key: 'name', width: 30 },
      { header: 'Valor', key: 'value', width: 15 },
      { header: 'Meta', key: 'target', width: 15 },
      { header: 'Unidad', key: 'unit', width: 15 },
      { header: 'Tendencia', key: 'trend', width: 12 }
    ];

    // Style headers
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3B82F6' }
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data
    kpis.forEach(kpi => {
      const row = sheet.addRow({
        name: kpi.name,
        value: this.formatValue(kpi.value, kpi.unit),
        target: this.formatValue(kpi.target, kpi.unit),
        unit: this.getUnitLabel(kpi.unit),
        trend: kpi.trend === 'up' ? '↑' : kpi.trend === 'down' ? '↓' : '→'
      });

      // Color trend
      const trendCell = row.getCell('trend');
      if (kpi.trend === 'up') {
        trendCell.font = { color: { argb: 'FF10B981' }, bold: true };
      } else if (kpi.trend === 'down') {
        trendCell.font = { color: { argb: 'FFEF4444' }, bold: true };
      }
    });

    // Auto-filter
    sheet.autoFilter = {
      from: 'A1',
      to: `E${kpis.length + 1}`
    };
  }

  private static addAlertsSheet(workbook: ExcelJS.Workbook, alerts: ExportAlert[]): void {
    const sheet = workbook.addWorksheet('Alertas', {
      properties: { tabColor: { argb: 'FFFBBF24' } }
    });

    // Headers
    sheet.columns = [
      { header: 'Tipo', key: 'type', width: 25 },
      { header: 'Mensaje', key: 'message', width: 50 },
      { header: 'Severidad', key: 'severity', width: 15 },
      { header: 'Acción Requerida', key: 'actionRequired', width: 18 },
      { header: 'Impacto', key: 'impact', width: 15 }
    ];

    // Style headers
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3B82F6' }
    };

    // Add data
    alerts.forEach(alert => {
      const row = sheet.addRow({
        type: alert.type,
        message: alert.message,
        severity: alert.severity,
        actionRequired: alert.actionRequired ? 'Sí' : 'No',
        impact: formatCurrency(alert.impact || 0)
      });

      // Color by severity
      if (alert.severity === 'critical' || alert.severity === 'CRITICAL') {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' }
        };
      } else if (alert.severity === 'warning' || alert.severity === 'WARNING') {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' }
        };
      }
    });
  }

  private static addChartSheet(
    workbook: ExcelJS.Workbook,
    chartKey: string,
    chartData: Array<Record<string, unknown>>
  ): void {
    const sheetName = this.getChartTitle(chartKey).substring(0, 31); // Excel limit
    const sheet = workbook.addWorksheet(sheetName, {
      properties: { tabColor: { argb: 'FF8B5CF6' } }
    });

    if (chartData.length === 0) return;

    // Get headers from first row
    const headers = Object.keys(chartData[0]);
    
    // Add headers
    sheet.addRow(headers);
    
    // Style headers
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3B82F6' }
    };

    // Add data
    chartData.forEach(row => {
      const values = headers.map(h => this.formatCellValue(row[h]));
      sheet.addRow(values);
    });

    // Auto-fit columns
    sheet.columns.forEach(column => {
      column.width = 15;
    });

    // Auto-filter
    sheet.autoFilter = {
      from: 'A1',
      to: `${String.fromCharCode(64 + headers.length)}${chartData.length + 1}`
    };
  }

  private static addTableSheet(
    workbook: ExcelJS.Workbook,
    tableKey: string,
    tableData: Array<Record<string, unknown>>
  ): void {
    const sheetName = tableKey.substring(0, 31); // Excel limit
    const sheet = workbook.addWorksheet(sheetName);

    if (tableData.length === 0) return;

    // Get headers
    const headers = Object.keys(tableData[0]);
    
    // Add headers
    sheet.addRow(headers);
    
    // Style headers
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3B82F6' }
    };

    // Add data
    tableData.forEach(row => {
      const values = headers.map(h => this.formatCellValue(row[h]));
      sheet.addRow(values);
    });

    // Auto-fit columns
    sheet.columns.forEach(column => {
      column.width = 15;
    });
  }

  private static getChartTitle(chartKey: string): string {
    const titles: { [key: string]: string } = {
      salesTrend: 'Tendencia Ventas',
      salesForecast: 'Pronóstico Ventas',
      topProducts: 'Top Productos',
      topCustomers: 'Top Clientes',
      categoryBreakdown: 'Por Categoría',
      revenueTrend: 'Tendencia Ingresos',
      profitTrend: 'Tendencia Rentabilidad',
      costBreakdown: 'Desglose Costos',
    };
    return titles[chartKey] || chartKey;
  }

  private static formatValue(value: number | null | undefined, unit: string): number | string {
    if (value === null || value === undefined) return '-';
    
    switch (unit) {
      case 'currency':
        return value; // Keep as number for Excel
      case 'percentage':
        return value / 100; // Excel percentage format
      default:
        return value;
    }
  }

  private static formatCellValue(value: unknown): string | number {
    if (value === null || value === undefined) return '-';
    if (value instanceof Date) return formatDateSpanish(value);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return JSON.stringify(value);
  }

  private static getUnitLabel(unit: string): string {
    const labels: { [key: string]: string } = {
      currency: 'Quetzales',
      percentage: 'Porcentaje',
      number: 'Unidades',
      days: 'Días'
    };
    return labels[unit] || unit;
  }
}