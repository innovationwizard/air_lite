// frontend/src/components/admin/UserCreateEditModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import adminService, { Role, BusinessUnit } from '@/services/adminService';

interface UserCreateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId?: number;
  mode: 'create' | 'edit';
}

export function UserCreateEditModal({
  isOpen,
  onClose,
  onSuccess,
  userId,
  mode
}: UserCreateEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Form data
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    roleId: 0,
    businessUnitId: 0,
    isActive: true
  });

  // Options data
  const [roles, setRoles] = useState<Role[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);

  // Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Load user data if editing
  useEffect(() => {
    if (isOpen && mode === 'edit' && userId) {
      loadUserData();
    } else if (isOpen && mode === 'create') {
      resetForm();
    }
  }, [isOpen, mode, userId]);

  // Load roles and business units
  useEffect(() => {
    if (isOpen) {
      loadOptions();
    }
  }, [isOpen]);

  const loadUserData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const userData = await adminService.getUserById(userId!);
      setFormData({
        username: userData.username || '',
        email: userData.email || '',
        password: '',
        confirmPassword: '',
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        roleId: userData.roleId || 0,
        businessUnitId: userData.businessUnitId || 0,
        isActive: userData.isActive ?? true
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingData(false);
    }
  };

  const loadOptions = async () => {
    try {
      const [rolesData, businessUnitsData] = await Promise.all([
        adminService.getRoles({ limit: 100 }),
        adminService.getBusinessUnits({ limit: 100, active: true })
      ]);
      setRoles(rolesData.data || rolesData || []);
      setBusinessUnits(businessUnitsData.data || businessUnitsData || []);
    } catch (err: unknown) {
      console.error('Error loading options:', err);
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
      roleId: 0,
      businessUnitId: 0,
      isActive: true
    });
    setValidationErrors({});
    setError(null);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Username validation
    if (!formData.username.trim()) {
      errors.username = 'El nombre de usuario es requerido';
    } else if (formData.username.length < 3) {
      errors.username = 'El nombre de usuario debe tener al menos 3 caracteres';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.username)) {
      errors.username = 'El nombre de usuario solo puede contener letras, números, guiones y guiones bajos';
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'El correo electrónico es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Formato de correo electrónico inválido';
    }

    // Password validation (only for create or if password is provided in edit)
    if (mode === 'create' || formData.password) {
      if (!formData.password) {
        errors.password = 'La contraseña es requerida';
      } else if (formData.password.length < 8) {
        errors.password = 'La contraseña debe tener al menos 8 caracteres';
      } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
        errors.password = 'La contraseña debe contener mayúsculas, minúsculas y números';
      }

      if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden';
      }
    }

    // Role validation
    if (!formData.roleId || formData.roleId === 0) {
      errors.roleId = 'Debe seleccionar un rol';
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

      if (mode === 'create') {
        await adminService.createUser({
          username: formData.username.trim(),
          email: formData.email.trim(),
          password: formData.password,
          firstName: formData.firstName.trim() || undefined,
          lastName: formData.lastName.trim() || undefined,
          roleId: formData.roleId,
          businessUnitId: formData.businessUnitId || undefined,
          isActive: formData.isActive
        });
      } else {
        const updateData: any = {
          username: formData.username.trim(),
          email: formData.email.trim(),
          firstName: formData.firstName.trim() || undefined,
          lastName: formData.lastName.trim() || undefined,
          roleId: formData.roleId,
          businessUnitId: formData.businessUnitId || undefined,
          isActive: formData.isActive
        };

        // Only include password if it was changed
        if (formData.password) {
          updateData.password = formData.password;
        }

        await adminService.updateUser(userId!, updateData);
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
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Crear Nuevo Usuario' : 'Editar Usuario'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Complete el formulario para crear un nuevo usuario en el sistema.'
              : 'Modifique los campos que desea actualizar.'}
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

            {/* Account Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                Información de Cuenta
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Username */}
                <div className="space-y-2">
                  <Label htmlFor="username">
                    Nombre de Usuario <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    placeholder="usuario123"
                    disabled={loading}
                    className={validationErrors.username ? 'border-red-500' : ''}
                  />
                  {validationErrors.username && (
                    <p className="text-xs text-red-500">{validationErrors.username}</p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email">
                    Correo Electrónico <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="usuario@empresa.com"
                    disabled={loading}
                    className={validationErrors.email ? 'border-red-500' : ''}
                  />
                  {validationErrors.email && (
                    <p className="text-xs text-red-500">{validationErrors.email}</p>
                  )}
                </div>
              </div>

              {/* Password Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password">
                    Contraseña {mode === 'create' && <span className="text-red-500">*</span>}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => handleInputChange('password', e.target.value)}
                      placeholder={mode === 'edit' ? 'Dejar en blanco para no cambiar' : '••••••••'}
                      disabled={loading}
                      className={validationErrors.password ? 'border-red-500 pr-10' : 'pr-10'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {validationErrors.password && (
                    <p className="text-xs text-red-500">{validationErrors.password}</p>
                  )}
                  {mode === 'create' && (
                    <p className="text-xs text-gray-500">
                      Mínimo 8 caracteres, incluir mayúsculas, minúsculas y números
                    </p>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">
                    Confirmar Contraseña {mode === 'create' && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    placeholder="••••••••"
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
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                Información Personal
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* First Name */}
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

                {/* Last Name */}
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

            {/* Role and Organization */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                Rol y Organización
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Role */}
                <div className="space-y-2">
                  <Label htmlFor="roleId">
                    Rol <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="roleId"
                    value={formData.roleId}
                    onChange={(e) => handleInputChange('roleId', parseInt(e.target.value))}
                    disabled={loading}
                    className={`w-full px-3 py-2 border rounded-md ${
                      validationErrors.roleId ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    <option value={0}>Seleccionar rol...</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {validationErrors.roleId && (
                    <p className="text-xs text-red-500">{validationErrors.roleId}</p>
                  )}
                </div>

                {/* Business Unit */}
                <div className="space-y-2">
                  <Label htmlFor="businessUnitId">Unidad de Negocio</Label>
                  <select
                    id="businessUnitId"
                    value={formData.businessUnitId}
                    onChange={(e) => handleInputChange('businessUnitId', parseInt(e.target.value))}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value={0}>Sin unidad de negocio</option>
                    {businessUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                Estado
              </h3>

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
                  Usuario activo (puede iniciar sesión)
                </Label>
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
