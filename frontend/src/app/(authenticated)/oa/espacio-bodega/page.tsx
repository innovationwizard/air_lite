'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Warehouse, AlertTriangle, Settings } from 'lucide-react';
import Link from 'next/link';

interface WarehouseData {
  warehouse_id: number;
  warehouse_name: string;
  max_capacity_m3: number;
  occupied_m3: number;
  available_m3: number;
  incoming_m3: number;
  post_arrival_m3: number;
  saturation_pct: number;
  alert_level: 'verde' | 'amarillo' | 'rojo' | 'sin_configurar';
  products_without_volume: number;
}

const fmtM3 = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmtPct = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '%';

const ALERT_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  verde: { bg: 'bg-green-100', text: 'text-green-700', label: 'Normal' },
  amarillo: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Precauci\u00f3n' },
  rojo: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cr\u00edtico' },
  sin_configurar: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Sin configurar' },
};

function capacityBarColor(pct: number) {
  if (pct > 95) return 'bg-red-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-green-500';
}

export default function EspacioBodegaPage() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('all');

  useEffect(() => {
    fetch('/api/oa/warehouse-space')
      .then((res) => res.json())
      .then((d) => {
        setWarehouses(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const displayed =
    selectedId === 'all'
      ? warehouses
      : warehouses.filter((w) => String(w.warehouse_id) === selectedId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Warehouse className="w-6 h-6 text-emerald-600" />
          Espacio en Bodega
        </h1>
        <p className="text-gray-500 mt-1">Capacidad y utilizaci&oacute;n por bodega</p>
      </div>

      {/* Warehouse selector */}
      <div className="flex items-center gap-3">
        <Warehouse className="w-4 h-4 text-gray-400" />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="all">Todas las bodegas</option>
          {warehouses.map((w) => (
            <option key={w.warehouse_id} value={String(w.warehouse_id)}>
              {w.warehouse_name}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando datos de bodegas...
        </div>
      )}

      {/* Cards */}
      {!loading && displayed.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          No hay bodegas registradas
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {displayed.map((w) => {
          const badge = ALERT_BADGE[w.alert_level] ?? ALERT_BADGE.sin_configurar;
          const barPct = w.max_capacity_m3 > 0 ? (w.occupied_m3 / w.max_capacity_m3) * 100 : 0;

          return (
            <div
              key={w.warehouse_id}
              className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
            >
              {/* Card header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">{w.warehouse_name}</h3>
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                >
                  {badge.label}
                </span>
              </div>

              {/* Not configured */}
              {w.max_capacity_m3 === 0 ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Settings className="w-4 h-4" />
                  <span>
                    Capacidad no configurada &mdash;{' '}
                    <Link href="/oa/configuracion" className="text-emerald-600 underline">
                      ir a Configuraci&oacute;n OA
                    </Link>
                  </span>
                </div>
              ) : (
                <>
                  {/* Saturation big number */}
                  <div className="text-center">
                    <p className="text-4xl font-bold text-gray-900">{fmtPct(w.saturation_pct)}</p>
                    <p className="text-xs text-gray-400 mt-1">Saturaci&oacute;n</p>
                  </div>

                  {/* Capacity bar */}
                  <div>
                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-3 rounded-full transition-all ${capacityBarColor(barPct)}`}
                        style={{ width: `${Math.min(barPct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Capacidad Total</p>
                      <p className="font-semibold text-gray-900">{fmtM3(w.max_capacity_m3)} m&sup3;</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Ocupado</p>
                      <p className="font-semibold text-gray-900">{fmtM3(w.occupied_m3)} m&sup3;</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Disponible</p>
                      <p className="font-semibold text-gray-900">{fmtM3(w.available_m3)} m&sup3;</p>
                    </div>
                    <div>
                      <p className="text-gray-500">En Tr&aacute;nsito</p>
                      <p className="font-semibold text-gray-900">{fmtM3(w.incoming_m3)} m&sup3;</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-500">Post-Entrada</p>
                      <p className={`font-semibold ${w.post_arrival_m3 < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {fmtM3(w.post_arrival_m3)} m&sup3;
                      </p>
                    </div>
                  </div>

                  {/* Warnings */}
                  {w.post_arrival_m3 < 0 && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      Saturaci&oacute;n de espacio &mdash; no hay capacidad para producto en tr&aacute;nsito
                    </div>
                  )}

                  {w.products_without_volume > 0 && (
                    <p className="text-xs text-amber-600">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      {w.products_without_volume} productos sin volumen registrado
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
