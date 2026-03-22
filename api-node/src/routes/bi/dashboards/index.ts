import type { AppWithPrisma, Dashboard, DashboardOptions } from '../types';
import { SuperuserDashboard } from './superuser.dashboard';
import { GerenciaDashboard } from './gerencia.dashboard';
import { FinanzasDashboard } from './finanzas.dashboard';
import { ComprasDashboard } from './compras.dashboard';
import { VentasDashboard } from './ventas.dashboard';
import { InventarioDashboard } from './inventario.dashboard';

export class DashboardFactory {
  static async createDashboard(
    app: AppWithPrisma,
    role: string,
    options?: DashboardOptions
  ): Promise<Dashboard> {
    app.log.info(`[DASHBOARD FACTORY] Creating dashboard for role: ${role}`);
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { startDate = thirtyDaysAgo, endDate = now } = options || {};

    try {
      switch (role) {
        case 'Superuser':
          return await SuperuserDashboard.create(app, { startDate, endDate });
        case 'Gerencia':
          return await GerenciaDashboard.create(app, { startDate, endDate });
        case 'Financiero':
          return await FinanzasDashboard.create(app, { startDate, endDate });
        case 'Compras':
          return await ComprasDashboard.create(app, { startDate, endDate });
        case 'Ventas':
          return await VentasDashboard.create(app, { startDate, endDate });
        case 'Inventario':
          return await InventarioDashboard.create(app, { startDate, endDate });
        default:
          app.log.warn(`[DASHBOARD FACTORY] Unknown role: ${role}, returning default dashboard`);
          return {
            role,
            title: 'Default Dashboard',
            lastUpdated: now.toISOString(),
            kpis: [],
            error: 'No dashboard configured for this role'
          };
      }
    } catch (error) {
      app.log.error({ err: error }, `[DASHBOARD FACTORY] Error creating dashboard for role ${role}:`);
      return {
        role,
        title: `${role} Dashboard`,
        lastUpdated: now.toISOString(),
        kpis: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  static getPrimaryRole(roles: string[]): string {
    const hierarchy = ['Superuser', 'Gerencia', 'Financiero', 'Compras', 'Ventas', 'Inventario', 'Admin'];
    for (const role of hierarchy) {
      if (roles.includes(role)) return role;
    }
    return roles[0];
  }

  

  static getDashboardRoleMap(): Record<string, string> {
    return {
      'executive-summary': 'Gerencia',
      'financial-health': 'Financiero',
      'purchasing-performance': 'Compras',
      'sales-forecast-accuracy': 'Ventas',
      'warehouse-operations': 'Inventario',
      'system-audit': 'Superuser'
    };
  }
}
