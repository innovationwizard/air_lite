// frontend/src/components/admin/UserDetailModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  User as UserIcon,
  Mail,
  Shield,
  Building2,
  Calendar,
  Activity,
  Clock,
  LogIn,
  RefreshCw
} from 'lucide-react';
import adminService, { User, ActivityLog } from '@/services/adminService';

interface UserDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: number;
  onEdit?: () => void;
}

export function UserDetailModal({
  isOpen,
  onClose,
  userId,
  onEdit
}: UserDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activityStats, setActivityStats] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && userId) {
      loadUserDetails();
    }
  }, [isOpen, userId]);

  const loadUserDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const [userData, activityData, sessionsData] = await Promise.all([
        adminService.getUserById(userId),
        adminService.getUserActivityStats(userId, {
          fechaInicio: startDate.toISOString().split('T')[0],
          fechaFin: endDate.toISOString().split('T')[0],
          granularidad: 'diario'
        }).catch(() => null),
        adminService.getUserSessions(userId).catch(() => [])
      ]);

      setUser(userData);
      setActivityStats(activityData);
      setSessions(sessionsData || []);

      // Load recent activity
      const logsResponse = await adminService.getActivityLogs({
        user: userData.username,
        limit: 10,
        fechaInicio: startDate.toISOString().split('T')[0],
        fechaFin: endDate.toISOString().split('T')[0],
        granularidad: 'diario'
      }).catch(() => ({ data: [] }));

      setRecentActivity(logsResponse.data || logsResponse || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-GT', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <Badge className="bg-green-100 text-green-800 border-green-200">Activo</Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800 border-red-200">Inactivo</Badge>
    );
  };

  const getActionIcon = (action: string) => {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('login') || actionLower.includes('signin')) {
      return <LogIn className="h-3 w-3" />;
    }
    if (actionLower.includes('create')) {
      return <Activity className="h-3 w-3 text-green-600" />;
    }
    if (actionLower.includes('update') || actionLower.includes('edit')) {
      return <RefreshCw className="h-3 w-3 text-blue-600" />;
    }
    return <Activity className="h-3 w-3" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalles del Usuario</DialogTitle>
          <DialogDescription>
            Información completa y actividad del usuario
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : user ? (
          <div className="space-y-6">
            {/* User Overview Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Información General</CardTitle>
                  {getStatusBadge(user.isActive)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Username */}
                  <div className="flex items-start space-x-3">
                    <UserIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">Usuario</p>
                      <p className="text-base font-semibold">{user.username}</p>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex items-start space-x-3">
                    <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">Correo Electrónico</p>
                      <p className="text-base">{user.email}</p>
                    </div>
                  </div>

                  {/* Full Name */}
                  {(user.firstName || user.lastName) && (
                    <div className="flex items-start space-x-3">
                      <UserIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">Nombre Completo</p>
                        <p className="text-base">
                          {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Role */}
                  <div className="flex items-start space-x-3">
                    <Shield className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">Rol</p>
                      <p className="text-base">{user.role}</p>
                    </div>
                  </div>

                  {/* Business Unit */}
                  {user.businessUnit && (
                    <div className="flex items-start space-x-3">
                      <Building2 className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">Unidad de Negocio</p>
                        <p className="text-base">{user.businessUnit}</p>
                      </div>
                    </div>
                  )}

                  {/* Created At */}
                  <div className="flex items-start space-x-3">
                    <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">Fecha de Creación</p>
                      <p className="text-base text-sm">{formatDate(user.createdAt)}</p>
                    </div>
                  </div>

                  {/* Last Login */}
                  {user.lastLogin && (
                    <div className="flex items-start space-x-3">
                      <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">Último Acceso</p>
                        <p className="text-base text-sm">{formatDate(user.lastLogin)}</p>
                      </div>
                    </div>
                  )}

                  {/* Failed Login Attempts */}
                  {user.failedLoginAttempts !== undefined && user.failedLoginAttempts > 0 && (
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="h-5 w-5 text-orange-500 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">Intentos Fallidos</p>
                        <p className="text-base font-semibold text-orange-600">
                          {user.failedLoginAttempts}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Activity Statistics */}
            {activityStats && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Estadísticas de Actividad (Últimos 30 días)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">
                        {activityStats.totalActions || 0}
                      </p>
                      <p className="text-sm text-gray-600">Acciones Totales</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">
                        {activityStats.loginCount || 0}
                      </p>
                      <p className="text-sm text-gray-600">Inicios de Sesión</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <p className="text-2xl font-bold text-purple-600">
                        {activityStats.avgSessionDuration || 0} min
                      </p>
                      <p className="text-sm text-gray-600">Sesión Promedio</p>
                    </div>
                    <div className="text-center p-4 bg-orange-50 rounded-lg">
                      <p className="text-2xl font-bold text-orange-600">
                        {activityStats.activeDays || 0}
                      </p>
                      <p className="text-sm text-gray-600">Días Activos</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active Sessions */}
            {sessions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Sesiones Activas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {sessions.map((session: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{session.ipAddress || 'IP Desconocida'}</p>
                          <p className="text-xs text-gray-500">{session.userAgent || 'Navegador desconocido'}</p>
                          <p className="text-xs text-gray-400">
                            Iniciada: {formatDate(session.createdAt)}
                          </p>
                        </div>
                        <Badge variant="outline" className="bg-green-50">Activa</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Actividad Reciente</CardTitle>
              </CardHeader>
              <CardContent>
                {recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {recentActivity.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                        <div className="mt-1">
                          {getActionIcon(log.action)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{log.action}</p>
                            <Badge
                              variant="outline"
                              className={
                                log.status === 'success'
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }
                            >
                              {log.status === 'success' ? 'Exitoso' : 'Fallido'}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-600">
                            {log.resource}
                            {log.resourceId && ` #${log.resourceId}`}
                          </p>
                          {log.details && (
                            <p className="text-xs text-gray-500">{log.details}</p>
                          )}
                          <p className="text-xs text-gray-400">
                            {formatDate(log.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No hay actividad reciente registrada
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
              {onEdit && (
                <Button onClick={onEdit}>
                  Editar Usuario
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
