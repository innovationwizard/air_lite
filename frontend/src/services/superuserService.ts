// frontend/src/services/superuserService.ts
import apiClient from './api-client';

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
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

// ============================================================================
// SYSTEM HEALTH INTERFACES (ADMIN HAT)
// ============================================================================

export interface Tenant {
  id: number;
  name: string;
  code: string;
  domain?: string;
  status: 'active' | 'inactive' | 'suspended';
  subscriptionPlan: string;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'cancelled';
  maxUsers: number;
  currentUsers: number;
  storageUsed: number;
  storageLimit: number;
  apiCallsUsed: number;
  apiCallsLimit: number;
  createdAt: string;
  expiresAt?: string;
  lastActivityAt?: string;
  contactEmail?: string;
  contactName?: string;
}

export interface SystemUser {
  id: number;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: 'superuser' | 'system_admin' | 'support';
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
  mfaEnabled: boolean;
  permissions: string[];
}

export interface DataSource {
  id: number;
  name: string;
  type: 'postgres' | 'mysql' | 'mongodb' | 's3' | 'api' | 'sftp';
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  host?: string;
  port?: number;
  database?: string;
  lastSync?: string;
  nextSync?: string;
  syncFrequency: string;
  recordsProcessed: number;
  errorCount: number;
  latency?: number;
  tenantId?: number;
  createdAt: string;
  config?: Record<string, any>;
}

export interface InfrastructureMetrics {
  timestamp: string;
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    requestsPerSecond: number;
  };
  database: {
    connections: number;
    maxConnections: number;
    queryTime: number;
    slowQueries: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

export interface JobQueue {
  id: string;
  name: string;
  type: 'model_training' | 'data_sync' | 'report_generation' | 'batch_prediction' | 'maintenance';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'critical';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  estimatedDuration?: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface DatabaseHealth {
  name: string;
  type: 'primary' | 'replica' | 'cache';
  status: 'healthy' | 'degraded' | 'down';
  size: number;
  connections: {
    active: number;
    idle: number;
    total: number;
    max: number;
  };
  performance: {
    avgQueryTime: number;
    slowQueries: number;
    queriesPerSecond: number;
  };
  replication?: {
    lag: number;
    status: 'synced' | 'lagging' | 'broken';
  };
}

export interface SecurityAudit {
  id: string;
  timestamp: string;
  user: string;
  userId?: number;
  action: string;
  resource: string;
  resourceType: 'user' | 'tenant' | 'model' | 'data' | 'config' | 'system';
  result: 'success' | 'failure';
  ip: string;
  userAgent?: string;
  details: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  tenantId?: number;
}

export interface SystemHealthDashboardData {
  systemStatus: {
    status: 'operational' | 'degraded' | 'down';
    uptime: number;
    lastIncident?: string;
  };
  tenants: {
    total: number;
    active: number;
    suspended: number;
    trialCount: number;
  };
  dataSources: {
    total: number;
    connected: number;
    disconnected: number;
    errors: number;
  };
  apiMetrics: {
    requestsPerMinute: number;
    avgResponseTime: number;
    errorRate: number;
    p95ResponseTime: number;
  };
  userActivity: {
    activeNow: number;
    sessionsToday: number;
    avgSessionDuration: number;
  };
  infrastructure: InfrastructureMetrics;
  activeJobs: number;
  pendingJobs: number;
  failedJobs: number;
  databases: DatabaseHealth[];
  recentSecurityEvents: SecurityAudit[];
  systemAlerts: Array<{
    id: string;
    type: 'infrastructure' | 'security' | 'data' | 'performance';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    timestamp: string;
  }>;
}

// ============================================================================
// AI MODEL GOVERNANCE INTERFACES
// ============================================================================

export interface SuperuserDashboardData {
  aiModelMetrics: {
    currentAccuracy: number;
    wmape: number;
    bias: number;
    latency: number;
    lastTrainingDate: string;
    modelVersion: string;
  };
  modelPerformance: Array<{
    date: string;
    accuracy: number;
    wmape: number;
    predictions: number;
    errors: number;
  }>;
  dataQuality: {
    completeness: number;
    accuracy: number;
    timeliness: number;
    consistency: number;
    lastAudit: string;
  };
  systemOverview: {
    totalUsers: number;
    activeUsers: number;
    totalPredictions: number;
    apiCalls: number;
    systemUptime: number;
    lastDeployment: string;
  };
  abTests: Array<{
    id: string;
    name: string;
    status: 'active' | 'completed' | 'paused';
    variant_a: { name: string; performance: number };
    variant_b: { name: string; performance: number };
    startDate: string;
    endDate?: string;
    sampleSize: number;
    significance: number;
  }>;
  modelAlerts: Array<{
    id: string;
    type: 'accuracy' | 'drift' | 'bias' | 'performance';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    timestamp: string;
    recommendation?: string;
  }>;
  auditLogs: Array<{
    timestamp: string;
    user: string;
    action: string;
    resource: string;
    details: string;
    ip?: string;
  }>;
}

class SuperuserService {
  // ============================================================================
  // SYSTEM HEALTH METHODS (ADMIN HAT)
  // ============================================================================

  /**
   * Get comprehensive system health dashboard data
   */
  async getSystemHealthData(params?: ParametrosConsultaTemporal): Promise<SystemHealthDashboardData> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);

      const response = await apiClient.request('GET', `/api/v1/superuser/system-health?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al cargar datos de salud del sistema'));
    }
  }

  // --------------------------------------------------------------------------
  // TENANT MANAGEMENT
  // --------------------------------------------------------------------------

  async getTenants(params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: 'active' | 'inactive' | 'suspended';
    subscriptionStatus?: string;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.subscriptionStatus) queryParams.append('subscriptionStatus', params.subscriptionStatus);

      const response = await apiClient.request('GET', `/api/v1/superuser/tenants?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener tenants'));
    }
  }

  async getTenantById(tenantId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/superuser/tenants/${tenantId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener tenant'));
    }
  }

  async createTenant(tenantData: {
    name: string;
    code: string;
    domain?: string;
    subscriptionPlan: string;
    maxUsers: number;
    storageLimit: number;
    apiCallsLimit: number;
    contactEmail: string;
    contactName?: string;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/superuser/tenants', tenantData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear tenant'));
    }
  }

  async updateTenant(tenantId: number, tenantData: Partial<Tenant>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/superuser/tenants/${tenantId}`, tenantData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar tenant'));
    }
  }

  async suspendTenant(tenantId: number, reason?: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/tenants/${tenantId}/suspend`, { reason });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al suspender tenant'));
    }
  }

  async activateTenant(tenantId: number) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/tenants/${tenantId}/activate`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al activar tenant'));
    }
  }

  async deleteTenant(tenantId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/superuser/tenants/${tenantId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar tenant'));
    }
  }

  async getTenantUsageStats(tenantId: number, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/superuser/tenants/${tenantId}/usage?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener estadísticas de uso'));
    }
  }

  // --------------------------------------------------------------------------
  // SYSTEM USER MANAGEMENT
  // --------------------------------------------------------------------------

  async getSystemUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    active?: boolean;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.role) queryParams.append('role', params.role);
      if (params?.active !== undefined) queryParams.append('active', params.active.toString());

      const response = await apiClient.request('GET', `/api/v1/superuser/system-users?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener usuarios del sistema'));
    }
  }

  async getSystemUserById(userId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/superuser/system-users/${userId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener usuario del sistema'));
    }
  }

  async createSystemUser(userData: {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role: 'superuser' | 'system_admin' | 'support';
    permissions: string[];
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/superuser/system-users', userData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear usuario del sistema'));
    }
  }

  async updateSystemUser(userId: number, userData: Partial<SystemUser>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/superuser/system-users/${userId}`, userData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar usuario del sistema'));
    }
  }

  async deleteSystemUser(userId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/superuser/system-users/${userId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar usuario del sistema'));
    }
  }

  // --------------------------------------------------------------------------
  // DATA SOURCE MANAGEMENT
  // --------------------------------------------------------------------------

  async getDataSources(params?: {
    page?: number;
    limit?: number;
    type?: string;
    status?: string;
    tenantId?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.type) queryParams.append('type', params.type);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.tenantId) queryParams.append('tenantId', params.tenantId.toString());

      const response = await apiClient.request('GET', `/api/v1/superuser/data-sources?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener fuentes de datos'));
    }
  }

  async getDataSourceById(sourceId: number) {
    try {
      const response = await apiClient.request('GET', `/api/v1/superuser/data-sources/${sourceId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener fuente de datos'));
    }
  }

  async createDataSource(sourceData: {
    name: string;
    type: 'postgres' | 'mysql' | 'mongodb' | 's3' | 'api' | 'sftp';
    host?: string;
    port?: number;
    database?: string;
    syncFrequency: string;
    tenantId?: number;
    config: Record<string, any>;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/superuser/data-sources', sourceData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear fuente de datos'));
    }
  }

  async updateDataSource(sourceId: number, sourceData: Partial<DataSource>) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/superuser/data-sources/${sourceId}`, sourceData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar fuente de datos'));
    }
  }

  async deleteDataSource(sourceId: number) {
    try {
      const response = await apiClient.request('DELETE', `/api/v1/superuser/data-sources/${sourceId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al eliminar fuente de datos'));
    }
  }

  async testDataSourceConnection(sourceId: number) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/data-sources/${sourceId}/test`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al probar conexión'));
    }
  }

  async syncDataSource(sourceId: number) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/data-sources/${sourceId}/sync`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al sincronizar fuente de datos'));
    }
  }

  // --------------------------------------------------------------------------
  // INFRASTRUCTURE MONITORING
  // --------------------------------------------------------------------------

  async getInfrastructureMetrics(params?: ParametrosConsultaTemporal & {
    interval?: '1m' | '5m' | '15m' | '1h';
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.interval) queryParams.append('interval', params.interval);

      const response = await apiClient.request('GET', `/api/v1/superuser/infrastructure/metrics?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener métricas de infraestructura'));
    }
  }

  async getDatabaseHealth() {
    try {
      const response = await apiClient.request('GET', '/api/v1/superuser/infrastructure/database-health');
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener salud de bases de datos'));
    }
  }

  async getCostAnalysis(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/superuser/infrastructure/costs?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener análisis de costos'));
    }
  }

  // --------------------------------------------------------------------------
  // JOB QUEUE MANAGEMENT
  // --------------------------------------------------------------------------

  async getJobQueues(params?: {
    page?: number;
    limit?: number;
    type?: string;
    status?: string;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.type) queryParams.append('type', params.type);
      if (params?.status) queryParams.append('status', params.status);

      const response = await apiClient.request('GET', `/api/v1/superuser/jobs?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener trabajos'));
    }
  }

  async getJobById(jobId: string) {
    try {
      const response = await apiClient.request('GET', `/api/v1/superuser/jobs/${jobId}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener trabajo'));
    }
  }

  async retryJob(jobId: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/jobs/${jobId}/retry`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al reintentar trabajo'));
    }
  }

  async cancelJob(jobId: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/jobs/${jobId}/cancel`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al cancelar trabajo'));
    }
  }

  async clearCompletedJobs() {
    try {
      const response = await apiClient.request('DELETE', '/api/v1/superuser/jobs/completed');
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al limpiar trabajos completados'));
    }
  }

  // --------------------------------------------------------------------------
  // SECURITY AUDIT
  // --------------------------------------------------------------------------

  async getSecurityAudits(params?: ParametrosConsultaTemporal & {
    page?: number;
    limit?: number;
    user?: string;
    action?: string;
    resourceType?: string;
    severity?: string;
    result?: 'success' | 'failure';
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.user) queryParams.append('user', params.user);
      if (params?.action) queryParams.append('action', params.action);
      if (params?.resourceType) queryParams.append('resourceType', params.resourceType);
      if (params?.severity) queryParams.append('severity', params.severity);
      if (params?.result) queryParams.append('result', params.result);

      const response = await apiClient.request('GET', `/api/v1/superuser/security/audits?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener auditorías de seguridad'));
    }
  }

  async getSecurityAlerts(params?: {
    page?: number;
    limit?: number;
    severity?: string;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.severity) queryParams.append('severity', params.severity);

      const response = await apiClient.request('GET', `/api/v1/superuser/security/alerts?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener alertas de seguridad'));
    }
  }

  async acknowledgeSecurityAlert(alertId: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/security/alerts/${alertId}/acknowledge`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al reconocer alerta'));
    }
  }

  // ============================================================================
  // AI MODEL GOVERNANCE METHODS
  // ============================================================================

  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<SuperuserDashboardData> {
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Superuser');
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      const { data } = response;

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: unknown) {
      console.error('Failed to fetch superuser dashboard:', error);
      throw new Error(getErrorMessage(error, 'Error al cargar el panel de superusuario'));
    }
  }

  async getModelDetails(modelId?: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const endpoint = modelId 
        ? `/api/v1/superuser/models/${modelId}?${queryParams}` 
        : `/api/v1/superuser/models/current?${queryParams}`;
      
      const response = await apiClient.request('GET', endpoint);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles del modelo'));
    }
  }

  async triggerModelRetrain(params?: ParametrosConsultaTemporal & {
    features?: string[];
    hyperparameters?: any;
  }) {
    try {
      const { fechaInicio, fechaFin, granularidad, features, hyperparameters } = params || {};
      
      const body = {
        fechaInicio,
        fechaFin,
        granularidad,
        features,
        hyperparameters
      };
      
      const response = await apiClient.request('POST', '/api/v1/superuser/models/retrain', body);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al reentrenar el modelo'));
    }
  }

  async getModelComparison(modelA: string, modelB: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('modelA', modelA);
      queryParams.append('modelB', modelB);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      
      const response = await apiClient.request('GET', `/api/v1/superuser/models/compare?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al comparar modelos'));
    }
  }

  async deployModel(modelId: string, environment: 'staging' | 'production') {
    try {
      const response = await apiClient.request('POST', `/api/v1/superuser/models/${modelId}/deploy`, {
        environment
      });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al desplegar el modelo'));
    }
  }

  async getDataQualityReport(params?: ParametrosConsultaTemporal & {
    datasets?: string[];
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.datasets) params.datasets.forEach(d => queryParams.append('datasets[]', d));
      
      const response = await apiClient.request('GET', `/api/v1/superuser/data-quality?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener reporte de calidad de datos'));
    }
  }

  async getSystemMetrics(params?: ParametrosConsultaTemporal & {
    period?: string;
    metrics?: string[];
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.period) queryParams.append('period', params.period);
      if (params?.metrics) params.metrics.forEach(m => queryParams.append('metrics[]', m));
      
      const response = await apiClient.request('GET', `/api/v1/superuser/system-metrics?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener métricas del sistema'));
    }
  }

  async createABTest(testData: {
    name: string;
    description: string;
    variant_a: any;
    variant_b: any;
    targetMetric: string;
    sampleSize: number;
    duration: number;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/superuser/ab-tests', testData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear prueba A/B'));
    }
  }

  async updateABTestStatus(testId: string, status: 'active' | 'paused' | 'completed') {
    try {
      const response = await apiClient.request('PUT', `/api/v1/superuser/ab-tests/${testId}/status`, { status });
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar estado de prueba A/B'));
    }
  }

  async getAuditLogs(params?: ParametrosConsultaTemporal & {
    user?: string;
    action?: string;
    resource?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.user) queryParams.append('user', params.user);
      if (params?.action) queryParams.append('action', params.action);
      if (params?.resource) queryParams.append('resource', params.resource);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/superuser/audit-logs?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener logs de auditoría'));
    }
  }

  async getFeatureImportance(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/superuser/models/feature-importance?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener importancia de características'));
    }
  }

  async runDiagnostics() {
    try {
      const response = await apiClient.request('POST', '/api/v1/superuser/diagnostics');
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al ejecutar diagnósticos del sistema'));
    }
  }

  async exportModelReport(format: 'pdf' | 'html', modelId?: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (modelId) queryParams.append('modelId', modelId);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/superuser/models/export?${queryParams}`, null, {
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte-modelo.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar reporte del modelo'));
    }
  }

  // Helper methods
  private transformData(data: any): SuperuserDashboardData {
    // Extract AI model metrics from KPIs
    const aiModelMetrics = {
      currentAccuracy: this.extractKpiValue(data.kpis, 'model_accuracy', 0),
      wmape: this.extractKpiValue(data.kpis, 'wmape', 0),
      bias: this.extractKpiValue(data.kpis, 'model_bias', 0),
      latency: this.extractKpiValue(data.kpis, 'model_latency', 0),
      lastTrainingDate: this.extractKpiValue(data.kpis, 'last_training_date', new Date().toISOString()),
      modelVersion: this.extractKpiValue(data.kpis, 'model_version', '1.0.0'),
    };

    // Extract data quality metrics
    const dataQuality = {
      completeness: this.extractKpiValue(data.kpis, 'data_completeness', 0),
      accuracy: this.extractKpiValue(data.kpis, 'data_accuracy', 0),
      timeliness: this.extractKpiValue(data.kpis, 'data_timeliness', 0),
      consistency: this.extractKpiValue(data.kpis, 'data_consistency', 0),
      lastAudit: this.extractKpiValue(data.kpis, 'last_audit', new Date().toISOString()),
    };

    // Extract system overview
    const systemOverview = {
      totalUsers: this.extractKpiValue(data.kpis, 'total_users', 0),
      activeUsers: this.extractKpiValue(data.kpis, 'active_users', 0),
      totalPredictions: this.extractKpiValue(data.kpis, 'total_predictions', 0),
      apiCalls: this.extractKpiValue(data.kpis, 'api_calls', 0),
      systemUptime: this.extractKpiValue(data.kpis, 'system_uptime', 0),
      lastDeployment: this.extractKpiValue(data.kpis, 'last_deployment', new Date().toISOString()),
    };

    // Extract charts data
    const modelPerformance = data.charts?.modelPerformance || [];
    const abTests = data.charts?.abTests || [];
    const auditLogs = data.charts?.auditLogs || [];

    // Transform alerts to model alerts
    const modelAlerts = (data.alerts || []).map((alert: any) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: this.mapAlertType(alert.type),
      message: alert.message || alert.text,
      severity: alert.severity || 'medium',
      timestamp: alert.timestamp || new Date().toISOString(),
      recommendation: alert.recommendation,
    }));

    return {
      aiModelMetrics,
      modelPerformance,
      dataQuality,
      systemOverview,
      abTests,
      modelAlerts,
      auditLogs,
    };
  }

  private transformCompareData(data: any): SuperuserDashboardData {
    // For compare mode, show period A as current with comparison data
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;
    
    const aiModelMetrics = {
      currentAccuracy: this.extractKpiValue(periodA.kpis, 'model_accuracy', 0),
      wmape: this.extractKpiValue(periodA.kpis, 'wmape', 0),
      bias: this.extractKpiValue(periodA.kpis, 'model_bias', 0),
      latency: this.extractKpiValue(periodA.kpis, 'model_latency', 0),
      lastTrainingDate: this.extractKpiValue(periodA.kpis, 'last_training_date', new Date().toISOString()),
      modelVersion: this.extractKpiValue(periodA.kpis, 'model_version', '1.0.0'),
    };

    // Merge model performance data
    const modelPerformance = this.mergeModelPerformance(
      periodA.charts?.modelPerformance || [],
      periodB.charts?.modelPerformance || []
    );

    return {
      aiModelMetrics,
      modelPerformance,
      dataQuality: {
        completeness: this.extractKpiValue(periodA.kpis, 'data_completeness', 0),
        accuracy: this.extractKpiValue(periodA.kpis, 'data_accuracy', 0),
        timeliness: this.extractKpiValue(periodA.kpis, 'data_timeliness', 0),
        consistency: this.extractKpiValue(periodA.kpis, 'data_consistency', 0),
        lastAudit: this.extractKpiValue(periodA.kpis, 'last_audit', new Date().toISOString()),
      },
      systemOverview: {
        totalUsers: this.extractKpiValue(periodA.kpis, 'total_users', 0),
        activeUsers: this.extractKpiValue(periodA.kpis, 'active_users', 0),
        totalPredictions: this.extractKpiValue(periodA.kpis, 'total_predictions', 0),
        apiCalls: this.extractKpiValue(periodA.kpis, 'api_calls', 0),
        systemUptime: this.extractKpiValue(periodA.kpis, 'system_uptime', 0),
        lastDeployment: this.extractKpiValue(periodA.kpis, 'last_deployment', new Date().toISOString()),
      },
      abTests: periodA.charts?.abTests || [],
      modelAlerts: periodA.alerts || [],
      auditLogs: periodA.charts?.auditLogs || [],
    };
  }

  private mergeModelPerformance(dataA: any[], dataB: any[]): any[] {
    // Create a map to merge performance data
    const perfMap = new Map();
    
    dataA.forEach(item => {
      perfMap.set(item.date, {
        ...item,
        periodAAccuracy: item.accuracy,
        periodAWmape: item.wmape
      });
    });
    
    dataB.forEach(item => {
      if (perfMap.has(item.date)) {
        const existing = perfMap.get(item.date);
        existing.periodBAccuracy = item.accuracy;
        existing.periodBWmape = item.wmape;
      }
    });
    
    return Array.from(perfMap.values());
  }

  private extractKpiValue(kpis: any[], key: string, defaultValue: any): any {
    // Normalize key: convert to lowercase and replace underscores with dashes
    const normalizedKey = key.toLowerCase().replace(/_/g, '-');
    
    const kpi = kpis?.find(k => {
      // Check all possible property names and normalize them
      const kpiId = (k.id || k.key || k.metric || k.name || '').toLowerCase().replace(/_/g, '-');
      return kpiId === normalizedKey;
    });
    
    return kpi?.value ?? kpi?.current ?? defaultValue;
  }

  private mapAlertType(type: string): 'accuracy' | 'drift' | 'bias' | 'performance' {
    const typeMap: { [key: string]: 'accuracy' | 'drift' | 'bias' | 'performance' } = {
      'accuracy': 'accuracy',
      'drift': 'drift',
      'bias': 'bias',
      'performance': 'performance',
      'model': 'accuracy',
      'data': 'drift',
    };
    return typeMap[type] || 'performance';
  }
}

export const superuserService = new SuperuserService();
export default superuserService;