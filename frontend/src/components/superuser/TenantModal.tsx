// frontend/src/components/superuser/TenantModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';
import superuserService from '@/services/superuserService';

interface TenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tenantId?: number;
  mode: 'create' | 'edit';
}

export function TenantModal({
  isOpen,
  onClose,
  onSuccess,
  tenantId,
  mode
}: TenantModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    domain: '',
    subscriptionPlan: 'basic',
    maxUsers: 10,
    storageLimit: 10240,
    apiCallsLimit: 10000,
    contactEmail: '',
    contactName: '',
    status: 'active' as 'active' | 'inactive' | 'suspended'
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && mode === 'edit' && tenantId) {
      loadTenantData();
    } else if (isOpen && mode === 'create') {
      resetForm();
    }
  }, [isOpen, mode, tenantId]);

  const loadTenantData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const data = await superuserService.getTenantById(tenantId!);
      setFormData({
        name: data.name || '',
        code: data.code || '',
        domain: data.domain || '',
        subscriptionPlan: data.subscriptionPlan || 'basic',
        maxUsers: data.maxUsers || 10,
        storageLimit: data.storageLimit || 10240,
        apiCallsLimit: data.apiCallsLimit || 10000,
        contactEmail: data.contactEmail || '',
        contactName: data.contactName || '',
        status: data.status || 'active'
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
      code: '',
      domain: '',
      subscriptionPlan: 'basic',
      maxUsers: 10,
      storageLimit: 10240,
      apiCallsLimit: 10000,
      contactEmail: '',
      contactName: '',
      status: 'active'
    });
    setValidationErrors({});
    setError(null);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'El nombre es requerido';
    } else if (formData.name.length < 3) {
      errors.name = 'El nombre debe tener al menos 3 caracteres';
    }

    if (!formData.code.trim()) {
      errors.code = 'El código es requerido';
    } else if (formData.code.length < 2) {
      errors.code = 'El código debe tener al menos 2 caracteres';
    } else if (!/^[A-Z0-9_-]+$/.test(formData.code)) {
      errors.code = 'El código solo puede contener mayúsculas, números, guiones y guiones bajos';
    }

    if (!formData.contactEmail.trim()) {
      errors.contactEmail = 'El email de contacto es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)) {
      errors.contactEmail = 'El email no es válido';
    }

    if (formData.maxUsers < 1) {
      errors.maxUsers = 'Debe permitir al menos 1 usuario';
    }

    if (formData.storageLimit < 1024) {
      errors.storageLimit = 'El límite de almacenamiento mínimo es 1GB (1024 MB)';
    }

    if (formData.apiCallsLimit < 1000) {
      errors.apiCallsLimit = 'El límite mínimo de llamadas API es 1000';
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

      const submitData = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        domain: formData.domain.trim() || undefined,
        subscriptionPlan: formData.subscriptionPlan,
        maxUsers: formData.maxUsers,
        storageLimit: formData.storageLimit,
        apiCallsLimit: formData.apiCallsLimit,
        contactEmail: formData.contactEmail.trim(),
        contactName: formData.contactName.trim() || undefined,
      };

      if (mode === 'create') {
        await superuserService.createTenant(submitData);
      } else {
        await superuserService.updateTenant(tenantId!, {
          ...submitData,
          status: formData.status
        });
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

  const subscriptionPlans = [
    { value: 'trial', label: 'Trial (Prueba)' },
    { value: 'basic', label: 'Basic (Básico)' },
    { value: 'professional', label: 'Professional (Profesional)' },
    { value: 'enterprise', label: 'Enterprise (Empresarial)' },
    { value: 'custom', label: 'Custom (Personalizado)' }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Crear Tenant' : 'Editar Tenant'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Complete el formulario para crear un nuevo tenant en el sistema.'
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
                      placeholder="Acme Corporation"
                      disabled={loading}
                      className={validationErrors.name ? 'border-red-500' : ''}
                    />
                    {validationErrors.name && (
                      <p className="text-xs text-red-500">{validationErrors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="code">
                      Código <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="code"
                      value={formData.code}
                      onChange={(e) => handleInputChange('code', e.target.value.toUpperCase())}
                      placeholder="ACME-CORP"
                      disabled={loading || mode === 'edit'}
                      className={validationErrors.code ? 'border-red-500' : ''}
                    />
                    {validationErrors.code && (
                      <p className="text-xs text-red-500">{validationErrors.code}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      Solo mayúsculas, números, guiones y guiones bajos
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="domain">Dominio</Label>
                    <Input
                      id="domain"
                      value={formData.domain}
                      onChange={(e) => handleInputChange('domain', e.target.value)}
                      placeholder="acme.ejemplo.com"
                      disabled={loading}
                    />
                    <p className="text-xs text-gray-500">
                      Dominio personalizado para este tenant (opcional)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subscriptionPlan">
                      Plan de Suscripción <span className="text-red-500">*</span>
                    </Label>
                    <select
                      id="subscriptionPlan"
                      value={formData.subscriptionPlan}
                      onChange={(e) => handleInputChange('subscriptionPlan', e.target.value)}
                      disabled={loading}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {subscriptionPlans.map((plan) => (
                        <option key={plan.value} value={plan.value}>
                          {plan.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Limits & Quotas */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Límites y Cuotas</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maxUsers">
                      Usuarios Máximos <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="maxUsers"
                      type="number"
                      value={formData.maxUsers}
                      onChange={(e) => handleInputChange('maxUsers', parseInt(e.target.value) || 0)}
                      min="1"
                      disabled={loading}
                      className={validationErrors.maxUsers ? 'border-red-500' : ''}
                    />
                    {validationErrors.maxUsers && (
                      <p className="text-xs text-red-500">{validationErrors.maxUsers}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="storageLimit">
                      Límite de Almacenamiento (MB) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="storageLimit"
                      type="number"
                      value={formData.storageLimit}
                      onChange={(e) => handleInputChange('storageLimit', parseInt(e.target.value) || 0)}
                      min="1024"
                      disabled={loading}
                      className={validationErrors.storageLimit ? 'border-red-500' : ''}
                    />
                    {validationErrors.storageLimit && (
                      <p className="text-xs text-red-500">{validationErrors.storageLimit}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      {(formData.storageLimit / 1024).toFixed(2)} GB
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="apiCallsLimit">
                      Límite de Llamadas API <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="apiCallsLimit"
                      type="number"
                      value={formData.apiCallsLimit}
                      onChange={(e) => handleInputChange('apiCallsLimit', parseInt(e.target.value) || 0)}
                      min="1000"
                      disabled={loading}
                      className={validationErrors.apiCallsLimit ? 'border-red-500' : ''}
                    />
                    {validationErrors.apiCallsLimit && (
                      <p className="text-xs text-red-500">{validationErrors.apiCallsLimit}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="border-b pb-4">
                <h3 className="text-sm font-semibold mb-3">Información de Contacto</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contactEmail">
                      Email de Contacto <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => handleInputChange('contactEmail', e.target.value)}
                      placeholder="contacto@acme.com"
                      disabled={loading}
                      className={validationErrors.contactEmail ? 'border-red-500' : ''}
                    />
                    {validationErrors.contactEmail && (
                      <p className="text-xs text-red-500">{validationErrors.contactEmail}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contactName">Nombre de Contacto</Label>
                    <Input
                      id="contactName"
                      value={formData.contactName}
                      onChange={(e) => handleInputChange('contactName', e.target.value)}
                      placeholder="Juan Pérez"
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              {/* Status (only in edit mode) */}
              {mode === 'edit' && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Estado del Tenant</h3>
                  <div className="space-y-2">
                    <Label htmlFor="status">Estado</Label>
                    <select
                      id="status"
                      value={formData.status}
                      onChange={(e) => handleInputChange('status', e.target.value)}
                      disabled={loading}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                      <option value="suspended">Suspendido</option>
                    </select>
                  </div>
                </div>
              )}
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
                {mode === 'create' ? 'Crear Tenant' : 'Guardar Cambios'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
