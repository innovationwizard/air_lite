'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import { FileText, ChevronDown, ChevronRight } from 'lucide-react';

interface SemaphoreRow {
  supplier_id: number;
  supplier_name: string;
  sku: string;
  product_name: string;
  supply_days: number;
  zone: string;
  excess_qty: number;
  urgent_qty: number;
  is_export: boolean;
}

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const todayStr = () =>
  new Date().toLocaleDateString('es-GT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export default function ReporteProveedorPage() {
  const [allData, setAllData] = useState<SemaphoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [greenOpen, setGreenOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/oa/supplier-semaphore')
      .then((res) => res.json())
      .then((json) => {
        const rows: SemaphoreRow[] = Array.isArray(json) ? json : json.data ?? [];
        setAllData(rows);
        setLoading(false);
      })
      .catch(() => {
        setAllData([]);
        setLoading(false);
      });
  }, []);

  const suppliers = useMemo(() => {
    const map = new Map<number, string>();
    allData.forEach((r) => map.set(r.supplier_id, r.supplier_name));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allData]);

  const filtered = useMemo(() => {
    if (!selectedSupplier) return [];
    return allData.filter((r) => String(r.supplier_id) === selectedSupplier);
  }, [allData, selectedSupplier]);

  const hotList = useMemo(() => filtered.filter((r) => r.supply_days < 3), [filtered]);
  const holdList = useMemo(() => filtered.filter((r) => r.supply_days > 7), [filtered]);
  const greenList = useMemo(() => filtered.filter((r) => r.supply_days >= 3 && r.supply_days <= 7), [filtered]);

  const supplierName = suppliers.find(([id]) => String(id) === selectedSupplier)?.[1] ?? '';

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          nav, aside, header, [data-sidebar], .print\\:hidden { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: 100% !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}} />

      {/* Header */}
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-emerald-600" />
          Reporte para Proveedor
        </h1>
        <p className="text-gray-500 mt-1">Vista compartible &mdash; Carvajal / Reyma</p>
      </div>

      {/* Supplier selector */}
      <div className="print:hidden">
        <select
          value={selectedSupplier}
          onChange={(e) => { setSelectedSupplier(e.target.value); setGreenOpen(false); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 min-w-[250px]"
        >
          <option value="">Seleccionar proveedor...</option>
          {suppliers.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando datos...
        </div>
      ) : !selectedSupplier ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Seleccione un proveedor para generar el reporte
        </div>
      ) : (
        <div className="space-y-6">
          {/* Report Header */}
          <div className="border-b-2 border-gray-900 pb-3">
            <h2 className="text-xl font-bold text-gray-900 uppercase">
              REPORTE DIARIO &mdash; {supplierName}
            </h2>
            <p className="text-sm text-gray-600 mt-1">{todayStr()}</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-sm text-gray-500">Total SKUs</p>
              <p className="text-2xl font-bold text-gray-900">{filtered.length}</p>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
              <p className="text-sm text-red-600">Quiebre (Hot)</p>
              <p className="text-2xl font-bold text-red-700">{hotList.length}</p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
              <p className="text-sm text-amber-600">Exceso (Hold)</p>
              <p className="text-2xl font-bold text-amber-700">{holdList.length}</p>
            </div>
            <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
              <p className="text-sm text-green-600">OK (Verde)</p>
              <p className="text-2xl font-bold text-green-700">{greenList.length}</p>
            </div>
          </div>

          {/* HOT LIST */}
          <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
            <div className="bg-red-600 px-5 py-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                PRIORIDAD DE CARGA &mdash; Despachar ma&ntilde;ana
              </h3>
            </div>
            {hotList.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">
                No hay productos en quiebre
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 border-b border-red-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-red-700">SKU</th>
                      <th className="text-left px-4 py-3 font-medium text-red-700">Producto</th>
                      <th className="text-right px-4 py-3 font-medium text-red-700">D&iacute;as Suministro</th>
                      <th className="text-right px-4 py-3 font-medium text-red-700">Cantidad Urgente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {hotList.map((r, i) => (
                      <tr key={`${r.sku}-${i}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">{r.sku}</td>
                        <td className="px-4 py-3 text-gray-700">{r.product_name}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">{fmtDec(r.supply_days)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(r.urgent_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* HOLD LIST */}
          <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
            <div className="bg-amber-500 px-5 py-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                DETENER DESPACHO
              </h3>
            </div>
            {holdList.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">
                No hay productos con exceso
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 border-b border-amber-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-amber-700">SKU</th>
                      <th className="text-left px-4 py-3 font-medium text-amber-700">Producto</th>
                      <th className="text-right px-4 py-3 font-medium text-amber-700">D&iacute;as Suministro</th>
                      <th className="text-right px-4 py-3 font-medium text-amber-700">Exceso</th>
                      <th className="text-center px-4 py-3 font-medium text-amber-700">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {holdList.map((r, i) => (
                      <tr key={`${r.sku}-${i}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">{r.sku}</td>
                        <td className="px-4 py-3 text-gray-700">{r.product_name}</td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">{fmtDec(r.supply_days)}</td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">{fmt(r.excess_qty)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">
                          {r.is_export ? 'Exportaci\u00f3n \u2014 en tr\u00e1nsito, no cancelable' : '\u2014'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* GREEN LIST (collapsed by default) */}
          <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
            <button
              onClick={() => setGreenOpen(!greenOpen)}
              className="w-full bg-green-600 px-5 py-3 flex items-center justify-between"
            >
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                Flujo Normal ({greenList.length} productos)
              </h3>
              {greenOpen ? (
                <ChevronDown className="w-4 h-4 text-white" />
              ) : (
                <ChevronRight className="w-4 h-4 text-white" />
              )}
            </button>
            {greenOpen && (
              greenList.length === 0 ? (
                <div className="px-5 py-6 text-center text-gray-400 text-sm">
                  No hay productos en flujo normal
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-green-50 border-b border-green-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-green-700">SKU</th>
                        <th className="text-left px-4 py-3 font-medium text-green-700">Producto</th>
                        <th className="text-right px-4 py-3 font-medium text-green-700">D&iacute;as Suministro</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-100">
                      {greenList.map((r, i) => (
                        <tr key={`${r.sku}-${i}`}>
                          <td className="px-4 py-3 font-medium text-gray-900">{r.sku}</td>
                          <td className="px-4 py-3 text-gray-700">{r.product_name}</td>
                          <td className="px-4 py-3 text-right font-medium text-green-700">{fmtDec(r.supply_days)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
