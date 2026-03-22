import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
}

interface ChartSection {
  data: Array<Record<string, unknown>>;
}

interface ExportPayload {
  kpis?: ExportKpi[];
  alerts?: ExportAlert[];
  charts?: Record<string, ChartSection>;
}

interface CompareMode {
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}

export class PDFGenerator {
  static async generate(
    data: ExportPayload,
    role: string,
    dateRange: { start: string; end: string },
    compareMode?: CompareMode
  ): Promise<Buffer> {
    const doc = new jsPDF();
    let yPosition = 20;

    // Header
    doc.setFontSize(20);
    doc.setTextColor(59, 130, 246);
    doc.text(`Reporte ${role}`, 20, yPosition);
    yPosition += 10;

    // Date range
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    if (compareMode) {
      doc.text(
        `Período A: ${dateRange.start} a ${compareMode.periodA.end}`,
        20,
        yPosition
      );
      yPosition += 5;
      doc.text(
        `Período B: ${compareMode.periodB.start} a ${dateRange.end}`,
        20,
        yPosition
      );
    } else {
      doc.text(`Período: ${dateRange.start} a ${dateRange.end}`, 20, yPosition);
    }
    yPosition += 10;

    // KPIs Section
    const kpis = data.kpis ?? [];
    if (kpis.length > 0) {
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Indicadores Clave (KPIs)', 20, yPosition);
      yPosition += 8;

      const kpiData = kpis.map((kpi: ExportKpi) => [
        kpi.name,
        this.formatValue(kpi.value ?? null, kpi.unit),
        this.formatValue(kpi.target ?? null, kpi.unit),
        kpi.trend || '-'
      ]);

      autoTable(doc, {
        startY: yPosition,
        head: [['Indicador', 'Valor', 'Meta', 'Tendencia']],
        body: kpiData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 9 }
      });

      const lastTable = this.getLastAutoTable(doc);
      yPosition = (lastTable?.finalY ?? yPosition) + 10;
    }

    // Alerts Section
    const alerts = data.alerts ?? [];
    if (alerts.length > 0) {
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(14);
      doc.text('Alertas', 20, yPosition);
      yPosition += 8;

      const alertData = alerts.map((alert: ExportAlert) => [
        alert.type,
        alert.message,
        alert.severity,
        alert.actionRequired ? 'Sí' : 'No'
      ]);

      autoTable(doc, {
        startY: yPosition,
        head: [['Tipo', 'Mensaje', 'Severidad', 'Acción']],
        body: alertData,
        theme: 'grid',
        headStyles: { fillColor: [239, 68, 68] },
        styles: { fontSize: 8 }
      });

      const lastTable = this.getLastAutoTable(doc);
      yPosition = (lastTable?.finalY ?? yPosition) + 10;
    }

    // Charts Section (as tables)
    if (data.charts) {
      Object.entries(data.charts).forEach(([chartKey, chart]) => {
        if (!chart?.data || chart.data.length === 0) return;

        if (yPosition > 250) {
          doc.addPage();
          yPosition = 20;
        }

        doc.setFontSize(12);
        doc.text(this.getChartTitle(chartKey), 20, yPosition);
        yPosition += 6;

        const headers = Object.keys(chart.data[0]);
        const tableData = chart.data.slice(0, 10).map(row =>
          headers.map(h => this.formatCellValue(row[h]))
        );

        autoTable(doc, {
          startY: yPosition,
          head: [headers],
          body: tableData,
          theme: 'striped',
          headStyles: { fillColor: [59, 130, 246] },
          styles: { fontSize: 8 }
        });

        const lastTable = this.getLastAutoTable(doc);
        yPosition = (lastTable?.finalY ?? yPosition) + 10;
      });
    }

    // Footer
    const pageCount = this.getPageCount(doc);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text(
        `Página ${i} de ${pageCount} - Generado el ${new Date().toLocaleDateString('es-GT')}`,
        20,
        this.getPageHeight(doc) - 10
      );
    }

    const arrayBuffer = (await Promise.resolve(doc.output('arraybuffer'))) as ArrayBuffer;
    return Buffer.from(arrayBuffer);
  }

  private static getLastAutoTable(doc: jsPDF): { finalY: number } | undefined {
    return (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  }

  private static formatValue(value: number | null | undefined, unit: string): string {
    if (value === null || value === undefined) return '-';
    switch (unit) {
      case 'currency':
        return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(value);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      default:
        return new Intl.NumberFormat('es-GT').format(value);
    }
  }

  private static formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      if (value > 1000) return new Intl.NumberFormat('es-GT').format(Math.round(value));
      return value.toFixed(2);
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return JSON.stringify(value);
  }

  private static getChartTitle(key: string): string {
    const titles: { [key: string]: string } = {
      salesTrend: 'Tendencia de Ventas',
      topProducts: 'Productos Principales',
      topCustomers: 'Clientes Principales',
      categoryBreakdown: 'Distribución por Categoría',
    };
    return titles[key] || key;
  }

  private static getPageCount(doc: jsPDF): number {
    return doc.internal.getNumberOfPages();
  }

  private static getPageHeight(doc: jsPDF): number {
    return doc.internal.pageSize.height;
  }
}