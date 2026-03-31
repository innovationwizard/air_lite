'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Wrench, Plus, Save, Check, Pencil, Trash2, X } from 'lucide-react';

interface UnloadingTime {
  id?: number;
  supplier_id: string;
  unit_type: string;
  estimated_hours: number;
  notes: string;
  created_at?: string;
  updated_at?: string;
}

interface WarehouseConfig {
  id?: number;
  warehouse_label: string;
  num_docks: number;
  working_hours_start: string;
  working_hours_end: string;
  max_capacity_m3: number;
  dock_cleanup_minutes: number;
  overtime_threshold: string;
  created_at?: string;
  updated_at?: string;
}

const UNIT_TYPE_OPTIONS = [
  { value: 'furgon_53', label: "Furg\u00f3n 53'" },
  { value: 'contenedor_40', label: "Contenedor 40'" },
  { value: 'contenedor_45', label: "Contenedor 45'" },
  { value: 'camion_local', label: 'Cami\u00f3n Local' },
];

const UNIT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  UNIT_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

const DEFAULT_CONFIG: WarehouseConfig = {
  warehouse_label: '',
  num_docks: 1,
  working_hours_start: '07:00',
  working_hours_end: '17:00',
  max_capacity_m3: 0,
  dock_cleanup_minutes: 30,
  overtime_threshold: '17:00',
};

const inputClass =
  'border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500';

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<WarehouseConfig>(DEFAULT_CONFIG);
  const [unloadingTimes, setUnloadingTimes] = useState<UnloadingTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<UnloadingTime | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // New row form state
  const [newRow, setNewRow] = useState<UnloadingTime>({
    supplier_id: '',
    unit_type: 'furgon_53',
    estimated_hours: 1,
    notes: '',
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/oa/warehouse-config').then((r) => r.json()),
      fetch('/api/oa/warehouse-config?type=unloading').then((r) => r.json()),
    ])
      .then(([configJson, unloadJson]) => {
        const configRows: WarehouseConfig[] = Array.isArray(configJson)
          ? configJson
          : configJson.data ?? [];
        if (configRows.length > 0) {
          setConfig(configRows[0]);
        }
        const unloadRows: UnloadingTime[] = Array.isArray(unloadJson)
          ? unloadJson
          : unloadJson.data ?? [];
        setUnloadingTimes(unloadRows);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const updateField = <K extends keyof WarehouseConfig>(key: K, value: WarehouseConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const { id, created_at, updated_at, ...body } = config;
      void id; void created_at; void updated_at;
      const res = await fetch('/api/oa/warehouse-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      showMessage('success', 'Configuraci\u00f3n guardada exitosamente');
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSavingConfig(false);
    }
  };

  const reloadUnloadingTimes = async () => {
    const res = await fetch('/api/oa/warehouse-config?type=unloading');
    const data = await res.json();
    const rows: UnloadingTime[] = Array.isArray(data) ? data : data.data ?? [];
    setUnloadingTimes(rows);
  };

  const handleAddUnloadRow = async () => {
    setSavingRow(-1);
    try {
      const { id, created_at, updated_at, ...body } = newRow;
      void id; void created_at; void updated_at;
      const res = await fetch('/api/oa/warehouse-config?type=unloading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      showMessage('success', 'Tiempo de descarga agregado');
      await reloadUnloadingTimes();
      setNewRow({ supplier_id: '', unit_type: 'furgon_53', estimated_hours: 1, notes: '' });
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSavingRow(null);
    }
  };

  const handleEditSave = async () => {
    if (!editRow || editingIdx === null) return;
    setSavingRow(editingIdx);
    try {
      const res = await fetch('/api/oa/warehouse-config?type=unloading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editRow),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      showMessage('success', 'Tiempo de descarga actualizado');
      await reloadUnloadingTimes();
      setEditingIdx(null);
      setEditRow(null);
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSavingRow(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/oa/warehouse-config?type=unloading&id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al eliminar');
      }
      showMessage('success', 'Tiempo de descarga eliminado');
      await reloadUnloadingTimes();
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-emerald-600" />
            Configuraci&oacute;n de Bodega
          </h1>
          <p className="text-gray-500 mt-1">Par&aacute;metros operativos para c&aacute;lculos de OA</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando configuraci&oacute;n...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-emerald-600" />
          Configuraci&oacute;n de Bodega
        </h1>
        <p className="text-gray-500 mt-1">Par&aacute;metros operativos para c&aacute;lculos de OA</p>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.type === 'success' && <Check className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* General config */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Par&aacute;metros Generales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Etiqueta de bodega
            </label>
            <input
              type="text"
              value={config.warehouse_label}
              onChange={(e) => updateField('warehouse_label', e.target.value)}
              placeholder="Ej: Bodega Central Guatemala"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              N&uacute;mero de rampas/andenes
            </label>
            <input
              type="number"
              min={1}
              value={config.num_docks}
              onChange={(e) => updateField('num_docks', Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Horario laboral inicio
            </label>
            <input
              type="time"
              value={config.working_hours_start}
              onChange={(e) => updateField('working_hours_start', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Horario laboral fin
            </label>
            <input
              type="time"
              value={config.working_hours_end}
              onChange={(e) => updateField('working_hours_end', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Capacidad m&aacute;xima (m&sup3;)
            </label>
            <input
              type="number"
              min={0}
              value={config.max_capacity_m3}
              onChange={(e) => updateField('max_capacity_m3', Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tiempo de limpieza entre unidades (min)
            </label>
            <input
              type="number"
              min={0}
              value={config.dock_cleanup_minutes}
              onChange={(e) => updateField('dock_cleanup_minutes', Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Umbral de horas extra
            </label>
            <input
              type="time"
              value={config.overtime_threshold}
              onChange={(e) => updateField('overtime_threshold', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSaveConfig}
            disabled={savingConfig}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {savingConfig ? 'Guardando...' : 'Guardar Par\u00e1metros'}
          </button>
        </div>
      </div>

      {/* Unloading times */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Tiempos de Descarga por Proveedor
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Tipo Unidad</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Horas Estimadas</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Notas</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {unloadingTimes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No hay tiempos de descarga configurados
                  </td>
                </tr>
              )}
              {unloadingTimes.map((ut, idx) => {
                const isEditing = editingIdx === idx;
                if (isEditing && editRow) {
                  return (
                    <tr key={ut.id ?? idx} className="bg-amber-50/40">
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editRow.supplier_id}
                          onChange={(e) => setEditRow({ ...editRow, supplier_id: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editRow.unit_type}
                          onChange={(e) => setEditRow({ ...editRow, unit_type: e.target.value })}
                          className={inputClass}
                        >
                          {UNIT_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={editRow.estimated_hours}
                          onChange={(e) => setEditRow({ ...editRow, estimated_hours: Number(e.target.value) })}
                          className={`${inputClass} w-24 text-right`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editRow.notes}
                          onChange={(e) => setEditRow({ ...editRow, notes: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={handleEditSave}
                            disabled={savingRow === idx}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {savingRow === idx ? 'Guardando...' : 'Guardar'}
                          </button>
                          <button
                            onClick={() => { setEditingIdx(null); setEditRow(null); }}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-gray-500 hover:text-gray-700 transition-colors text-xs"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={ut.id ?? idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{ut.supplier_id}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {UNIT_TYPE_LABELS[ut.unit_type] ?? ut.unit_type}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{ut.estimated_hours}</td>
                    <td className="px-4 py-3 text-gray-500">{ut.notes || '\u2014'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => { setEditingIdx(idx); setEditRow({ ...ut }); }}
                          className="text-amber-600 hover:text-amber-800 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => ut.id && handleDelete(ut.id)}
                          disabled={deletingId === ut.id}
                          className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Inline add row */}
              <tr className="bg-emerald-50/30">
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={newRow.supplier_id}
                    onChange={(e) => setNewRow((p) => ({ ...p, supplier_id: e.target.value }))}
                    placeholder="Ej: PROV-001"
                    className={inputClass}
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={newRow.unit_type}
                    onChange={(e) => setNewRow((p) => ({ ...p, unit_type: e.target.value }))}
                    className={inputClass}
                  >
                    {UNIT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={newRow.estimated_hours}
                    onChange={(e) =>
                      setNewRow((p) => ({ ...p, estimated_hours: Number(e.target.value) }))
                    }
                    className={`${inputClass} w-24 text-right`}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={newRow.notes}
                    onChange={(e) => setNewRow((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Notas opcionales"
                    className={inputClass}
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={handleAddUnloadRow}
                    disabled={!newRow.supplier_id || savingRow === -1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
