// frontend/src/components/superuser/JobDetailModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertCircle, RotateCw, X, CheckCircle, Clock, Play } from 'lucide-react';
import superuserService, { JobQueue } from '@/services/superuserService';

interface JobDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  jobId?: string;
}

export function JobDetailModal({
  isOpen,
  onClose,
  onSuccess,
  jobId
}: JobDetailModalProps) {
  const [loadingData, setLoadingData] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobQueue | null>(null);

  useEffect(() => {
    if (isOpen && jobId) {
      loadJobData();
    }
  }, [isOpen, jobId]);

  const loadJobData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const data = await superuserService.getJobById(jobId!);
      setJob(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingData(false);
    }
  };

  const handleRetry = async () => {
    if (!job) return;

    try {
      setActionLoading(true);
      setError(null);
      await superuserService.retryJob(job.id);
      await loadJobData();
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;

    if (!confirm('¿Está seguro de que desea cancelar este trabajo?')) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      await superuserService.cancelJob(job.id);
      await loadJobData();
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = () => {
    if (!loadingData && !actionLoading) {
      setJob(null);
      setError(null);
      onClose();
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'running':
        return <Play className="h-5 w-5 text-blue-600 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-gray-600" />;
      case 'cancelled':
        return <X className="h-5 w-5 text-gray-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'normal':
        return 'bg-blue-100 text-blue-800';
      case 'low':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      model_training: 'Entrenamiento de Modelo',
      data_sync: 'Sincronización de Datos',
      report_generation: 'Generación de Reportes',
      batch_prediction: 'Predicción en Lote',
      maintenance: 'Mantenimiento'
    };
    return labels[type] || type;
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Detalles del Trabajo
          </DialogTitle>
          <DialogDescription>
            Información detallada del trabajo en cola
          </DialogDescription>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : job ? (
          <div className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Status Overview */}
            <div className="bg-gray-50 p-4 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(job.status)}
                  <div>
                    <h3 className="font-semibold text-lg">{job.name}</h3>
                    <p className="text-sm text-gray-500">ID: {job.id}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge className={getStatusColor(job.status)}>
                    {job.status.toUpperCase()}
                  </Badge>
                  <Badge className={getPriorityColor(job.priority)}>
                    {job.priority.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {/* Progress Bar */}
              {job.status === 'running' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Progreso</span>
                    <span className="font-medium">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>
              )}
            </div>

            {/* Job Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Tipo</p>
                  <p className="font-medium">{getTypeLabel(job.type)}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Fecha de Inicio</p>
                  <p className="font-medium">{formatDate(job.startedAt)}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Fecha de Completado</p>
                  <p className="font-medium">{formatDate(job.completedAt)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Duración Estimada</p>
                  <p className="font-medium">{formatDuration(job.estimatedDuration)}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Intentos</p>
                  <p className="font-medium">
                    {job.attempts} / {job.maxAttempts}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Prioridad</p>
                  <p className="font-medium capitalize">{job.priority}</p>
                </div>
              </div>
            </div>

            {/* Error Message (if failed) */}
            {job.status === 'failed' && job.error && (
              <div className="border-l-4 border-red-500 bg-red-50 p-4">
                <h4 className="font-semibold text-red-800 mb-2">Error</h4>
                <p className="text-sm text-red-700 font-mono">{job.error}</p>
              </div>
            )}

            {/* Metadata */}
            {job.metadata && Object.keys(job.metadata).length > 0 && (
              <div className="border rounded-lg">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <h4 className="font-semibold">Metadatos del Trabajo</h4>
                </div>
                <div className="p-4">
                  <pre className="text-sm bg-gray-50 p-3 rounded overflow-x-auto">
                    {JSON.stringify(job.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              {(job.status === 'failed' || job.status === 'cancelled') && job.attempts < job.maxAttempts && (
                <Button
                  onClick={handleRetry}
                  disabled={actionLoading}
                  variant="outline"
                  className="flex-1"
                >
                  {actionLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="mr-2 h-4 w-4" />
                  )}
                  Reintentar Trabajo
                </Button>
              )}

              {(job.status === 'pending' || job.status === 'running') && (
                <Button
                  onClick={handleCancel}
                  disabled={actionLoading}
                  variant="destructive"
                  className="flex-1"
                >
                  {actionLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <X className="mr-2 h-4 w-4" />
                  )}
                  Cancelar Trabajo
                </Button>
              )}

              {job.attempts >= job.maxAttempts && job.status === 'failed' && (
                <Alert className="flex-1">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Se alcanzó el número máximo de intentos. No se puede reintentar.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            No se encontró información del trabajo
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loadingData || actionLoading}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
