'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { ClipboardList, Plus, ArrowLeft, X } from 'lucide-react';

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

interface OrderLine {
  id?: number;
  sku: string;
  product_name?: string;
  forecast_qty: number;
  unit_price: number;
  value?: number;
}

interface OrderDetail extends OpenOrder {
  lines?: OrderLine[];
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
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [submitting, setSubmitting] = useState(false);

  // Detail view state
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLines, setDetailLines] = useState<OrderLine[]>([]);
  const [savingLines, setSavingLines] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Add line form
  const [newSku, setNewSku] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newPrice, setNewPrice] = useState('');

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

  const loadOrderDetail = (orderId: number) => {
    setDetailLoading(true);
    setSaveMsg('');
    fetch(`/api/oa/open-orders?id=${orderId}`)
      .then((res) => res.json())
      .then((json) => {
        const order: OrderDetail = Array.isArray(json) ? json[0] : json;
        setSelectedOrder(order);
        setDetailLines(order.lines ?? []);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  };

  const handleOpenDetail = (order: OpenOrder) => {
    setView('detail');
    loadOrderDetail(order.id);
  };

  const handleAddLine = () => {
    if (!newSku.trim()) return;
    const qty = Number(newQty) || 0;
    const price = Number(newPrice) || 0;
    setDetailLines((prev) => [
      ...prev,
      { sku: newSku.trim(), forecast_qty: qty, unit_price: price, value: qty * price },
    ]);
    setNewSku('');
    setNewQty('');
    setNewPrice('');
  };

  const handleRemoveLine = (index: number) => {
    setDetailLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveLines = async () => {
    if (!selectedOrder) return;
    setSavingLines(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/oa/open-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_order_id: selectedOrder.id,
          lines: detailLines.map((l) => ({
            sku: l.sku,
            forecast_qty: l.forecast_qty,
            unit_price: l.unit_price,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al guardar');
      }
      setSaveMsg('L\u00edneas guardadas correctamente');
      loadOrderDetail(selectedOrder.id);
      loadOrders();
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSavingLines(false);
    }
  };

  const handleCreate = async () => {
    if (!formSupplierId || isNaN(Number(formSupplierId))) {
      setFormError('Ingrese un ID de proveedor v\u00e1lido');
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

  const lineTotals = detailLines.reduce(
    (acc, l) => {
      const val = l.forecast_qty * l.unit_price;
      return { qty: acc.qty + l.forecast_qty, value: acc.value + val };
    },
    { qty: 0, value: 0 }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            Plan Maestro de Despacho
          </h1>
          <p className="text-gray-500 mt-1">Gesti&oacute;n de &oacute;rdenes abiertas por proveedor</p>
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

      {view === 'detail' ? (
        /* Detail view */
        <div className="space-y-6">
          <button
            onClick={() => { setView('list'); setSelectedOrder(null); setDetailLines([]); setSaveMsg(''); }}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a la lista
          </button>

          {detailLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              Cargando detalle de orden...
            </div>
          ) : selectedOrder ? (
            <>
              {/* Order header info */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{formatMonth(selectedOrder.month)}</p>
                    <p className="text-sm text-gray-500 mt-1">Proveedor #{selectedOrder.supplier_id}</p>
                    {selectedOrder.notes && (
                      <p className="text-sm text-gray-500 mt-1">Notas: {selectedOrder.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(selectedOrder.status)}`}>
                      {selectedOrder.status}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div>
                    <p className="text-gray-500">Cantidad Total</p>
                    <p className="font-semibold text-gray-900">{fmt(lineTotals.qty)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Valor Total</p>
                    <p className="font-semibold text-gray-900">{fmtGTQ(lineTotals.value)}</p>
                  </div>
                </div>
              </div>

              {/* Product lines table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">L&iacute;neas de Producto</h2>
                  <button
                    onClick={handleSaveLines}
                    disabled={savingLines}
                    className="inline-flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {savingLines ? 'Guardando...' : 'Guardar L\u00edneas'}
                  </button>
                </div>

                {saveMsg && (
                  <div className={`px-5 py-2 text-sm ${saveMsg.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {saveMsg}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">Forecast Qty</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">Precio Unitario</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">Valor</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-500 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detailLines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                            No hay l&iacute;neas de producto a&uacute;n
                          </td>
                        </tr>
                      ) : (
                        detailLines.map((line, i) => (
                          <tr key={`${line.sku}-${i}`} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{line.sku}</td>
                            <td className="px-4 py-3 text-gray-700">{line.product_name ?? '\u2014'}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{fmt(line.forecast_qty)}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{fmtGTQ(line.unit_price)}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900">
                              {fmtGTQ(line.forecast_qty * line.unit_price)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleRemoveLine(i)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Eliminar l\u00ednea"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add line form */}
                <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">Agregar l&iacute;nea</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">SKU</label>
                      <input
                        type="text"
                        value={newSku}
                        onChange={(e) => setNewSku(e.target.value)}
                        placeholder="Ej: SKU-001"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-40 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Forecast Qty</label>
                      <input
                        type="number"
                        min="0"
                        value={newQty}
                        onChange={(e) => setNewQty(e.target.value)}
                        placeholder="0"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-28 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Precio Unitario</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="0.00"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-28 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    <button
                      onClick={handleAddLine}
                      disabled={!newSku.trim()}
                      className="inline-flex items-center gap-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                      Agregar
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : view === 'create' ? (
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
              Cargando &oacute;rdenes abiertas...
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 mb-4">No hay &oacute;rdenes abiertas registradas</p>
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
                  onClick={() => handleOpenDetail(order)}
                  className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 cursor-pointer hover:border-emerald-300 hover:shadow-sm transition-all"
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
