'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MOTIVOS, MAX_CODIGOS_POR_MES, etiquetaMes, cicloDelMes, consolidar,
  type Motivo, type FilaForecast,
} from '@/lib/comercial/forecast';

/**
 * Captura y consolidado del forecast comercial.
 *
 * EL REQUISITO PRINCIPAL ES QUE SE USE. La hoja actual la llenaron cuatro de
 * seis áreas y una de las que faltó fue porque no entendió el archivo, así que
 * toda decisión de esta pantalla se resuelve a favor de quitar fricción:
 * cuatro campos, el código se busca por nombre además de por número, la
 * descripción aparece sola, y cada motivo explica en una línea qué implica
 * elegirlo. Nada de lo que no sea imprescindible entra en el camino.
 */

interface Producto { id: number; sku: string; name: string; stock_uom?: string }
interface FilaApi {
  id: string; product_id: number; month: string;
  quantity: number; motivo: Motivo; area: string; note: string | null;
}
interface Datos {
  filas: FilaApi[];
  productos: Producto[];
  proyeccion: { product_id: number; p3: number | null }[];
  areas: { slug: string; nombre: string }[];
  miArea: string | null;
  puedeCapturar: boolean;
  mesesAbiertos: string[];
}

export function ForecastClient() {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState<string>('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/comercial/forecast');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar');
      setD(j);
      setMes((m) => m || j.mesesAbiertos[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>;
  if (!d) return <div className="p-8 text-sm text-gray-500">Cargando…</div>;

  const capturando = d.puedeCapturar && !!d.miArea;
  const ciclo = mes ? cicloDelMes(mes) : null;
  const hoy = new Date();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Forecast comercial</h1>
        <p className="text-sm text-gray-500 mt-1">
          {capturando
            ? `Cargá lo que esperás vender. Canal: ${
                d.areas.find((a) => a.slug === d.miArea)?.nombre ?? d.miArea}`
            : 'Lo que cargó cada canal, junto, sin descargar ni pegar nada.'}
        </p>
      </header>

      {/* El ciclo lo pone el cliente, no este documento. */}
      {ciclo && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          <span className="text-gray-800">
            Para <strong>{etiquetaMes(mes)}</strong>: la captura cierra el{' '}
            <strong>{ciclo.cierre.toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</strong>
            {' '}y la reunión de forecast es el{' '}
            <strong>{ciclo.reunion.toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</strong>.
          </span>
          {ciclo.cierre > hoy && (
            <span className="text-amber-800 ml-1">
              Quedan {Math.ceil((ciclo.cierre.getTime() - hoy.getTime()) / 86_400_000)} días.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {d.mesesAbiertos.map((m) => (
          <button
            key={m}
            onClick={() => setMes(m)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              mes === m ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {etiquetaMes(m)}
          </button>
        ))}
      </div>

      {capturando
        ? <Captura datos={d} mes={mes} onCambio={cargar} />
        : <Consolidado datos={d} mes={mes} />}

      {d.puedeCapturar && !d.miArea && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
          Tu usuario todavía no tiene un canal comercial asignado, así que no podés cargar
          todavía. Un administrador lo configura en un minuto.
        </p>
      )}
    </div>
  );
}

/* ── Captura: cuatro campos ─────────────────────────────────────────────── */

function Captura({ datos, mes, onCambio }: { datos: Datos; mes: string; onCambio: () => void }) {
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<Producto[]>([]);
  const [elegido, setElegido] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState<Motivo>('temporada');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const cantidadRef = useRef<HTMLInputElement>(null);

  const mias = datos.filas.filter((f) => f.month === mes);
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
            {MOTIVOS.map((m) => (
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
            {mias.length} de {MAX_CODIGOS_POR_MES} códigos en {etiquetaMes(mes)}
          </span>
          {aviso && <span className="text-xs text-emerald-700">{aviso}</span>}
          {errorForm && <span className="text-xs text-red-700">{errorForm}</span>}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-medium text-gray-900">
          Lo que llevás cargado para {etiquetaMes(mes)}
        </h2>
        {mias.length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">Todavía nada. Agregá el primer código arriba.</p>
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

/* ── Consolidado: lo que hoy se arma a mano ─────────────────────────────── */

function Consolidado({ datos, mes }: { datos: Datos; mes: string }) {
  const proy = useMemo(
    () => new Map(datos.proyeccion.filter((p) => p.p3 != null).map((p) => [p.product_id, p.p3!])),
    [datos.proyeccion]);

  const filas: FilaForecast[] = datos.filas
    .filter((f) => f.month === mes)
    .map((f) => {
      const p = datos.productos.find((x) => x.id === f.product_id);
      return {
        product_id: f.product_id, sku: p?.sku ?? String(f.product_id), nombre: p?.name ?? '',
        month: f.month, quantity: f.quantity, motivo: f.motivo, area: f.area, note: f.note,
      };
    });

  const filasCons = consolidar(filas, proy);
  const areasConDatos = datos.areas.filter((a) => filas.some((f) => f.area === a.slug));
  const areasSinCargar = datos.areas.filter((a) => !filas.some((f) => f.area === a.slug));

  if (filas.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <p className="text-sm text-gray-500">
          Ningún canal ha cargado todavía para {etiquetaMes(mes)}.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-900">
          Consolidado de {etiquetaMes(mes)} — {filasCons.length} códigos
        </h2>
        {areasSinCargar.length > 0 && (
          <span className="text-xs text-amber-800">
            Sin cargar: {areasSinCargar.map((a) => a.nombre).join(', ')}
          </span>
        )}
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Código</th>
              {areasConDatos.map((a) => (
                <th key={a.slug} className="py-2 pr-3 font-medium text-right">{a.nombre}</th>
              ))}
              <th className="py-2 pr-3 font-medium text-right">Total</th>
              <th className="py-2 pr-3 font-medium text-right" title="Certeza con destinatario: suma directo al pedido">
                Directo
              </th>
              <th className="py-2 pr-3 font-medium text-right" title="Proyección del canal: se revisa si supera la proyección de la app">
                A revisión
              </th>
              <th className="py-2 font-medium text-right">Proyección de la app</th>
            </tr>
          </thead>
          <tbody>
            {filasCons.map((c) => (
              <tr key={`${c.product_id}-${c.month}`}
                  className={`border-b border-gray-100 ${c.superaProyeccion ? 'bg-amber-50' : ''}`}>
                <td className="py-2 pr-3">
                  <span className="font-mono text-xs text-gray-500">{c.sku}</span>{' '}
                  <span className="text-gray-800">{c.nombre}</span>
                </td>
                {areasConDatos.map((a) => (
                  <td key={a.slug} className="py-2 pr-3 text-right tabular-nums text-gray-600">
                    {c.porArea[a.slug]?.toLocaleString('es-GT') ?? ''}
                  </td>
                ))}
                <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900">
                  {c.total.toLocaleString('es-GT')}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                  {c.directo ? c.directo.toLocaleString('es-GT') : ''}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                  {c.aRevision ? c.aRevision.toLocaleString('es-GT') : ''}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-500">
                  {c.proyeccion?.toLocaleString('es-GT', { maximumFractionDigits: 0 })
                    ?? <span className="text-gray-300">sin dato</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        <span className="inline-block w-3 h-3 bg-amber-50 border border-amber-200 align-middle mr-1" />
        Resaltado: lo que va <strong>a revisión</strong> supera la proyección de la app, que es
        justamente el caso que la reunión tiene que discutir. Lo <strong>directo</strong> no
        dispara revisión — es certeza con destinatario y entra al pedido igual.
      </p>
    </section>
  );
}
