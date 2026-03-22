// frontend/src/components/admin/BulkUserActionsModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, AlertTriangle, Users, Shield, Building2, ToggleLeft } from 'lucide-react';
import adminService, { Role, BusinessUnit } from '@/services/adminService';

interface BulkUserActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  selectedUserIds: number[];
  selectedUserCount: number;
}

type BulkAction = 'activate' | 'deactivate' | 'change-role' | 'change-business-unit' | 'delete';

export function BulkUserActionsModal({
  isOpen,
  onClose,
  onSuccess,
  selectedUserIds,
  selectedUserCount
}: BulkUserActionsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<BulkAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  // Options for change actions
  const [roles, setRoles] = useState<Role[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number>(0);
  const [selectedBusinessUnitId, setSelectedBusinessUnitId] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      loadOptions();
    }
  }, [isOpen]);

  useEffect(() => {
    // Reset form when action changes
    setError(null);
    setConfirmDelete('');
    setSelectedRoleId(0);
    setSelectedBusinessUnitId(0);
  }, [selectedAction]);

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

  const validateAction = (): boolean => {
    if (!selectedAction) {
      setError('Debe seleccionar una acción');
      return false;
    }

    if (selectedAction === 'change-role' && (!selectedRoleId || selectedRoleId === 0)) {
      setError('Debe seleccionar un rol');
      return false;
    }

    if (selectedAction === 'change-business-unit' && (!selectedBusinessUnitId || selectedBusinessUnitId === 0)) {
      setError('Debe seleccionar una unidad de negocio');
      return false;
    }

    if (selectedAction === 'delete' && confirmDelete !== 'ELIMINAR') {
      setError('Debe escribir "ELIMINAR" para confirmar');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateAction()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      switch (selectedAction) {
        case 'activate':
          await adminService.bulkUpdateUsers(selectedUserIds, { isActive: true });
          break;

        case 'deactivate':
          await adminService.bulkUpdateUsers(selectedUserIds, { isActive: false });
          break;

        case 'change-role':
          await adminService.bulkUpdateUsers(selectedUserIds, { roleId: selectedRoleId });
          break;

        case 'change-business-unit':
          await adminService.bulkUpdateUsers(selectedUserIds, { businessUnitId: selectedBusinessUnitId });
          break;

        case 'delete':
          await adminService.bulkDeleteUsers(selectedUserIds);
          break;

        default:
          throw new Error('Acción no válida');
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
      setSelectedAction(null);
      setError(null);
      setConfirmDelete('');
      setSelectedRoleId(0);
      setSelectedBusinessUnitId(0);
      onClose();
    }
  };

  const getActionIcon = (action: BulkAction) => {
    switch (action) {
      case 'activate':
      case 'deactivate':
        return <ToggleLeft className="h-5 w-5" />;
      case 'change-role':
        return <Shield className="h-5 w-5" />;
      case 'change-business-unit':
        return <Building2 className="h-5 w-5" />;
      case 'delete':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <Users className="h-5 w-5" />;
    }
  };

  const getActionDescription = (action: BulkAction) => {
    switch (action) {
      case 'activate':
        return 'Los usuarios seleccionados podrán iniciar sesión en el sistema';
      case 'deactivate':
        return 'Los usuarios seleccionados no podrán iniciar sesión en el sistema';
      case 'change-role':
        return 'Cambiar el rol de todos los usuarios seleccionados';
      case 'change-business-unit':
        return 'Cambiar la unidad de negocio de todos los usuarios seleccionados';
      case 'delete':
        return 'Esta acción es irreversible. Los usuarios y su historial serán eliminados permanentemente';
      default:
        return '';
    }
  };

  const actions: { value: BulkAction; label: string; variant: 'default' | 'destructive' }[] = [
    { value: 'activate', label: 'Activar Usuarios', variant: 'default' },
    { value: 'deactivate', label: 'Desactivar Usuarios', variant: 'default' },
    { value: 'change-role', label: 'Cambiar Rol', variant: 'default' },
    { value: 'change-business-unit', label: 'Cambiar Unidad de Negocio', variant: 'default' },
    { value: 'delete', label: 'Eliminar Usuarios', variant: 'destructive' }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Acciones en Lote</DialogTitle>
          <DialogDescription>
            Aplicar acciones a {selectedUserCount} usuario{selectedUserCount !== 1 ? 's' : ''} seleccionado{selectedUserCount !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Action Selection */}
          {!selectedAction ? (
            <div className="space-y-3">
              <Label>Seleccione la acción a realizar:</Label>
              <div className="grid grid-cols-1 gap-3">
                {actions.map((action) => (
                  <button
                    key={action.value}
                    onClick={() => setSelectedAction(action.value)}
                    className={`flex items-center space-x-3 p-4 border-2 rounded-lg hover:border-blue-500 transition-colors text-left ${
                      action.variant === 'destructive'
                        ? 'border-red-200 hover:border-red-500 hover:bg-red-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className={action.variant === 'destructive' ? 'text-red-600' : 'text-blue-600'}>
                      {getActionIcon(action.value)}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{action.label}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        {getActionDescription(action.value)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Action Header */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={selectedAction === 'delete' ? 'text-red-600' : 'text-blue-600'}>
                    {getActionIcon(selectedAction)}
                  </div>
                  <div>
                    <p className="font-semibold">
                      {actions.find(a => a.value === selectedAction)?.label}
                    </p>
                    <p className="text-sm text-gray-600">
                      {selectedUserCount} usuario{selectedUserCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedAction(null)}
                  disabled={loading}
                >
                  Cambiar
                </Button>
              </div>

              {/* Action Description */}
              <Alert>
                <AlertDescription>
                  {getActionDescription(selectedAction)}
                </AlertDescription>
              </Alert>

              {/* Action-Specific Fields */}
              {selectedAction === 'change-role' && (
                <div className="space-y-2">
                  <Label htmlFor="roleId">
                    Nuevo Rol <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="roleId"
                    value={selectedRoleId}
                    onChange={(e) => setSelectedRoleId(parseInt(e.target.value))}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value={0}>Seleccionar rol...</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name} {role.userCount ? `(${role.userCount} usuarios)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedAction === 'change-business-unit' && (
                <div className="space-y-2">
                  <Label htmlFor="businessUnitId">
                    Nueva Unidad de Negocio <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="businessUnitId"
                    value={selectedBusinessUnitId}
                    onChange={(e) => setSelectedBusinessUnitId(parseInt(e.target.value))}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value={0}>Seleccionar unidad...</option>
                    {businessUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name} {unit.userCount ? `(${unit.userCount} usuarios)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedAction === 'delete' && (
                <div className="space-y-4">
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-semibold">Esta acción es permanente e irreversible</p>
                      <p className="text-sm mt-2">
                        Se eliminarán {selectedUserCount} usuario{selectedUserCount !== 1 ? 's' : ''} y todo su historial de actividad. Esta acción no se puede deshacer.
                      </p>
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label htmlFor="confirmDelete">
                      Escriba &quot;ELIMINAR&quot; para confirmar <span className="text-red-500">*</span>
                    </Label>
                    <input
                      id="confirmDelete"
                      type="text"
                      value={confirmDelete}
                      onChange={(e) => setConfirmDelete(e.target.value)}
                      placeholder="ELIMINAR"
                      disabled={loading}
                      className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <p className="text-xs text-gray-500">
                      Debe escribir exactamente la palabra &quot;ELIMINAR&quot; en mayúsculas
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {selectedAction && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading}
              variant={selectedAction === 'delete' ? 'destructive' : 'default'}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedAction === 'delete' ? 'Eliminar Permanentemente' : 'Aplicar Cambios'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
