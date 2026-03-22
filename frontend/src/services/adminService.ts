// frontend/src/services/adminService.ts
import apiClient from './api-client';
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

// Helper function to extract error message safely
function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error instanceof Error) {
    // Check if it's an axios-like error structure
    if ('response' in error && error.response && typeof error.response === 'object' && 'data' in error.response) {
      const responseData = (error.response as { data?: { message?: string } }).data;
      if (responseData && typeof responseData.message === 'string') {
        return responseData.message;
      }
    }
    return error.message || defaultMessage;
  }
  return defaultMessage;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface User {
  id: number;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  roleId: number;
  businessUnitId?: number;
  businessUnit?: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
  updatedAt?: string;
  failedLoginAttempts?: number;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
  permissions: string[];
  userCount?: number;
  isSystemRole?: boolean;
  createdAt?: string;
}

export interface BusinessUnit {
  id: number;
  name: string;
  code: string;
  description?: string;
  parentId?: number;
  parentName?: string;
  userCount?: number;
  isActive: boolean;
  createdAt?: string;
}

export interface ProductCategory {
  id: number;
  name: string;
  code: string;
  description?: string;
  parentId?: number;
  parentName?: string;
  productCount?: number;
  isActive: boolean;
  createdAt?: string;
}

export interface MarketSegment {
  id: number;
  name: string;
  code: string;
  description?: string;
  targetAudience?: string;
  customerCount?: number;
  isActive: boolean;
  createdAt?: string;
}

export interface ActivityLog {
  id: number;
  userId: number;
  username: string;
  action: string;
  resource: string;
  resourceId?: number;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  status?: 'success' | 'failed';
}

export interface AdminDashboardData {
  users: User[];
  roles: Role[];
  businessUnits: BusinessUnit[];
  productCategories: ProductCategory[];
  marketSegments: MarketSegment[];
  systemHealth: {
    apiStatus: string;
    databaseStatus: string;
    jobsStatus: string;
    lastSync: string;
  };
  activityLog: ActivityLog[];
  kpis: {
    totalUsers: number;
    activeUsers: number;
    totalBusinessUnits: number;
    totalCategories: number;
    totalProducts: number;
    totalMarketSegments: number;
    userActivityRate: number;
    failedLoginAttempts: number;
    dataCompleteness: number;
    pendingActions: number;
    recentChanges: number;
  };
}

// ============================================================================
// ADMIN SERVICE CLASS
// ============================================================================

class AdminService {
  // ==========================================================================
  // DASHBOARD DATA
  // ==========================================================================

  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<AdminDashboardData> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Admin');
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      const { data } = response;

      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      return this.transformData(data);
    } catch (error: unknown) {
      console.error('Failed to fetch admin dashboard:', error);
      throw new Error(getErrorMessage(error, 'Error al cargar el panel de administración'));
    }
  }

  async getSystemHealth() {
    try {
      const response = await apiClient.request('GET', '/api/v1/admin/health');
      return response.data;
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {}
      };
    }
  }

  // ==========================================================================
  // USER MANAGEMENT
  // ==========================================================================

  async getUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
    role?: string;
    businessUnit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } & ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.active !== undefined) queryParams.append('active', params.active.toString());
      if (params?.role) queryParams.append('role', params.role);
      if (params?.businessUnit) queryParams.append('businessUnit', params.businessUnit.toString());
      if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/admin/users?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener usuarios'));
    }
  }

  async getUserById(userId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/users/${userId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles del usuario'));
    }
  }

  async createUser(userData: {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    roleId: number;
    businessUnitId?: number;
    isActive?: boolean;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/users', userData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear usuario'));
    }
  }

  async updateUser(userId: number, userData: Partial<User>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/admin/users/${userId}`, userData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar usuario'));
    }
  }

  async deleteUser(userId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/admin/users/${userId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar usuario'));
    }
  }

  async bulkUpdateUsers(userIds: number[], updates: Partial<User>) {
    try {
      const response = await apiClient.request('PUT', '/api/v1/admin/users/bulk', {
        userIds,
        updates
      });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar usuarios en lote'));
    }
  }

  async bulkDeleteUsers(userIds: number[]) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/users/bulk-delete', { userIds });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar usuarios en lote'));
    }
  }

  async resetUserPassword(userId: number, newPassword: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/admin/users/${userId}/reset-password`, {
        newPassword
      });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al restablecer contraseña'));
    }
  }

  async getUserSessions(userId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/users/${userId}/sessions`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener sesiones del usuario'));
    }
  }

  // ==========================================================================
  // ROLE MANAGEMENT
  // ==========================================================================

  async getRoles(params?: {
    page?: number;
    limit?: number;
    search?: string;
    includeSystemRoles?: boolean;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.includeSystemRoles !== undefined) {
        queryParams.append('includeSystemRoles', params.includeSystemRoles.toString());
      }

      const response = await apiClient.request('GET', `/api/v1/admin/roles?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener roles'));
    }
  }

  async getRoleById(roleId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/roles/${roleId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles del rol'));
    }
  }

  async createRole(roleData: {
    name: string;
    description?: string;
    permissions: string[];
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/roles', roleData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear rol'));
    }
  }

  async updateRole(roleId: number, roleData: Partial<Role>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/admin/roles/${roleId}`, roleData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar rol'));
    }
  }

  async deleteRole(roleId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/admin/roles/${roleId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar rol'));
    }
  }

  async getAvailablePermissions() {
    try {
      const response = await apiClient.request('GET', '/api/v1/admin/permissions');
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener permisos disponibles'));
    }
  }

  // ==========================================================================
  // BUSINESS UNIT MANAGEMENT
  // ==========================================================================

  async getBusinessUnits(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
    parentId?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.active !== undefined) queryParams.append('active', params.active.toString());
      if (params?.parentId) queryParams.append('parentId', params.parentId.toString());

      const response = await apiClient.request('GET', `/api/v1/admin/business-units?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener unidades de negocio'));
    }
  }

  async getBusinessUnitById(businessUnitId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/business-units/${businessUnitId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles de unidad de negocio'));
    }
  }

  async createBusinessUnit(businessUnitData: {
    name: string;
    code: string;
    description?: string;
    parentId?: number;
    isActive?: boolean;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/business-units', businessUnitData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear unidad de negocio'));
    }
  }

  async updateBusinessUnit(businessUnitId: number, businessUnitData: Partial<BusinessUnit>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/admin/business-units/${businessUnitId}`, businessUnitData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar unidad de negocio'));
    }
  }

  async deleteBusinessUnit(businessUnitId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/admin/business-units/${businessUnitId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar unidad de negocio'));
    }
  }

  // ==========================================================================
  // MARKET SEGMENT MANAGEMENT
  // ==========================================================================

  async getMarketSegments(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.active !== undefined) queryParams.append('active', params.active.toString());

      const response = await apiClient.request('GET', `/api/v1/admin/market-segments?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener segmentos de mercado'));
    }
  }

  async getMarketSegmentById(segmentId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/market-segments/${segmentId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles de segmento'));
    }
  }

  async createMarketSegment(segmentData: {
    name: string;
    code: string;
    description?: string;
    targetAudience?: string;
    isActive?: boolean;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/market-segments', segmentData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear segmento de mercado'));
    }
  }

  async updateMarketSegment(segmentId: number, segmentData: Partial<MarketSegment>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/admin/market-segments/${segmentId}`, segmentData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar segmento de mercado'));
    }
  }

  async deleteMarketSegment(segmentId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/admin/market-segments/${segmentId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar segmento de mercado'));
    }
  }

  // ==========================================================================
  // PRODUCT CATEGORY MANAGEMENT
  // ==========================================================================

  async getProductCategories(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
    parentId?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.active !== undefined) queryParams.append('active', params.active.toString());
      if (params?.parentId) queryParams.append('parentId', params.parentId.toString());

      const response = await apiClient.request('GET', `/api/v1/admin/product-categories?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener categorías de productos'));
    }
  }

  async getProductCategoryById(categoryId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/admin/product-categories/${categoryId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles de categoría'));
    }
  }

  async createProductCategory(categoryData: {
    name: string;
    code: string;
    description?: string;
    parentId?: number;
    isActive?: boolean;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/admin/product-categories', categoryData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear categoría de producto'));
    }
  }

  async updateProductCategory(categoryId: number, categoryData: Partial<ProductCategory>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/admin/product-categories/${categoryId}`, categoryData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar categoría de producto'));
    }
  }

  async deleteProductCategory(categoryId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/admin/product-categories/${categoryId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar categoría de producto'));
    }
  }

  // ==========================================================================
  // ACTIVITY LOGS
  // ==========================================================================

  async getActivityLogs(params?: ParametrosConsultaTemporal & {
    page?: number;
    limit?: number;
    user?: string;
    action?: string;
    resource?: string;
    status?: 'success' | 'failed';
    search?: string;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.user) queryParams.append('user', params.user);
      if (params?.action) queryParams.append('action', params.action);
      if (params?.resource) queryParams.append('resource', params.resource);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.search) queryParams.append('search', params.search);

      const response = await apiClient.request('GET', `/api/v1/admin/activity-logs?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener logs de actividad'));
    }
  }

  async getUserActivityStats(userId: number, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/admin/users/${userId}/activity-stats?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener estadísticas de actividad'));
    }
  }

  // ==========================================================================
  // METRICS & ANALYTICS
  // ==========================================================================

  async getSystemMetrics(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);

      const response = await apiClient.request('GET', `/api/v1/admin/system-metrics?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener métricas del sistema'));
    }
  }

  async getUserActivityTrend(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);

      const response = await apiClient.request('GET', `/api/v1/admin/metrics/user-activity-trend?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener tendencia de actividad'));
    }
  }

  // ==========================================================================
  // EXPORT FUNCTIONALITY
  // ==========================================================================

  async exportSystemReport(format: 'csv' | 'excel' | 'pdf', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/admin/export?${queryParams}`, null, {});

      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte-sistema.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar reporte del sistema'));
    }
  }

  async exportUsers(format: 'csv' | 'excel', filters?: any) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (filters) {
        Object.keys(filters).forEach(key => {
          if (filters[key] !== undefined && filters[key] !== null) {
            queryParams.append(key, filters[key].toString());
          }
        });
      }

      const response = await apiClient.download(`/api/v1/admin/users/export?${queryParams}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `usuarios.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar usuarios'));
    }
  }

  async exportActivityLogs(format: 'csv' | 'excel', filters?: any) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (filters) {
        Object.keys(filters).forEach(key => {
          if (filters[key] !== undefined && filters[key] !== null) {
            queryParams.append(key, filters[key].toString());
          }
        });
      }

      const response = await apiClient.download(`/api/v1/admin/activity-logs/export?${queryParams}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `logs-actividad.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar logs de actividad'));
    }
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private transformData(data: any): AdminDashboardData {
    const systemHealth = {
      apiStatus: this.extractKpiValue(data.kpis, 'api_status', 'healthy'),
      databaseStatus: this.extractKpiValue(data.kpis, 'database_status', 'healthy'),
      jobsStatus: this.extractKpiValue(data.kpis, 'jobs_status', 'active'),
      lastSync: this.extractKpiValue(data.kpis, 'last_sync', new Date().toISOString()),
    };

    const kpis = {
      totalUsers: this.extractKpiValue(data.kpis, 'total_users', 0),
      activeUsers: this.extractKpiValue(data.kpis, 'active_users', 0),
      totalBusinessUnits: this.extractKpiValue(data.kpis, 'total_business_units', 0),
      totalCategories: this.extractKpiValue(data.kpis, 'total_categories', 0),
      totalProducts: this.extractKpiValue(data.kpis, 'total_products', 0),
      totalMarketSegments: this.extractKpiValue(data.kpis, 'total_market_segments', 0),
      userActivityRate: this.extractKpiValue(data.kpis, 'user_activity_rate', 0),
      failedLoginAttempts: this.extractKpiValue(data.kpis, 'failed_login_attempts', 0),
      dataCompleteness: this.extractKpiValue(data.kpis, 'data_completeness', 0),
      pendingActions: this.extractKpiValue(data.kpis, 'pending_actions', 0),
      recentChanges: this.extractKpiValue(data.kpis, 'recent_changes', 0),
    };

    return {
      users: data.charts?.users || [],
      roles: data.charts?.roles || [],
      businessUnits: data.charts?.businessUnits || [],
      productCategories: data.charts?.productCategories || [],
      marketSegments: data.charts?.marketSegments || [],
      systemHealth,
      activityLog: data.charts?.activityLog || data.alerts || [],
      kpis,
    };
  }

  private transformCompareData(data: any): AdminDashboardData {
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;

    const systemHealth = {
      apiStatus: this.extractKpiValue(periodA.kpis, 'api_status', 'healthy'),
      databaseStatus: this.extractKpiValue(periodA.kpis, 'database_status', 'healthy'),
      jobsStatus: this.extractKpiValue(periodA.kpis, 'jobs_status', 'active'),
      lastSync: this.extractKpiValue(periodA.kpis, 'last_sync', new Date().toISOString()),
    };

    const kpis = {
      totalUsers: this.extractKpiValue(periodA.kpis, 'total_users', 0),
      activeUsers: this.extractKpiValue(periodA.kpis, 'active_users', 0),
      totalBusinessUnits: this.extractKpiValue(periodA.kpis, 'total_business_units', 0),
      totalCategories: this.extractKpiValue(periodA.kpis, 'total_categories', 0),
      totalProducts: this.extractKpiValue(periodA.kpis, 'total_products', 0),
      totalMarketSegments: this.extractKpiValue(periodA.kpis, 'total_market_segments', 0),
      userActivityRate: this.extractKpiValue(periodA.kpis, 'user_activity_rate', 0),
      failedLoginAttempts: this.extractKpiValue(periodA.kpis, 'failed_login_attempts', 0),
      dataCompleteness: this.extractKpiValue(periodA.kpis, 'data_completeness', 0),
      pendingActions: this.extractKpiValue(periodA.kpis, 'pending_actions', 0),
      recentChanges: this.extractKpiValue(periodA.kpis, 'recent_changes', 0),
    };

    const activityLog = this.mergeActivityLogs(
      periodA.charts?.activityLog || periodA.alerts || [],
      periodB.charts?.activityLog || periodB.alerts || []
    );

    return {
      users: periodA.charts?.users || [],
      roles: periodA.charts?.roles || [],
      businessUnits: periodA.charts?.businessUnits || [],
      productCategories: periodA.charts?.productCategories || [],
      marketSegments: periodA.charts?.marketSegments || [],
      systemHealth,
      activityLog,
      kpis,
    };
  }

  private mergeActivityLogs(logsA: any[], logsB: any[]): any[] {
    const mergedLogs = [
      ...logsA.map(log => ({ ...log, period: 'current' })),
      ...logsB.map(log => ({ ...log, period: 'comparison' }))
    ];

    return mergedLogs.sort((a, b) =>
      new Date(b.timestamp || b.created_at || 0).getTime() -
      new Date(a.timestamp || a.created_at || 0).getTime()
    );
  }

  private extractKpiValue(kpis: any[], key: string, defaultValue: any): any {
    const kpi = kpis?.find(k => k.key === key || k.metric === key);
    return kpi?.value || kpi?.current || defaultValue;
  }
}

export const adminService = new AdminService();
export default adminService;
