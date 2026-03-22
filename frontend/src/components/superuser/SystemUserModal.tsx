// frontend/src/components/superuser/SystemUserModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, Shield } from 'lucide-react';
import superuserService from '@/services/superuserService';

interface SystemUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId?: number;
  mode: 'create' | 'edit';
}

export function SystemUserModal({
  isOpen,
  onClose,
  onSuccess,
  userId,
  mode
}: SystemUserModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    role: 'support' as 'superuser' | 'system_admin' | 'support',
    isActive: true,
    permissions: [] as string[]
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && mode === 'edit' && userId) {
      loadUserData();
    } else if (isOpen && mode === 'create') {
      resetForm();
    }
  }, [isOpen, mode, userId]);

  const loadUserData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const data = await superuserService.getSystemUserById(userId!);
      setFormData({
        username: data.username || '',
        email: data.email || '',
        password: '',
        confirmPassword: '',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        role: data.role || 'support',
        isActive: data.isActive ?? true,
        permissions: data.permissions || []
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingData(false);
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      role: 'support',
      isActive: true,
      permissions: []
    });
    setValidationErrors({});
    setError(null);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.username.trim()) {
      errors.username = 'El nombre de usuario es requerido';
    } else if (formData.username.length < 3) {
      errors.username = 'El nombre de usuario debe tener al menos 3 caracteres';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.username)) {
      errors.username = 'Solo letras, números, guiones y guiones bajos';
    }

    if (!formData.email.trim()) {
      errors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'El email no es válido';
    }

    if (mode === 'create' || formData.password) {
      if (!formData.password) {
        errors.password = 'La contraseña es requerida';
      } else if (formData.password.length < 8) {
        errors.password = 'La contraseña debe tener al menos 8 caracteres';
      } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
        errors.password = 'Debe contener mayúsculas, minúsculas y números';
      }

      if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const submitData: any = {
        username: formData.username.trim(),
        email: formData.email.trim(),
        firstName: formData.firstName.trim() || undefined,
        lastName: formData.lastName.trim() || undefined,
        role: formData.role,
        isActive: formData.isActive,
        permissions: formData.permissions
      };

      if (formData.password && (mode === 'create' || formData.password)) {
        submitData.password = formData.password;
      }

      if (mode === 'create') {
        await superuserService.createSystemUser(submitData);
      } else {
        await superuserService.updateSystemUser(userId!, submitData);
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
    if (!loading) {
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
  };

  const handlePermissionToggle = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission]
    }));
  };

  const availablePermissions = [
    { value: 'manage_tenants', label: 'Gestionar Tenants' },
    { value: 'manage_users', label: 'Gestionar Usuarios' },
    { value: 'manage_data_sources', label: 'Gestionar Fuentes de Datos' },
    { value: 'view_system_health', label: 'Ver Salud del Sistema' },
    { value: 'manage_models', label: 'Gestionar Modelos AI' },
    { value: 'view_audit_logs', label: 'Ver Logs de Auditoría' },
    { value: 'manage_jobs', label: 'Gestionar Trabajos' },
    { value: 'manage_security', label: 'Gestionar Seguridad' },
    { value: 'view_infrastructure', label: 'Ver Infraestructura' },
    { value: 'manage_billing', label: 'Gestionar Facturación' }
  ];

  const roleDescriptions = {
    superuser: 'Acceso total al sistema sin restricciones',
    system_admin: 'Gestión de configuración y administración del sistema',
    support: 'Acceso limitado para soporte técnico'
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {mode === 'create' ? 'Crear Usuario del Sistema' : 'Editar Usuario del Sistema'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Crear un nuevo usuario con acceso al sistema administrativo.'
              : 'Modifique los campos que desea actualizar. Deje la contraseña en blanco para mantener la actual.'}
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

            <div className="space-y-4">
              {/* Account Information */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Información de Cuenta</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">
                      Nombre de Usuario <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="username"
                      value={formData.username}
                      onChange={(e) => handleInputChange('username', e.target.value.toLowerCase())}
                      placeholder="juan.perez"
                      disabled={loading || mode === 'edit'}
                      className={validationErrors.username ? 'border-red-500' : ''}
                    />
                    {validationErrors.username && (
                      <p className="text-xs text-red-500">{validationErrors.username}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      Solo letras, números, guiones y guiones bajos
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      placeholder="juan.perez@sistema.com"
                      disabled={loading}
                      className={validationErrors.email ? 'border-red-500' : ''}
                    />
                    {validationErrors.email && (
                      <p className="text-xs text-red-500">{validationErrors.email}</p>
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
                    {mode === 'create' && (
                      <p className="text-xs text-gray-500">
                        Mínimo 8 caracteres, con mayúsculas, minúsculas y números
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      Confirmar Contraseña {mode === 'create' && <span className="text-red-500">*</span>}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={formData.confirmPassword}
                      onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                      placeholder="********"
                      disabled={loading}
                      className={validationErrors.confirmPassword ? 'border-red-500' : ''}
                    />
                    {validationErrors.confirmPassword && (
                      <p className="text-xs text-red-500">{validationErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Personal Information */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Información Personal</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">Nombre</Label>
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) => handleInputChange('firstName', e.target.value)}
                      placeholder="Juan"
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">Apellido</Label>
                    <Input
                      id="lastName"
                      value={formData.lastName}
                      onChange={(e) => handleInputChange('lastName', e.target.value)}
                      placeholder="Pérez"
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              {/* Role & Permissions */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Rol y Permisos</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="role">
                      Rol del Sistema <span className="text-red-500">*</span>
                    </Label>
                    <select
                      id="role"
                      value={formData.role}
                      onChange={(e) => handleInputChange('role', e.target.value)}
                      disabled={loading}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="support">Support (Soporte)</option>
                      <option value="system_admin">System Admin (Administrador del Sistema)</option>
                      <option value="superuser">Superuser (Super Usuario)</option>
                    </select>
                    <p className="text-xs text-gray-500">
                      {roleDescriptions[formData.role]}
                    </p>
                  </div>

                  {formData.role !== 'superuser' && (
                    <div className="space-y-2">
                      <Label>Permisos Específicos</Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-4 bg-gray-50 rounded-md max-h-48 overflow-y-auto">
                        {availablePermissions.map((permission) => (
                          <label
                            key={permission.value}
                            className="flex items-center space-x-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.permissions.includes(permission.value)}
                              onChange={() => handlePermissionToggle(permission.value)}
                              disabled={loading}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm">{permission.label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500">
                        Los Superusers tienen todos los permisos automáticamente
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Status */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Estado</h3>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => handleInputChange('isActive', e.target.checked)}
                    disabled={loading}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label htmlFor="isActive" className="font-normal cursor-pointer">
                    Usuario activo (puede acceder al sistema)
                  </Label>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'create' ? 'Crear Usuario' : 'Guardar Cambios'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
