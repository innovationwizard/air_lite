import archiver from 'archiver';
import { formatDateSpanish, formatCurrency, formatNumber } from '../utils/formatter';

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

interface ExportKpi {
  name: string;
  value: number | null | undefined;
  target?: number | null;
  unit: string;
  trend?: string;
}

interface ExportAlert {
  type: string;
  message: string;
  severity: string;
  actionRequired: boolean;
  impact?: number;
}

interface CompareMode {
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}

export class CSVGenerator {
  static async generate(
    data: ExportPayload,
    role: string,
    dateRange: { start: string; end: string },
    compareMode?: CompareMode
  ): Promise<Buffer> {

    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      archive.on('error', reject);

      // Add metadata file
      const metadata = this.generateMetadata(role, dateRange, compareMode);
      archive.append(metadata, { name: '_metadata.txt' });

      // Add KPIs CSV
      const metrics: ExportKpi[] = data.kpis ?? [];
      if (metrics.length > 0) {
        const kpisCSV = this.kpisToCSV(metrics);
        archive.append(kpisCSV, { name: 'kpis.csv' });
      }

      // Add Alerts CSV
      const alerts: ExportAlert[] = data.alerts ?? [];
      if (alerts.length > 0) {
        const alertsCSV = this.alertsToCSV(alerts);
        archive.append(alertsCSV, { name: 'alertas.csv' });
      }

      // Add Charts CSVs
      if (data.charts) {
        Object.entries(data.charts).forEach(([chartKey, chart]) => {
          if (chart.data && chart.data.length > 0) {
            const csv = this.dataToCSV(chart.data);
            archive.append(csv, { name: `${chartKey}.csv` });
          }
        });
      }

      // Add Tables CSVs
      if (data.tables) {
        Object.entries(data.tables).forEach(([tableKey, table]) => {
          if (table.data && table.data.length > 0) {
            const csv = this.dataToCSV(table.data);
            archive.append(csv, { name: `${tableKey}.csv` });
          }
        });
      }

      void archive.finalize();
    });
  }

  private static generateMetadata(
    role: string,
    dateRange: { start: string; end: string },
    compareMode?: CompareMode
  ): string {
    let metadata = `AI Refill - Reporte ${role}\n`;
    metadata += `Generado: ${formatDateSpanish(new Date())}\n\n`;
    
    if (compareMode) {
      metadata += `Período A: ${formatDateSpanish(new Date(compareMode.periodA.start))} a ${formatDateSpanish(new Date(compareMode.periodA.end))}\n`;
      metadata += `Período B: ${formatDateSpanish(new Date(compareMode.periodB.start))} a ${formatDateSpanish(new Date(compareMode.periodB.end))}\n`;
    } else {
      metadata += `Período: ${formatDateSpanish(new Date(dateRange.start))} a ${formatDateSpanish(new Date(dateRange.end))}\n`;
    }
    
    return metadata;
  }

  private static kpisToCSV(kpis: ExportKpi[]): string {
    let csv = 'Indicador,Valor,Meta,Unidad,Tendencia\n';
    
    kpis.forEach(kpi => {
      csv += `"${kpi.name}",`;
      csv += `${this.formatCSVValue(kpi.value, kpi.unit)},`;
      csv += `${this.formatCSVValue(kpi.target, kpi.unit)},`;
      csv += `"${kpi.unit}",`;
      csv += `"${kpi.trend}"\n`;
    });
    
    return csv;
  }

  private static alertsToCSV(alerts: ExportAlert[]): string {
    let csv = 'Tipo,Mensaje,Severidad,Acción Requerida,Impacto\n';
    
    alerts.forEach(alert => {
      csv += `"${alert.type}",`;
      csv += `"${this.escapeCSV(alert.message)}",`;
      csv += `"${alert.severity}",`;
      csv += `"${alert.actionRequired ? 'Sí' : 'No'}",`;
      csv += `${formatNumber(alert.impact || 0)}\n`;
    });
    
    return csv;
  }

  private static dataToCSV(data: Array<Record<string, unknown>>): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    let csv = headers.map(h => `"${h}"`).join(',') + '\n';

    data.forEach(row => {
      const values = headers.map(h => {
        const value = row[h];
        if (value === null || value === undefined) return '""';
        if (typeof value === 'string') return `"${this.escapeCSV(value)}"`;
        if (typeof value === 'number') return formatNumber(value);
        if (value instanceof Date) return `"${formatDateSpanish(value)}"`;
        const normalizedValue = JSON.stringify(value) ?? '';
        return `"${this.escapeCSV(normalizedValue)}"`;
      });
      csv += values.join(',') + '\n';
    });

    return csv;
  }

  private static formatCSVValue(value: number | null | undefined, unit: string): string {
    if (value === null || value === undefined) return '';
    
    switch (unit) {
      case 'currency':
        return formatCurrency(value).replace(/,/g, ''); // Remove thousands separator for CSV
      case 'percentage':
        return `${formatNumber(value)}%`;
      default:
        return formatNumber(value);
    }
  }

  private static escapeCSV(str: string): string {
    return str.replace(/"/g, '""');
  }
}