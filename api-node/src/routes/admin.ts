import { Prisma } from '@prisma/client';
import type { AppWithPrisma, TimeNavigationParams } from '../types/app';
import { authenticate, requirePermissions } from '../middleware/auth';
import { successResponse, errorResponseFromError } from '../utils/responses';
export const adminRoutes = async (app: AppWithPrisma): Promise<void> => {
  // GET /v1/admin/users
  app.get('/users', {
    onRequest: [authenticate, requirePermissions('user:read')],
  }, async (_request, reply) => {
    try {
      const users = await app.prisma.user.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          username: true,
          email: true,
          isActive: true,
          createdAt: true,
          userRoles: {
            include: {
              role: {
                select: {
                  id: true,
                  roleName: true
                }
              }
            }
          }
        },
      });
      
      const usersWithRoles = users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        isActive: user.isActive,
        createdAt: user.createdAt,
        roles: user.userRoles.map((ur) => ur.role.roleName)
      }));
      
      return successResponse(reply, usersWithRoles);
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });

  // GET /v1/admin/user-activity
  app.get('/user-activity', {
    onRequest: [authenticate, requirePermissions('user:read')],
  }, async (request, reply) => {
    try {
      const { 
        fechaInicio, 
        fechaFin,
        userId
      } = request.query as TimeNavigationParams & { userId?: string };

      const endDate = fechaFin || new Date().toISOString().split('T')[0];
      const startDate = fechaInicio || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Activity based on audit logs
      type ActivityRow = {
        userId: number;
        username: string;
        totalActions: bigint;
        lastAction: Date;
        actionBreakdown: Record<string, number>;
      };

      const numericUserId = userId ? Number(userId) : undefined;
      const userFilter = numericUserId && !Number.isNaN(numericUserId)
        ? Prisma.sql`AND u.user_id = ${numericUserId}`
        : Prisma.empty;

      const activity = await app.prisma.$queryRaw<ActivityRow[]>`
        SELECT 
          u.user_id as "userId",
          u.username,
          COUNT(a.log_id) as "totalActions",
          MAX(a.changed_at) as "lastAction",
          json_object_agg(
            COALESCE(a.action, 'other'), 
            action_count
          ) as "actionBreakdown"
        FROM users u
        LEFT JOIN (
          SELECT 
            changed_by,
            action,
            changed_at,
            log_id,
            COUNT(*) OVER (PARTITION BY changed_by, action) as action_count
          FROM audit_logs
          WHERE changed_at >= ${startDate}::date
            AND changed_at <= ${endDate}::date + INTERVAL '1 day'
        ) a ON u.user_id = a.changed_by
        WHERE u.is_deleted = false
          ${userFilter}
        GROUP BY u.user_id, u.username
        HAVING COUNT(a.log_id) > 0
        ORDER BY "totalActions" DESC
      `;

      const formattedActivity = activity.map((row) => ({
        userId: row.userId,
        username: row.username,
        totalActions: Number(row.totalActions),
        lastAction: row.lastAction,
        actionBreakdown: row.actionBreakdown
      }));

      return successResponse(reply, {
        fechaInicio: startDate,
        fechaFin: endDate,
        activity: formattedActivity
      });
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });

  // GET /v1/admin/system-stats
  app.get('/system-stats', {
    onRequest: [authenticate, requirePermissions('user:read')],
  }, async (request, reply) => {
    try {
      const { 
        fechaInicio, 
        fechaFin
      } = request.query as TimeNavigationParams;

      const endDate = fechaFin || new Date().toISOString().split('T')[0];
      const startDate = fechaInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get various system statistics
      type StatsRow = {
        totalUsers: bigint;
        activeUsers: bigint;
        totalProducts: bigint;
        totalSales: bigint;
        totalRecommendations: bigint;
      };

      const stats = await app.prisma.$queryRaw<StatsRow[]>`
        SELECT 
          (SELECT COUNT(*) FROM users WHERE is_deleted = false) as "totalUsers",
          (SELECT COUNT(*) FROM users WHERE is_deleted = false AND is_active = true) as "activeUsers",
          (SELECT COUNT(*) FROM products WHERE is_deleted = false) as "totalProducts",
          (SELECT COUNT(*) FROM sales_partitioned 
           WHERE sale_datetime >= ${startDate}::date 
           AND sale_datetime <= ${endDate}::date
           AND is_deleted = false) as "totalSales",
          (SELECT COUNT(*) FROM recommendations 
           WHERE generated_at >= ${startDate}::date 
           AND generated_at <= ${endDate}::date) as "totalRecommendations"
      `;

      return successResponse(reply, {
        fechaInicio: startDate,
        fechaFin: endDate,
        stats: {
          totalUsers: Number(stats[0]?.totalUsers ?? 0),
          activeUsers: Number(stats[0]?.activeUsers ?? 0),
          totalProducts: Number(stats[0]?.totalProducts ?? 0),
          totalSales: Number(stats[0]?.totalSales ?? 0),
          totalRecommendations: Number(stats[0]?.totalRecommendations ?? 0)
        }
      });
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });
  
  // GET /v1/admin/roles
  app.get('/roles', {
    onRequest: [authenticate, requirePermissions('role:read')],
  }, async (_request, reply) => {
    try {
      type RoleWithPermissions = Prisma.RoleGetPayload<{
        include: {
          rolePermissions: {
            include: {
              permission: true;
            };
          };
        };
      }>;

      const roles = await app.prisma.role.findMany({
        where: { isDeleted: false },
        include: {
          rolePermissions: {
            include: {
              permission: true,
            },
          },
        },
      }) as RoleWithPermissions[];
      
      const rolesWithPermissions = roles.map((role) => ({
        id: role.id,
        name: role.roleName,
        permissions: role.rolePermissions.map((rp) => ({
          id: rp.permission.id,
          name: rp.permission.permissionName,
          description: rp.permission.description
        }))
      }));
      
      return successResponse(reply, rolesWithPermissions);
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });
  
  // GET /v1/admin/permissions
  app.get('/permissions', {
    onRequest: [authenticate, requirePermissions('permission:read')],
  }, async (_request, reply) => {
    try {
      const permissions = await app.prisma.permission.findMany({
        orderBy: { permissionName: 'asc' }
      });
      return successResponse(reply, permissions);
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });
  
  // GET /v1/admin/health
  app.get('/health', async (_request, reply) => {
    try {
      // Test database connection
      await app.prisma.$queryRaw`SELECT 1`;
      
      return successResponse(reply, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: process.env.APP_VERSION || '1.0.0'
      });
    } catch (error) {
      return errorResponseFromError(reply, error as Error);
    }
  });
};