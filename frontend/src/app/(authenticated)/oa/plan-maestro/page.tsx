'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { ClipboardList, Plus, ArrowLeft } from 'lucide-react';

interface OpenOrder {
  id: number;
  supplier_id: number;
  month: string;
  total_forecast_qty: number;
  total_forecast_value: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtGTQ = (n: number) =>
  'GTQ ' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMonth = (m: string) => {
  try {
    const d = new Date(m + 'T00:00:00');
    return d.toLocaleDateString('es-GT', { year: 'numeric', month: 'long' });
  } catch {
    return m;
  }
};

export default function PlanMaestroPage() {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formMonth, setFormMonth] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  const loadOrders = () => {
    setLoading(true);
    fetch('/api/oa/open-orders')
      .then((res) => res.json())
      .then((d) => {
        const list: OpenOrder[] = Array.isArray(d) ? d : d.orders ?? [];
        setOrders(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleCreate = async () => {
    if (!formSupplierId || isNaN(Number(formSupplierId))) {
      setFormError('Ingrese un ID de proveedor válido');
      return;
    }
    if (!formMonth) {
      setFormError('Seleccione un mes');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/oa/open-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: Number(formSupplierId),
          month: formMonth + '-01',
          lines: [],
          notes: formNotes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al crear la orden');
      }
      setFormSupplierId('');
      setFormMonth('');
      setFormNotes('');
      setView('list');
      loadOrders();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      activa: 'bg-emerald-100 text-emerald-700',
      completada: 'bg-blue-100 text-blue-700',
      cancelada: 'bg-gray-100 text-gray-600',
    };
    return map[status?.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            Plan Maestro de Despacho
          </h1>
          <p className="text-gray-500 mt-1">Gestión de órdenes abiertas por proveedor</p>
        </div>
        {view === 'list' && (
          <button
            onClick={() => setView('create')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nueva Orden Abierta
          </button>
        )}
      </div>

      {view === 'create' ? (
        /* Create form */
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
          <button
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a la lista
          </button>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Crear Orden Abierta</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ID de Proveedor
              </label>
              <input
                type="number"
                min="1"
                value={formSupplierId}
                onChange={(e) => setFormSupplierId(e.target.value)}
                placeholder="Ej: 1"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <input
                type="month"
                value={formMonth}
                onChange={(e) => setFormMonth(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notas <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={3}
                placeholder="Notas adicionales"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>

            <p className="text-xs text-gray-400">
              Las líneas de producto se agregarán en una fase posterior.
            </p>

            {formError && (
              <p className="text-sm text-red-600">{formError}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={submitting}
              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creando...' : 'Crear Orden Abierta'}
            </button>
          </div>
        </div>
      ) : (
        /* List view */
        <>
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              Cargando órdenes abiertas...
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 mb-4">No hay órdenes abiertas registradas</p>
              <button
                onClick={() => setView('create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Crear primera orden
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {formatMonth(order.month)}
                      </p>
                      <p className="text-sm text-gray-500">
                        Proveedor #{order.supplier_id}
                      </p>
                    </div>
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(order.status)}`}
                    >
                      {order.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Cantidad Forecast</p>
                      <p className="font-semibold text-gray-900">
                        {fmt(order.total_forecast_qty)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Valor Total</p>
                      <p className="font-semibold text-gray-900">
                        {fmtGTQ(order.total_forecast_value)}
                      </p>
                    </div>
                  </div>

                  {order.notes && (
                    <div className="text-sm">
                      <p className="text-gray-500">Notas</p>
                      <p className="text-gray-700">{order.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
