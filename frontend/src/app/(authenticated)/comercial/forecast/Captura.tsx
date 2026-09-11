'use client';

import { useEffect, useRef, useState } from 'react';
import { MOTIVOS, MAX_CODIGOS_POR_MES, etiquetaMes, type Motivo } from '@/lib/comercial/forecast';
import type { Datos, Producto } from './types';

/**
 * Captura manual: cuatro campos (nivel 1). Desde el nivel 2 es el camino
 * para los códigos que NO están en la lista recomendada — la tabla de
 * arriba aprueba los 50 de mayor riesgo; acá se agrega cualquier otro.
 */

export function Captura({ datos, mes, onCambio, bloqueado = false }: {
  datos: Datos; mes: string; onCambio: () => void; bloqueado?: boolean;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<Producto[]>([]);
  const [elegido, setElegido] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState<Motivo>('temporada');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const cantidadRef = useRef<HTMLInputElement>(null);

  // Only what was added BY HAND: the approved recommendations (`base`) live
  // in the table above, and the 50-code cap counts manual codes only (Q3).
  const mias = datos.filas.filter((f) => f.month === mes && f.motivo !== 'base');
  const nombre = (id: number) => datos.productos.find((p) => p.id === id);

  // Búsqueda con freno: no una petición por tecla.
  useEffect(() => {
    if (elegido || busqueda.trim().length < 2) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/comercial/productos?q=${encodeURIComponent(busqueda)}`);
      if (r.ok) setSugerencias((await r.json()).productos);
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, elegido]);

  async function guardar() {
    if (!elegido) { setErrorForm('Elegí un código de la lista'); return; }
    const q = Number(cantidad);
    if (!Number.isFinite(q) || q <= 0) { setErrorForm('Escribí una cantidad mayor que cero'); return; }
    setGuardando(true); setErrorForm(null); setAviso(null);
    try {
      const r = await fetch('/api/comercial/forecast', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: elegido.id, month: mes, quantity: q, motivo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo guardar');
      const yaEstaba = mias.some((f) => f.product_id === elegido.id);
      setAviso(yaEstaba
        ? `${elegido.sku} actualizado a ${q}.`
        : `${elegido.sku} agregado.`);
      setElegido(null); setBusqueda(''); setCantidad(''); setSugerencias([]);
      onCambio();
    } catch (e) {
      setErrorForm(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(productId: number) {
    await fetch(`/api/comercial/forecast?productId=${productId}&month=${mes}`, { method: 'DELETE' });
    onCambio();
  }

  if (bloqueado) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <p className="text-sm text-gray-600" data-testid="captura-bloqueada">
          🔒 El forecast de {etiquetaMes(mes)} está bloqueado: no se pueden agregar ni quitar códigos.
          {mias.length > 0 && <> Agregados a mano: {mias.length}.</>}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          {/* 1 · Código */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Código o nombre del producto
            </label>
            <input
              value={elegido ? `${elegido.sku} — ${elegido.name}` : busqueda}
              onChange={(e) => { setElegido(null); setBusqueda(e.target.value); }}
              placeholder="Escribí 77205049 o «vaso 10»"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
            />
            {sugerencias.length > 0 && !elegido && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200
                             rounded-md shadow-lg max-h-64 overflow-y-auto">
                {sugerencias.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setElegido(p); setSugerencias([]);
                        cantidadRef.current?.focus();
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <span className="font-mono text-xs text-gray-500">{p.sku}</span>{' '}
                      <span className="text-gray-800">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 2 · Cantidad */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Cantidad{elegido?.stock_uom ? ` (${elegido.stock_uom})` : ''}
            </label>
            <input
              ref={cantidadRef}
              type="number" min={1} value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
            />
          </div>
        </div>

        {/* 3 · Motivo, con lo que implica cada uno escrito al lado */}
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-gray-700 mb-1.5">¿Por qué?</legend>
          <div className="space-y-1.5">
            {MOTIVOS.filter((m) => m.manual).map((m) => (
              <label key={m.valor} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio" name="motivo" checked={motivo === m.valor}
                  onChange={() => setMotivo(m.valor)} className="mt-1"
                />
                <span className="text-sm">
                  <span className="text-gray-900">{m.etiqueta}</span>
                  <span className="block text-xs text-gray-500">{m.ayuda}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={guardar} disabled={guardando}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md
                       hover:bg-gray-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Agregar'}
          </button>
          <span className="text-xs text-gray-500">
            {mias.length} de {MAX_CODIGOS_POR_MES} códigos agregados a mano en {etiquetaMes(mes)}
          </span>
          {aviso && <span className="text-xs text-emerald-700">{aviso}</span>}
          {errorForm && <span className="text-xs text-red-700">{errorForm}</span>}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-medium text-gray-900">
          Códigos agregados a mano para {etiquetaMes(mes)}
        </h2>
        {mias.length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">Ninguno. Los códigos de la tabla de arriba se aprueban ahí; acá se agrega cualquier otro.</p>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-medium">Código</th>
                <th className="py-2 pr-3 font-medium">Cantidad</th>
                <th className="py-2 pr-3 font-medium">Motivo</th>
                <th className="py-2 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {mias.map((f) => {
                const p = nombre(f.product_id);
                return (
                  <tr key={f.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-gray-500">{p?.sku ?? f.product_id}</span>{' '}
                      <span className="text-gray-800">{p?.name}</span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-800">
                      {f.quantity.toLocaleString('es-GT')}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      {MOTIVOS.find((m) => m.valor === f.motivo)?.etiqueta}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => quitar(f.product_id)}
                        className="text-gray-300 hover:text-red-600 text-sm"
                        title="Quitar"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

