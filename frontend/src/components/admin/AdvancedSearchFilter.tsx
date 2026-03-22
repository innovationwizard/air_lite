// frontend/src/components/admin/AdvancedSearchFilter.tsx
'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, X, Filter, ChevronDown, ChevronUp, Save, Trash2 } from 'lucide-react';
import adminService, { Role, BusinessUnit } from '@/services/adminService';

export interface SearchFilters {
  search?: string;
  active?: boolean;
  role?: string;
  businessUnit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface AdvancedSearchFilterProps {
  onSearch: (filters: SearchFilters) => void;
  filters: SearchFilters;
  onClear: () => void;
}

interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
}

export function AdvancedSearchFilter({
  onSearch,
  filters,
  onClear
}: AdvancedSearchFilterProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localFilters, setLocalFilters] = useState<SearchFilters>(filters);

  // Options
  const [roles, setRoles] = useState<Role[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [searchName, setSearchName] = useState('');

  useEffect(() => {
    loadOptions();
    loadSavedSearches();
  }, []);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

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

  const loadSavedSearches = () => {
    try {
      const saved = localStorage.getItem('admin_saved_searches');
      if (saved) {
        setSavedSearches(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Error loading saved searches:', err);
    }
  };

  const saveSavedSearches = (searches: SavedSearch[]) => {
    try {
      localStorage.setItem('admin_saved_searches', JSON.stringify(searches));
      setSavedSearches(searches);
    } catch (err) {
      console.error('Error saving searches:', err);
    }
  };

  const handleFilterChange = (key: keyof SearchFilters, value: any) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => {
    onSearch(localFilters);
    // Auto-expand advanced if any advanced filter is set
    if (localFilters.role || localFilters.businessUnit !== undefined || localFilters.active !== undefined) {
      setShowAdvanced(true);
    }
  };

  const handleClear = () => {
    const emptyFilters: SearchFilters = {};
    setLocalFilters(emptyFilters);
    onClear();
    setShowAdvanced(false);
  };

  const handleSaveSearch = () => {
    if (!searchName.trim()) return;

    const newSearch: SavedSearch = {
      id: Date.now().toString(),
      name: searchName.trim(),
      filters: localFilters
    };

    const updated = [...savedSearches, newSearch];
    saveSavedSearches(updated);
    setSearchName('');
    setShowSaveDialog(false);
  };

  const handleLoadSearch = (search: SavedSearch) => {
    setLocalFilters(search.filters);
    onSearch(search.filters);
    setShowAdvanced(true);
  };

  const handleDeleteSearch = (searchId: string) => {
    const updated = savedSearches.filter(s => s.id !== searchId);
    saveSavedSearches(updated);
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (localFilters.search) count++;
    if (localFilters.active !== undefined) count++;
    if (localFilters.role) count++;
    if (localFilters.businessUnit) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  const sortOptions = [
    { value: 'username', label: 'Usuario' },
    { value: 'email', label: 'Email' },
    { value: 'createdAt', label: 'Fecha de Creación' },
    { value: 'lastLogin', label: 'Último Acceso' },
    { value: 'role', label: 'Rol' }
  ];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* Main Search Bar */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por usuario, email, nombre..."
              value={localFilters.search || ''}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch}>
            <Search className="h-4 w-4 mr-2" />
            Buscar
          </Button>
          {activeFiltersCount > 0 && (
            <Button variant="outline" onClick={handleClear}>
              <X className="h-4 w-4 mr-2" />
              Limpiar
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="relative"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filtros
            {activeFiltersCount > 0 && (
              <Badge className="ml-2 px-1.5 py-0.5 h-5 min-w-[20px] text-xs bg-blue-600">
                {activeFiltersCount}
              </Badge>
            )}
            {showAdvanced ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="space-y-4 pt-4 border-t">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Status Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Estado</label>
                <select
                  value={localFilters.active === undefined ? 'all' : localFilters.active ? 'active' : 'inactive'}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleFilterChange('active', value === 'all' ? undefined : value === 'active');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="all">Todos</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>

              {/* Role Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Rol</label>
                <select
                  value={localFilters.role || ''}
                  onChange={(e) => handleFilterChange('role', e.target.value || undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Todos los roles</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                      {role.userCount ? ` (${role.userCount})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Business Unit Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Unidad de Negocio</label>
                <select
                  value={localFilters.businessUnit || ''}
                  onChange={(e) => handleFilterChange('businessUnit', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Todas las unidades</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                      {unit.userCount ? ` (${unit.userCount})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sort Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ordenar por</label>
                <select
                  value={localFilters.sortBy || 'createdAt'}
                  onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Orden</label>
                <select
                  value={localFilters.sortOrder || 'desc'}
                  onChange={(e) => handleFilterChange('sortOrder', e.target.value as 'asc' | 'desc')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="asc">Ascendente (A-Z, 0-9)</option>
                  <option value="desc">Descendente (Z-A, 9-0)</option>
                </select>
              </div>
            </div>

            {/* Save Search */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center space-x-2">
                {!showSaveDialog ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSaveDialog(true)}
                    disabled={activeFiltersCount === 0}
                  >
                    <Save className="h-3 w-3 mr-2" />
                    Guardar Búsqueda
                  </Button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Input
                      type="text"
                      placeholder="Nombre de la búsqueda..."
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveSearch()}
                      className="h-9 w-48"
                    />
                    <Button size="sm" onClick={handleSaveSearch} disabled={!searchName.trim()}>
                      Guardar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowSaveDialog(false);
                        setSearchName('');
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Saved Searches */}
            {savedSearches.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <label className="text-sm font-medium">Búsquedas Guardadas</label>
                <div className="flex flex-wrap gap-2">
                  {savedSearches.map((search) => (
                    <div
                      key={search.id}
                      className="flex items-center space-x-1 bg-gray-100 rounded-md px-2 py-1 text-sm hover:bg-gray-200 group"
                    >
                      <button
                        onClick={() => handleLoadSearch(search)}
                        className="font-medium text-blue-600 hover:text-blue-700"
                      >
                        {search.name}
                      </button>
                      <button
                        onClick={() => handleDeleteSearch(search.id)}
                        className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Filters Display */}
            {activeFiltersCount > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {localFilters.search && (
                  <Badge variant="outline" className="bg-blue-50">
                    Búsqueda: {localFilters.search}
                    <button
                      onClick={() => handleFilterChange('search', '')}
                      className="ml-2 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {localFilters.active !== undefined && (
                  <Badge variant="outline" className="bg-blue-50">
                    Estado: {localFilters.active ? 'Activos' : 'Inactivos'}
                    <button
                      onClick={() => handleFilterChange('active', undefined)}
                      className="ml-2 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {localFilters.role && (
                  <Badge variant="outline" className="bg-blue-50">
                    Rol: {localFilters.role}
                    <button
                      onClick={() => handleFilterChange('role', undefined)}
                      className="ml-2 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {localFilters.businessUnit && (
                  <Badge variant="outline" className="bg-blue-50">
                    Unidad: {businessUnits.find(u => u.id === localFilters.businessUnit)?.name}
                    <button
                      onClick={() => handleFilterChange('businessUnit', undefined)}
                      className="ml-2 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
