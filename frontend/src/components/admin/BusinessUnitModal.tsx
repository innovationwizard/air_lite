// frontend/src/components/admin/BusinessUnitModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';
import adminService, { BusinessUnit } from '@/services/adminService';

interface BusinessUnitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  businessUnitId?: number;
  mode: 'create' | 'edit';
}

export function BusinessUnitModal({
  isOpen,
  onClose,
  onSuccess,
  businessUnitId,
  mode
}: BusinessUnitModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    parentId: 0,
    isActive: true
  });

  const [parentUnits, setParentUnits] = useState<BusinessUnit[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && mode === 'edit' && businessUnitId) {
      loadBusinessUnitData();
    } else if (isOpen && mode === 'create') {
      resetForm();
    }
  }, [isOpen, mode, businessUnitId]);

  useEffect(() => {
    if (isOpen) {
      loadParentUnits();
    }
  }, [isOpen]);

  const loadBusinessUnitData = async () => {
    try {
      setLoadingData(true);
      setError(null);
      const data = await adminService.getBusinessUnitById(businessUnitId!);
      setFormData({
        name: data.name || '',
        code: data.code || '',
        description: data.description || '',
        parentId: data.parentId || 0,
        isActive: data.isActive ?? true
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingData(false);
    }
  };

  const loadParentUnits = async () => {
    try {
      const response = await adminService.getBusinessUnits({ limit: 100, active: true });
      const units = response.data || response || [];
      // Filter out current unit if editing
      const filteredUnits = businessUnitId
        ? units.filter((u: BusinessUnit) => u.id !== businessUnitId)
        : units;
      setParentUnits(filteredUnits);
    } catch (err: unknown) {
      console.error('Error loading parent units:', err);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      parentId: 0,
      isActive: true
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
        description: formData.description.trim() || undefined,
        parentId: formData.parentId || undefined,
        isActive: formData.isActive
      };

      if (mode === 'create') {
        await adminService.createBusinessUnit(submitData);
      } else {
        await adminService.updateBusinessUnit(businessUnitId!, submitData);
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Crear Unidad de Negocio' : 'Editar Unidad de Negocio'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Complete el formulario para crear una nueva unidad de negocio.'
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Nombre <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Ventas Norte"
                    disabled={loading}
                    className={validationErrors.name ? 'border-red-500' : ''}
                  />
                  {validationErrors.name && (
                    <p className="text-xs text-red-500">{validationErrors.name}</p>
                  )}
                </div>

                {/* Code */}
                <div className="space-y-2">
                  <Label htmlFor="code">
                    Código <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => handleInputChange('code', e.target.value.toUpperCase())}
                    placeholder="VENTA-NORTE"
                    disabled={loading}
                    className={validationErrors.code ? 'border-red-500' : ''}
                  />
                  {validationErrors.code && (
                    <p className="text-xs text-red-500">{validationErrors.code}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    Solo mayúsculas, números, guiones y guiones bajos
                  </p>
                </div>
              </div>

              {/* Parent Unit */}
              <div className="space-y-2">
                <Label htmlFor="parentId">Unidad de Negocio Padre</Label>
                <select
                  id="parentId"
                  value={formData.parentId}
                  onChange={(e) => handleInputChange('parentId', parseInt(e.target.value))}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value={0}>Sin unidad padre (nivel superior)</option>
                  {parentUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  Seleccione una unidad padre para crear una jerarquía
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Descripción</Label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Descripción de la unidad de negocio..."
                  rows={3}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md resize-none"
                />
              </div>

              {/* Active Status */}
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
                  Unidad de negocio activa
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
                {mode === 'create' ? 'Crear Unidad' : 'Guardar Cambios'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
