// frontend/src/components/superuser/DataSourceModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, Database, TestTube } from 'lucide-react';
import superuserService from '@/services/superuserService';

interface DataSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sourceId?: number;
  mode: 'create' | 'edit';
}

export function DataSourceModal({
  isOpen,
  onClose,
  onSuccess,
  sourceId,
  mode
}: DataSourceModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    type: 'postgres' as 'postgres' | 'mysql' | 'mongodb' | 's3' | 'api' | 'sftp',
    host: '',
    port: 5432,
    database: '',
    syncFrequency: '1h',
    tenantId: 0,
    username: '',
    password: '',
    ssl: false,
    connectionString: ''
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && mode === 'edit' && sourceId) {
      loadDataSourceData();
    } else if (isOpen && mode === 'create') {
      resetForm();
    }
  }, [isOpen, mode, sourceId]);

  useEffect(() => {
    // Set default port based on type
    const defaultPorts: Record<string, number> = {
      postgres: 5432,
      mysql: 3306,
      mongodb: 27017,
      s3: 443,
      api: 443,
      sftp: 22
    };

    if (mode === 'create') {
      setFormData(prev => ({ ...prev, port: defaultPorts[prev.type] || 0 }));
    }
  }, [formData.type, mode]);

  const loadDataSourceData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const data = await superuserService.getDataSourceById(sourceId!);
      setFormData({
        name: data.name || '',
        type: data.type || 'postgres',
        host: data.host || '',
        port: data.port || 5432,
        database: data.database || '',
        syncFrequency: data.syncFrequency || '1h',
        tenantId: data.tenantId || 0,
        username: data.config?.username || '',
        password: '',
        ssl: data.config?.ssl || false,
        connectionString: data.config?.connectionString || ''
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingData(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'postgres',
      host: '',
      port: 5432,
      database: '',
      syncFrequency: '1h',
      tenantId: 0,
      username: '',
      password: '',
      ssl: false,
      connectionString: ''
    });
    setValidationErrors({});
    setError(null);
    setTestResult(null);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'El nombre es requerido';
    } else if (formData.name.length < 3) {
      errors.name = 'El nombre debe tener al menos 3 caracteres';
    }

    // Validation based on type
    if (['postgres', 'mysql', 'mongodb'].includes(formData.type)) {
      if (!formData.host.trim()) {
        errors.host = 'El host es requerido';
      }
      if (!formData.port || formData.port < 1 || formData.port > 65535) {
        errors.port = 'Puerto inválido (1-65535)';
      }
      if (formData.type !== 'mongodb' && !formData.database.trim()) {
        errors.database = 'El nombre de la base de datos es requerido';
      }
      if (mode === 'create' && !formData.username.trim()) {
        errors.username = 'El nombre de usuario es requerido';
      }
      if (mode === 'create' && !formData.password.trim()) {
        errors.password = 'La contraseña es requerida';
      }
    } else if (formData.type === 'api') {
      if (!formData.host.trim()) {
        errors.host = 'La URL del API es requerida';
      }
    } else if (formData.type === 's3') {
      if (!formData.host.trim()) {
        errors.host = 'El bucket name es requerido';
      }
    } else if (formData.type === 'sftp') {
      if (!formData.host.trim()) {
        errors.host = 'El host es requerido';
      }
      if (mode === 'create' && !formData.username.trim()) {
        errors.username = 'El nombre de usuario es requerido';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      if (sourceId) {
        const result = await superuserService.testDataSourceConnection(sourceId);
        setTestResult({
          success: true,
          message: result.message || 'Conexión exitosa'
        });
      } else {
        setTestResult({
          success: false,
          message: 'Guarde primero la fuente de datos para probar la conexión'
        });
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'An error occurred'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const config: Record<string, any> = {
        ssl: formData.ssl
      };

      if (formData.username) config.username = formData.username;
      if (formData.password) config.password = formData.password;
      if (formData.connectionString) config.connectionString = formData.connectionString;

      const submitData = {
        name: formData.name.trim(),
        type: formData.type,
        host: formData.host.trim() || undefined,
        port: formData.port || undefined,
        database: formData.database.trim() || undefined,
        syncFrequency: formData.syncFrequency,
        tenantId: formData.tenantId || undefined,
        config
      };

      if (mode === 'create') {
        await superuserService.createDataSource(submitData);
      } else {
        await superuserService.updateDataSource(sourceId!, submitData);
      }

      onSuccess();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading && !testing) {
      resetForm();
      onClose();
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    setTestResult(null);
  };

  const dataSourceTypes = [
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL / MariaDB' },
    { value: 'mongodb', label: 'MongoDB' },
    { value: 's3', label: 'Amazon S3' },
    { value: 'api', label: 'REST API' },
    { value: 'sftp', label: 'SFTP' }
  ];

  const syncFrequencies = [
    { value: '5m', label: 'Cada 5 minutos' },
    { value: '15m', label: 'Cada 15 minutos' },
    { value: '30m', label: 'Cada 30 minutos' },
    { value: '1h', label: 'Cada hora' },
    { value: '6h', label: 'Cada 6 horas' },
    { value: '12h', label: 'Cada 12 horas' },
    { value: '24h', label: 'Cada 24 horas' },
    { value: 'manual', label: 'Manual' }
  ];

  const renderConnectionFields = () => {
    switch (formData.type) {
      case 'postgres':
      case 'mysql':
        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="host">
                  Host <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="host"
                  value={formData.host}
                  onChange={(e) => handleInputChange('host', e.target.value)}
                  placeholder="localhost o 192.168.1.100"
                  disabled={loading}
                  className={validationErrors.host ? 'border-red-500' : ''}
                />
                {validationErrors.host && (
                  <p className="text-xs text-red-500">{validationErrors.host}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="port">
                  Puerto <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => handleInputChange('port', parseInt(e.target.value) || 0)}
                  disabled={loading}
                  className={validationErrors.port ? 'border-red-500' : ''}
                />
                {validationErrors.port && (
                  <p className="text-xs text-red-500">{validationErrors.port}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="database">
                Base de Datos <span className="text-red-500">*</span>
              </Label>
              <Input
                id="database"
                value={formData.database}
                onChange={(e) => handleInputChange('database', e.target.value)}
                placeholder="nombre_bd"
                disabled={loading}
                className={validationErrors.database ? 'border-red-500' : ''}
              />
              {validationErrors.database && (
                <p className="text-xs text-red-500">{validationErrors.database}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Usuario {mode === 'create' && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="db_user"
                  disabled={loading}
                  className={validationErrors.username ? 'border-red-500' : ''}
                />
                {validationErrors.username && (
                  <p className="text-xs text-red-500">{validationErrors.username}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">
                  Contraseña {mode === 'create' && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder={mode === 'edit' ? 'Dejar en blanco para no cambiar' : '********'}
                  disabled={loading}
                  className={validationErrors.password ? 'border-red-500' : ''}
                />
                {validationErrors.password && (
                  <p className="text-xs text-red-500">{validationErrors.password}</p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="ssl"
                checked={formData.ssl}
                onChange={(e) => handleInputChange('ssl', e.target.checked)}
                disabled={loading}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Label htmlFor="ssl" className="font-normal cursor-pointer">
                Usar SSL/TLS
              </Label>
            </div>
          </>
        );

      case 'mongodb':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="connectionString">
                Connection String <span className="text-red-500">*</span>
              </Label>
              <Input
                id="connectionString"
                value={formData.connectionString}
                onChange={(e) => handleInputChange('connectionString', e.target.value)}
                placeholder="mongodb://username:password@host:27017/database"
                disabled={loading}
              />
              <p className="text-xs text-gray-500">
                Formato: mongodb://username:password@host:port/database
              </p>
            </div>
          </>
        );

      case 's3':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="host">
                Bucket Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => handleInputChange('host', e.target.value)}
                placeholder="mi-bucket-s3"
                disabled={loading}
                className={validationErrors.host ? 'border-red-500' : ''}
              />
              {validationErrors.host && (
                <p className="text-xs text-red-500">{validationErrors.host}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Access Key ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">
                  Secret Access Key <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  disabled={loading}
                />
              </div>
            </div>
          </>
        );

      case 'api':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="host">
                URL del API <span className="text-red-500">*</span>
              </Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => handleInputChange('host', e.target.value)}
                placeholder="https://api.ejemplo.com"
                disabled={loading}
                className={validationErrors.host ? 'border-red-500' : ''}
              />
              {validationErrors.host && (
                <p className="text-xs text-red-500">{validationErrors.host}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">API Key (opcional)</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                placeholder="your-api-key"
                disabled={loading}
              />
            </div>
          </>
        );

      case 'sftp':
        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="host">
                  Host <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="host"
                  value={formData.host}
                  onChange={(e) => handleInputChange('host', e.target.value)}
                  placeholder="sftp.ejemplo.com"
                  disabled={loading}
                  className={validationErrors.host ? 'border-red-500' : ''}
                />
                {validationErrors.host && (
                  <p className="text-xs text-red-500">{validationErrors.host}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="port">Puerto</Label>
                <Input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => handleInputChange('port', parseInt(e.target.value) || 22)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Usuario <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="sftp_user"
                  disabled={loading}
                  className={validationErrors.username ? 'border-red-500' : ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="********"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="database">Ruta del Directorio</Label>
              <Input
                id="database"
                value={formData.database}
                onChange={(e) => handleInputChange('database', e.target.value)}
                placeholder="/uploads/data"
                disabled={loading}
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {mode === 'create' ? 'Crear Fuente de Datos' : 'Editar Fuente de Datos'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Configure una nueva fuente de datos para sincronizar información.'
              : 'Modifique la configuración de la fuente de datos.'}
          </DialogDescription>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {testResult && (
              <Alert variant={testResult.success ? 'default' : 'destructive'}>
                <TestTube className="h-4 w-4" />
                <AlertDescription>{testResult.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              {/* Basic Information */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Información Básica</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Nombre <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      placeholder="Base de Datos Principal"
                      disabled={loading}
                      className={validationErrors.name ? 'border-red-500' : ''}
                    />
                    {validationErrors.name && (
                      <p className="text-xs text-red-500">{validationErrors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="type">
                      Tipo <span className="text-red-500">*</span>
                    </Label>
                    <select
                      id="type"
                      value={formData.type}
                      onChange={(e) => handleInputChange('type', e.target.value)}
                      disabled={loading || mode === 'edit'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {dataSourceTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Connection Configuration */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Configuración de Conexión</h3>
                <div className="space-y-4">
                  {renderConnectionFields()}
                </div>
              </div>

              {/* Sync Configuration */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Configuración de Sincronización</h3>
                <div className="space-y-2">
                  <Label htmlFor="syncFrequency">Frecuencia de Sincronización</Label>
                  <select
                    id="syncFrequency"
                    value={formData.syncFrequency}
                    onChange={(e) => handleInputChange('syncFrequency', e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {syncFrequencies.map((freq) => (
                      <option key={freq.value} value={freq.value}>
                        {freq.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              {mode === 'edit' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={loading || testing}
                >
                  {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <TestTube className="mr-2 h-4 w-4" />
                  Probar Conexión
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading || testing}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading || testing}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'create' ? 'Crear Fuente' : 'Guardar Cambios'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
