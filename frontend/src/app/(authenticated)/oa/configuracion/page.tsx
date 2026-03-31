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
  { value: 'furgon_53', label: "Furgón 53'" },
  { value: 'contenedor_40', label: "Contenedor 40'" },
  { value: 'contenedor_45', label: "Contenedor 45'" },
  { value: 'camion_local', label: 'Camión Local' },
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
  const [configs, setConfigs] = useState<WarehouseConfig[]>([]);
  const [unloadingTimes, setUnloadingTimes] = useState<UnloadingTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Warehouse config CRUD state
  const [cfgEditIdx, setCfgEditIdx] = useState<number | null>(null);
  const [cfgEditRow, setCfgEditRow] = useState<WarehouseConfig | null>(null);
  const [cfgAdding, setCfgAdding] = useState(false);
  const [cfgNewRow, setCfgNewRow] = useState<WarehouseConfig>({ ...DEFAULT_CONFIG });

  // Unloading times CRUD state
  const [utEditIdx, setUtEditIdx] = useState<number | null>(null);
  const [utEditRow, setUtEditRow] = useState<UnloadingTime | null>(null);
  const [utNewRow, setUtNewRow] = useState<UnloadingTime>({
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
        setConfigs(configRows);
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

  const reloadConfigs = async () => {
    const res = await fetch('/api/oa/warehouse-config');
    const data = await res.json();
    setConfigs(Array.isArray(data) ? data : data.data ?? []);
  };

  const reloadUnloadingTimes = async () => {
    const res = await fetch('/api/oa/warehouse-config?type=unloading');
    const data = await res.json();
    setUnloadingTimes(Array.isArray(data) ? data : data.data ?? []);
  };

  // ── Warehouse config handlers ──

  const handleCfgSave = async (row: WarehouseConfig, isNew: boolean) => {
    setSaving(isNew ? 'cfg-new' : `cfg-${row.id}`);
    try {
      const { created_at, updated_at, ...body } = row;
      void created_at; void updated_at;
      if (isNew) delete (body as Record<string, unknown>).id;
      const res = await fetch('/api/oa/warehouse-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      showMessage('success', isNew ? 'Bodega agregada' : 'Bodega actualizada');
      await reloadConfigs();
      if (isNew) {
        setCfgAdding(false);
        setCfgNewRow({ ...DEFAULT_CONFIG });
      } else {
        setCfgEditIdx(null);
        setCfgEditRow(null);
      }
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSaving(null);
    }
  };

  const handleCfgDelete = async (id: number) => {
    setSaving(`cfg-del-${id}`);
    try {
      const res = await fetch(`/api/oa/warehouse-config?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al eliminar');
      }
      showMessage('success', 'Bodega eliminada');
      await reloadConfigs();
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSaving(null);
    }
  };

  // ── Unloading times handlers ──

  const handleUtSave = async (row: UnloadingTime, isNew: boolean) => {
    setSaving(isNew ? 'ut-new' : `ut-${row.id}`);
    try {
      const { created_at, updated_at, ...body } = row;
      void created_at; void updated_at;
      if (isNew) delete (body as Record<string, unknown>).id;
      const res = await fetch('/api/oa/warehouse-config?type=unloading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      showMessage('success', isNew ? 'Tiempo de descarga agregado' : 'Tiempo de descarga actualizado');
      await reloadUnloadingTimes();
      if (isNew) {
        setUtNewRow({ supplier_id: '', unit_type: 'furgon_53', estimated_hours: 1, notes: '' });
      } else {
        setUtEditIdx(null);
        setUtEditRow(null);
      }
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSaving(null);
    }
  };

  const handleUtDelete = async (id: number) => {
    setSaving(`ut-del-${id}`);
    try {
      const res = await fetch(`/api/oa/warehouse-config?type=unloading&id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al eliminar');
      }
      showMessage('success', 'Tiempo de descarga eliminado');
      await reloadUnloadingTimes();
    } catch (e: unknown) {
      showMessage('error', e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSaving(null);
    }
  };

  // ── Config row renderer ──

  const renderCfgForm = (row: WarehouseConfig, onChange: (r: WarehouseConfig) => void, onSave: () => void, onCancel: () => void, isSaving: boolean) => (
    <div className="bg-amber-50/40 rounded-lg border border-amber-200 p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Etiqueta de bodega</label>
          <input type="text" value={row.warehouse_label} onChange={(e) => onChange({ ...row, warehouse_label: e.target.value })} placeholder="Ej: Bodega Central Guatemala" className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Número de rampas/andenes</label>
          <input type="number" min={1} value={row.num_docks} onChange={(e) => onChange({ ...row, num_docks: Number(e.target.value) })} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Horario laboral inicio</label>
          <input type="time" value={row.working_hours_start} onChange={(e) => onChange({ ...row, working_hours_start: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Horario laboral fin</label>
          <input type="time" value={row.working_hours_end} onChange={(e) => onChange({ ...row, working_hours_end: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Capacidad máxima (m³)</label>
          <input type="number" min={0} value={row.max_capacity_m3} onChange={(e) => onChange({ ...row, max_capacity_m3: Number(e.target.value) })} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tiempo de limpieza entre unidades (min)</label>
          <input type="number" min={0} value={row.dock_cleanup_minutes} onChange={(e) => onChange({ ...row, dock_cleanup_minutes: Number(e.target.value) })} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Umbral de horas extra</label>
          <input type="time" value={row.overtime_threshold} onChange={(e) => onChange({ ...row, overtime_threshold: e.target.value })} className={inputClass} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onSave} disabled={isSaving || !row.warehouse_label} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <Save className="w-4 h-4" />
          {isSaving ? 'Guardando...' : 'Guardar'}
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1 px-3 py-2 text-gray-500 hover:text-gray-700 transition-colors text-sm">
          <X className="w-4 h-4" /> Cancelar
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-emerald-600" />
            Configuración de Bodega
          </h1>
          <p className="text-gray-500 mt-1">Parámetros operativos para cálculos de OA</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando configuración...
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
          Configuración de Bodega
        </h1>
        <p className="text-gray-500 mt-1">Parámetros operativos para cálculos de OA</p>
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

      {/* ── Warehouse configs (Parámetros Generales) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Parámetros Generales</h2>
          {!cfgAdding && (
            <button
              onClick={() => { setCfgAdding(true); setCfgEditIdx(null); setCfgEditRow(null); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Nueva Bodega
            </button>
          )}
        </div>

        <div className="space-y-4">
          {configs.length === 0 && !cfgAdding && (
            <p className="text-center text-gray-400 py-8">No hay bodegas configuradas</p>
          )}

          {configs.map((cfg, idx) => {
            if (cfgEditIdx === idx && cfgEditRow) {
              return (
                <div key={cfg.id ?? idx}>
                  {renderCfgForm(
                    cfgEditRow,
                    (r) => setCfgEditRow(r),
                    () => handleCfgSave(cfgEditRow, false),
                    () => { setCfgEditIdx(null); setCfgEditRow(null); },
                    saving === `cfg-${cfg.id}`,
                  )}
                </div>
              );
            }
            return (
              <div key={cfg.id ?? idx} className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{cfg.warehouse_label || 'Sin nombre'}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-1 mt-2 text-sm text-gray-600">
                      <span><span className="text-gray-400">Rampas:</span> {cfg.num_docks}</span>
                      <span><span className="text-gray-400">Horario:</span> {cfg.working_hours_start} – {cfg.working_hours_end}</span>
                      <span><span className="text-gray-400">Capacidad:</span> {cfg.max_capacity_m3.toLocaleString()} m³</span>
                      <span><span className="text-gray-400">Limpieza:</span> {cfg.dock_cleanup_minutes} min</span>
                      <span><span className="text-gray-400">Horas extra:</span> {cfg.overtime_threshold}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <button
                      onClick={() => { setCfgEditIdx(idx); setCfgEditRow({ ...cfg }); setCfgAdding(false); }}
                      className="text-amber-600 hover:text-amber-800 transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => cfg.id && handleCfgDelete(cfg.id)}
                      disabled={saving === `cfg-del-${cfg.id}`}
                      className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {cfgAdding && renderCfgForm(
            cfgNewRow,
            (r) => setCfgNewRow(r),
            () => handleCfgSave(cfgNewRow, true),
            () => { setCfgAdding(false); setCfgNewRow({ ...DEFAULT_CONFIG }); },
            saving === 'cfg-new',
          )}
        </div>
      </div>

      {/* ── Unloading times ── */}
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
                const isEditing = utEditIdx === idx;
                if (isEditing && utEditRow) {
                  return (
                    <tr key={ut.id ?? idx} className="bg-amber-50/40">
                      <td className="px-4 py-2">
                        <input type="text" value={utEditRow.supplier_id} onChange={(e) => setUtEditRow({ ...utEditRow, supplier_id: e.target.value })} className={inputClass} />
                      </td>
                      <td className="px-4 py-2">
                        <select value={utEditRow.unit_type} onChange={(e) => setUtEditRow({ ...utEditRow, unit_type: e.target.value })} className={inputClass}>
                          {UNIT_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" min={0} step={0.5} value={utEditRow.estimated_hours} onChange={(e) => setUtEditRow({ ...utEditRow, estimated_hours: Number(e.target.value) })} className={`${inputClass} w-24 text-right`} />
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" value={utEditRow.notes} onChange={(e) => setUtEditRow({ ...utEditRow, notes: e.target.value })} className={inputClass} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleUtSave(utEditRow, false)}
                            disabled={saving === `ut-${ut.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {saving === `ut-${ut.id}` ? 'Guardando...' : 'Guardar'}
                          </button>
                          <button onClick={() => { setUtEditIdx(null); setUtEditRow(null); }} className="text-gray-500 hover:text-gray-700 transition-colors">
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
                    <td className="px-4 py-3 text-gray-500">{UNIT_TYPE_LABELS[ut.unit_type] ?? ut.unit_type}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{ut.estimated_hours}</td>
                    <td className="px-4 py-3 text-gray-500">{ut.notes || '\u2014'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => { setUtEditIdx(idx); setUtEditRow({ ...ut }); }} className="text-amber-600 hover:text-amber-800 transition-colors" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => ut.id && handleUtDelete(ut.id)} disabled={saving === `ut-del-${ut.id}`} className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50" title="Eliminar">
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
                  <input type="text" value={utNewRow.supplier_id} onChange={(e) => setUtNewRow((p) => ({ ...p, supplier_id: e.target.value }))} placeholder="Ej: PROV-001" className={inputClass} />
                </td>
                <td className="px-4 py-2">
                  <select value={utNewRow.unit_type} onChange={(e) => setUtNewRow((p) => ({ ...p, unit_type: e.target.value }))} className={inputClass}>
                    {UNIT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0} step={0.5} value={utNewRow.estimated_hours} onChange={(e) => setUtNewRow((p) => ({ ...p, estimated_hours: Number(e.target.value) }))} className={`${inputClass} w-24 text-right`} />
                </td>
                <td className="px-4 py-2">
                  <input type="text" value={utNewRow.notes} onChange={(e) => setUtNewRow((p) => ({ ...p, notes: e.target.value }))} placeholder="Notas opcionales" className={inputClass} />
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => handleUtSave(utNewRow, true)}
                    disabled={!utNewRow.supplier_id || saving === 'ut-new'}
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
