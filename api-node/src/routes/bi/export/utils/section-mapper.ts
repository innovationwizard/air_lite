import type { AppWithPrisma, Dashboard } from '../../types';
import { VentasDashboard } from '../../dashboards/ventas.dashboard';
import { GerenciaDashboard } from '../../dashboards/gerencia.dashboard';
import { FinanzasDashboard } from '../../dashboards/finanzas.dashboard';
import { ComprasDashboard } from '../../dashboards/compras.dashboard';
import { InventarioDashboard } from '../../dashboards/inventario.dashboard';

export type { AppWithPrisma };

interface CompareMode {
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}

export type DashboardSection = 'kpis' | 'alerts' | 'charts' | 'tables';

export class SectionMapper {
  static async fetchDashboardData(
    app: AppWithPrisma,
    role: string,
    startDateStr: string,
    endDateStr: string,
    compareMode?: CompareMode
  ): Promise<Dashboard & { periodB?: Dashboard; compareMode?: boolean }> {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    app.log.info(`[SectionMapper] Fetching data for role: ${role}`);

    let dashboardData: Dashboard & { periodB?: Dashboard; compareMode?: boolean };

    switch (role) {
      case 'Ventas':
        dashboardData = await VentasDashboard.create(app, { startDate, endDate });
        break;
      case 'Gerencia':
        dashboardData = await GerenciaDashboard.create(app, { startDate, endDate });
        break;
      case 'Finanzas':
        dashboardData = await FinanzasDashboard.create(app, { startDate, endDate });
        break;
      case 'Compras':
        dashboardData = await ComprasDashboard.create(app, { startDate, endDate });
        break;
      case 'Inventario':
        dashboardData = await InventarioDashboard.create(app, { startDate, endDate });
        break;
      
      default:
        throw new Error(`Unknown role: ${role}`);
    }

    // If compare mode, fetch second period
    if (compareMode) {
      const periodBStart = new Date(compareMode.periodB.start);
      const periodBEnd = new Date(compareMode.periodB.end);
      
      let periodBData: Dashboard;
      
      switch (role) {
        case 'Ventas':
          periodBData = await VentasDashboard.create(app, { startDate: periodBStart, endDate: periodBEnd });
          break;
        case 'Gerencia':
          periodBData = await GerenciaDashboard.create(app, { startDate: periodBStart, endDate: periodBEnd });
          break;
        case 'Finanzas':
          periodBData = await FinanzasDashboard.create(app, { startDate: periodBStart, endDate: periodBEnd });
          break;
        case 'Compras':
          periodBData = await ComprasDashboard.create(app, { startDate: periodBStart, endDate: periodBEnd });
          break;
        case 'Inventario':
          periodBData = await InventarioDashboard.create(app, { startDate: periodBStart, endDate: periodBEnd });
          break;
      }

      // Merge both periods for comparison
      dashboardData = {
        ...dashboardData,
        periodB: periodBData,
        compareMode: true
      };
    }

    return dashboardData;
  }

  static filterSections(
    dashboardData: Dashboard & { periodB?: Dashboard; compareMode?: boolean },
    sections: DashboardSection[]
  ): Partial<Dashboard> & { periodB?: Partial<Dashboard>; compareMode?: boolean } {
    const filtered: Partial<Dashboard> & { periodB?: Partial<Dashboard>; compareMode?: boolean } = {
      role: dashboardData.role,
      title: dashboardData.title,
      lastUpdated: dashboardData.lastUpdated
    };

    const sectionSet = new Set(sections);

    if (sectionSet.has('kpis')) {
      filtered.kpis = dashboardData.kpis;
    }
    if (sectionSet.has('alerts')) {
      filtered.alerts = dashboardData.alerts;
    }
    if (sectionSet.has('charts')) {
      filtered.charts = dashboardData.charts;
    }
    if (sectionSet.has('tables')) {
      filtered.tables = dashboardData.tables;
    }

    if (dashboardData.compareMode && dashboardData.periodB) {
      filtered.periodB = {
        role: dashboardData.periodB.role,
        title: dashboardData.periodB.title,
        lastUpdated: dashboardData.periodB.lastUpdated
      };

      if (sectionSet.has('kpis')) {
        filtered.periodB.kpis = dashboardData.periodB.kpis;
      }
      if (sectionSet.has('alerts')) {
        filtered.periodB.alerts = dashboardData.periodB.alerts;
      }
      if (sectionSet.has('charts')) {
        filtered.periodB.charts = dashboardData.periodB.charts;
      }
      if (sectionSet.has('tables')) {
        filtered.periodB.tables = dashboardData.periodB.tables;
      }

      filtered.compareMode = true;
    }

    return filtered;
  }

  static getAvailableSections(role: string): DashboardSection[] {
    const sectionsByRole: { [key: string]: DashboardSection[] } = {
      'Ventas': ['kpis', 'alerts', 'charts', 'tables'],
      'Gerencia': ['kpis', 'alerts', 'charts', 'tables'],
      'Finanzas': ['kpis', 'alerts', 'charts', 'tables'],
      'Compras': ['kpis', 'alerts', 'charts', 'tables'],
      'Inventario': ['kpis', 'alerts', 'charts', 'tables']
    };

    return sectionsByRole[role] || [];
  }
}