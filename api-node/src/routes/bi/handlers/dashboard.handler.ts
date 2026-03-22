import { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse, errorResponseFromError } from '../../../utils/responses';
import { DashboardFactory } from '../dashboards';
import { CacheService } from '../services/cache.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { validateDateRange, validateDashboardType } from '../utils/validators';

type DashboardQuery = {
  role?: string;
  fechaInicio?: string;
  fechaFin?: string;
  granularidad?: string;
  modo?: string;
};


const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class DashboardHandler {
  static async getDashboards(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.id;
      const roles = request.user?.roles ?? [];
      if (!userId) throw new Error('Unauthorized');

      request.log.info(`[DASHBOARD HANDLER] Getting dashboards for user ${userId} with roles: ${roles.join(', ')}`);

      // Extract date parameters AND role from query
      const { role, fechaInicio, fechaFin, granularidad = 'daily', modo = 'individual' } = request.query as DashboardQuery;
      const { startDate, endDate } = validateDateRange(fechaInicio, fechaFin);
      
      // Check rate limit
      RateLimiterService.checkRateLimit(userId);
      
      // Use requested role if provided, otherwise use primary role
      const targetRole = role || DashboardFactory.getPrimaryRole(roles);
      request.log.info(`[DASHBOARD HANDLER] Target role: ${targetRole} (requested: ${role}, primary: ${DashboardFactory.getPrimaryRole(roles)})`);
      
      // Check Redis cache if available (key includes dates so different ranges aren't mixed)
      const dateKey = startDate && endDate
        ? `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}`
        : 'default';
      const cacheKey = CacheService.generateKey('dashboards', userId, targetRole, dateKey);
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        request.log.info(`[DASHBOARD HANDLER] Cache hit for user ${userId}`);
        return successResponse(reply, cached);
      }
      
      request.log.info(`[DASHBOARD HANDLER] Date range: ${startDate?.toISOString()} to ${endDate?.toISOString()}`);
      
      const dashboard = await DashboardFactory.createDashboard(request.server, targetRole, { 
        startDate, 
        endDate,
        granularidad,
        modo
      });
      
      // Cache if Redis available
      await CacheService.set(cacheKey, dashboard, 300); // 5 minutes cache
      
      request.log.info(`[DASHBOARD HANDLER] Successfully created dashboard for role: ${targetRole}`);
      return successResponse(reply, dashboard);
    } catch (error: unknown) {
      request.log.error({ err: error }, '[DASHBOARD HANDLER] Error getting dashboards:');
      return errorResponseFromError(reply, new Error(getErrorMessage(error)));
    }
  }

  static async getSpecificDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { dashboardType } = request.params as { dashboardType: string };
      const roles = request.user!.roles;
      
      request.log.info(`[DASHBOARD HANDLER] Getting specific dashboard: ${dashboardType} for roles: ${roles.join(', ')}`);
      
      // Validate dashboard type
      const validatedType = validateDashboardType(dashboardType);
      
      // Map dashboard types to roles
      const dashboardRoleMap = DashboardFactory.getDashboardRoleMap();
      const targetRole = dashboardRoleMap[validatedType];
      
      if (!targetRole) {
        request.log.warn(`[DASHBOARD HANDLER] Dashboard not found: ${dashboardType}`);
        return errorResponseFromError(reply, new Error('Dashboard not found'), 404);
      }
      
      // Check rate limit
      RateLimiterService.checkRateLimit(request.user!.id);

      // Extract date parameters from query
      const { fechaInicio, fechaFin } = request.query as DashboardQuery;
      const { startDate, endDate } = validateDateRange(fechaInicio, fechaFin);

      // Check cache (include dates in cache key)
      const dateKey = `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}`;
      const cacheKey = CacheService.generateKey('dashboard', validatedType, roles.join(','), dateKey);
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        request.log.info(`[DASHBOARD HANDLER] Cache hit for dashboard: ${dashboardType}`);
        return successResponse(reply, cached);
      }

      const dashboard = await DashboardFactory.createDashboard(request.server, targetRole, {
        startDate,
        endDate
      });

      // Cache the result
      await CacheService.set(cacheKey, dashboard, 300);
      
      request.log.info(`[DASHBOARD HANDLER] Successfully created dashboard: ${dashboardType} for role: ${targetRole}`);
      return successResponse(reply, dashboard);
    } catch (error: unknown) {
      request.log.error({ err: error }, `[DASHBOARD HANDLER] Error getting specific dashboard:`);
      return errorResponseFromError(reply, new Error(getErrorMessage(error)));
    }
  }
}
