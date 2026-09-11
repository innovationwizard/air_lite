'use client';

import { useMemo, useState } from 'react';
import { etiquetaMes, consolidar, type FilaForecast } from '@/lib/comercial/forecast';
import type { Datos } from './types';

/**
 * Consolidado: lo que hoy se arma a mano — los seis canales en una tabla.
 *
 * NIVEL 2 (2026-09-10): al lado de lo que cada canal cargó va, en gris, lo
 * que la app le recomendó para ese producto y ese mes; el total de
 * recomendaciones aprobadas (`base`) se muestra en su propia columna y NO
 * se suma a nada (el cableado al Sugerido está en pausa, Q5); y en un mes
 * ya cerrado cada celda muestra lo capturado contra lo que realmente se
 * pidió y se entregó — la «verificación del mes siguiente» del nivel 2. Al
 * pie, la demanda que ningún canal tiene asignada, para que se vea.
 */

const n = (v: number) => Math.round(v).toLocaleString('es-GT');
const mesLabel = (primerDia: string) => primerDia.slice(0, 7);
/** «Institucional · Alejandra Ortiz» → «Alejandra Ortiz» inside the parent's cell. */
const nombreCorto = (nombre: string) => nombre.includes('·') ? nombre.slice(nombre.indexOf('·') + 1).trim() : nombre;

type Area = Datos['areas'][number];

/**
 * @param modo  'rollup' (readers): one column per top-level area; a parent
 *              sums its children and lists each seller inside the cell.
 *              'hijos' (the parent's own login, e.g. institucional@): one
 *              column per seller plus a total — read-only.
 */
export function Consolidado({ datos, mes, onCambio, modo = 'rollup' }: {
  datos: Datos; mes: string; onCambio?: () => void; modo?: 'rollup' | 'hijos';
}) {
  const [desbloqueando, setDesbloqueando] = useState<string | null>(null);
  const [avisoBloqueo, setAvisoBloqueo] = useState<string | null>(null);
  const bloqueoDe = (area: string) => datos.bloqueos?.[`${area}|${mes}`] ?? null;
  const bloqueadas = datos.areas.filter((a) => bloqueoDe(a.slug));
  const esHijos = modo === 'hijos';

  async function desbloquear(area: string) {
    if (!window.confirm(`¿Desbloquear ${etiquetaMes(mes)} de ${datos.areas.find((a) => a.slug === area)?.nombre ?? area}? El registro bloqueado se conserva; el canal podrá editar.`)) return;
    setDesbloqueando(area); setAvisoBloqueo(null);
    try {
      const r = await fetch(`/api/comercial/bloqueo?area=${encodeURIComponent(area)}&month=${encodeURIComponent(mes)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo desbloquear');
      onCambio?.();
    } catch (e) {
      setAvisoBloqueo(e instanceof Error ? e.message : 'No se pudo desbloquear');
    } finally {
      setDesbloqueando(null);
    }
  }

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
  const hijosDe = (padre: string): Area[] => datos.areas.filter((a) => a.padre === padre);
  const tieneDatos = (a: Area) => filas.some((f) => f.area === a.slug);
  // The columns. rollup: top-level areas (a parent counts as having data when
  // any child has). hijos: the viewer's children, in catalogue order.
  const columnas: Area[] = modo === 'hijos'
    ? hijosDe(datos.miArea ?? '')
    : datos.areas.filter((a) => !a.padre);
  const areasConDatos = columnas.filter((a) => tieneDatos(a) || hijosDe(a.slug).some(tieneDatos));
  // «Sin cargar» names leaves (sellers), not parents: a parent never loads anything itself.
  const hojas = datos.areas.filter((a) => !datos.areas.some((h) => h.padre === a.slug));
  const areasSinCargar = (modo === 'hijos' ? columnas : hojas).filter((a) => !tieneDatos(a));
  /** Captured qty of a top-level column = its own + its children's. */
  const capturadoDe = (a: Area, c: { porArea: Record<string, number> }): number | null => {
    const propio = c.porArea[a.slug];
    const deHijos = hijosDe(a.slug).map((h) => c.porArea[h.slug]).filter((v): v is number => v != null);
    if (propio == null && deHijos.length === 0) return null;
    return (propio ?? 0) + deHijos.reduce((x, y) => x + y, 0);
  };
  const cerrado = mes === datos.mesCerrado;
  const label = mesLabel(mes);
  const recomendadoDe = (area: string, productId: number): number | null => {
    const propio = datos.recomendaciones?.[area]?.[mes]?.[productId] ?? null;
    const deHijos = hijosDe(area).map((h) => datos.recomendaciones?.[h.slug]?.[mes]?.[productId])
      .filter((v): v is number => v != null);
    if (propio === null && deHijos.length === 0) return null;
    return (propio ?? 0) + deHijos.reduce((x, y) => x + y, 0);
  };
  const realDe = (area: string, productId: number) =>
    datos.reales?.[area]?.[productId]?.[label] ?? null;
  const sinAsignar = datos.sinAsignar ?? {};
  const mesesSinAsignar = Object.keys(sinAsignar).sort();
  const totalSinAsignar = mesesSinAsignar.reduce((a, m) => a + sinAsignar[m], 0);
  const totalBase = filasCons.reduce((a, c) => a + c.base, 0);

  if (filas.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <p className="text-sm text-gray-500">
          Ningún canal ha cargado todavía para {etiquetaMes(mes)}.
        </p>
        <PieSinAsignar meses={mesesSinAsignar} total={totalSinAsignar} />
      </section>
    );
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-900">
          {esHijos
            ? `${datos.areas.find((a) => a.slug === datos.miArea)?.nombre ?? 'Canal'} por vendedor — ${etiquetaMes(mes)} — ${filasCons.length} códigos`
            : `Consolidado de ${etiquetaMes(mes)} — ${filasCons.length} códigos`}
          {cerrado && <span className="text-gray-500 font-normal"> · mes cerrado: capturado contra real</span>}
        </h2>
        <span className="text-xs">
          {bloqueadas.length > 0 && (
            <span className="text-amber-800 mr-3" data-testid="bloqueados">
              🔒 Bloqueados: {bloqueadas.map((a) => nombreCorto(a.nombre)).join(', ')}
            </span>
          )}
          {areasSinCargar.length > 0 && (
            <span className="text-amber-800">
              Sin cargar: {areasSinCargar.map((a) => nombreCorto(a.nombre)).join(', ')}
            </span>
          )}
        </span>
      </div>
      {avisoBloqueo && <p className="text-xs text-red-700 mt-2">{avisoBloqueo}</p>}

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 align-bottom">
              <th className="py-2 pr-3 font-medium">Código</th>
              {areasConDatos.map((a) => (
                <th key={a.slug} className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                    title={cerrado
                      ? 'Arriba lo que el canal capturó; abajo lo que realmente pidió / se le entregó ese mes'
                      : 'Arriba lo que el canal capturó; abajo, en gris, lo que la app le recomendaba'}>
                  {esHijos ? nombreCorto(a.nombre) : a.nombre}
                  {bloqueoDe(a.slug) && (
                    <span className="ml-1 text-amber-800" data-testid={`candado-${a.slug}`}
                          title={`Bloqueado el ${new Date(bloqueoDe(a.slug)!.at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })} por ${bloqueoDe(a.slug)!.autor} (v${bloqueoDe(a.slug)!.version})`}>
                      🔒
                      {datos.puedeDesbloquear && (
                        <button type="button" onClick={() => desbloquear(a.slug)} disabled={desbloqueando === a.slug}
                                className="ml-1 underline font-normal hover:text-amber-900 disabled:opacity-50">
                          desbloquear
                        </button>
                      )}
                    </span>
                  )}
                  <span className="block font-normal text-gray-400">
                    {cerrado ? 'capturado · real pedido / entregado' : 'capturado · recomendado'}
                  </span>
                </th>
              ))}
              {esHijos && (
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap" data-testid="th-total-canal"
                    title="La suma de los vendedores: es la columna que ve Compras en su pantalla.">
                  Total canal
                </th>
              )}
              <th className="py-2 pr-3 font-medium text-right">Total</th>
              <th className="py-2 pr-3 font-medium text-right" title="Certeza con destinatario: suma directo al pedido">
                Directo
              </th>
              <th className="py-2 pr-3 font-medium text-right" title="Proyección del canal: se revisa si supera la proyección de la app">
                A revisión
              </th>
              <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                  title="Recomendaciones de la app aprobadas por el canal. Se muestran y se comparan; no se suman al pedido.">
                Aprobado <span className="font-normal text-gray-400">(no suma)</span>
              </th>
              <th className="py-2 font-medium text-right">Proyección de la app</th>
            </tr>
          </thead>
          <tbody>
            {filasCons.map((c) => (
              <tr key={`${c.product_id}-${c.month}`}
                  className={`border-b border-gray-100 align-top ${c.superaProyeccion ? 'bg-amber-50' : ''}`}>
                <td className="py-2 pr-3">
                  <span className="font-mono text-xs text-gray-500">{c.sku}</span>{' '}
                  <span className="text-gray-800">{c.nombre}</span>
                </td>
                {areasConDatos.map((a) => {
                  const hijos = hijosDe(a.slug);
                  const cap = capturadoDe(a, c);
                  const rec = recomendadoDe(a.slug, c.product_id);
                  const real = cerrado ? realDe(a.slug, c.product_id) : null;
                  return (
                    <td key={a.slug} className="py-2 pr-3 text-right tabular-nums" data-testid={`celda-${a.slug}`}>
                      <span className="text-gray-800">{cap != null ? n(cap) : ''}</span>
                      {cerrado
                        ? (real && (
                          <span className="block text-xs text-gray-500" data-testid="real">
                            {n(real.pedido)} / {n(real.entregado)}
                          </span>))
                        : (rec !== null && (
                          <span className="block text-xs text-gray-400" data-testid="recomendado"
                                title="Lo que la app recomendaba a este canal para este código">
                            {n(rec)}
                          </span>))}
                      {/* A parent lists each seller inside the cell (rollup mode). */}
                      {hijos.length > 0 && hijos.filter((h) => c.porArea[h.slug] != null).map((h) => (
                        <span key={h.slug} className="block text-[10px] text-gray-500 whitespace-nowrap" data-testid={`desglose-${h.slug}`}
                              title={`${nombreCorto(h.nombre)}: capturó ${n(c.porArea[h.slug])}${bloqueoDe(h.slug) ? ' · bloqueado' : ''}`}>
                          {nombreCorto(h.nombre)} {n(c.porArea[h.slug])}{bloqueoDe(h.slug) ? ' 🔒' : ''}
                        </span>
                      ))}
                    </td>
                  );
                })}
                {esHijos && (
                  <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900" data-testid="total-canal">
                    {n(c.total)}
                  </td>
                )}
                <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900">
                  {n(c.total)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                  {c.directo ? n(c.directo) : ''}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                  {c.aRevision ? n(c.aRevision) : ''}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-500" data-testid="base">
                  {c.base ? n(c.base) : ''}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-500">
                  {c.proyeccion?.toLocaleString('es-GT', { maximumFractionDigits: 0 })
                    ?? <span className="text-gray-300">sin dato</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs text-gray-500">
              <td className="pt-3 pr-3" colSpan={areasConDatos.length + 1 + (esHijos ? 1 : 0)}>
                <PieSinAsignar meses={mesesSinAsignar} total={totalSinAsignar} />
              </td>
              <td className="pt-3 pr-3 text-right" colSpan={2}></td>
              <td className="pt-3 pr-3 text-right tabular-nums" data-testid="base-total">
                {totalBase ? <>{n(totalBase)} <span className="text-gray-400">aprobado, no sumado</span></> : ''}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        <span className="inline-block w-3 h-3 bg-amber-50 border border-amber-200 align-middle mr-1" />
        Resaltado: lo que va <strong>a revisión</strong> supera la proyección de la app, que es
        justamente el caso que la reunión tiene que discutir. Lo <strong>directo</strong> no
        dispara revisión — es certeza con destinatario y entra al pedido igual. Lo <strong>aprobado</strong> es
        la recomendación de la app que el canal aceptó: se compara, no se suma.
      </p>
    </section>
  );
}

/** Demand no channel owns — reported so it is seen, never silently dropped. */
function PieSinAsignar({ meses, total }: { meses: string[]; total: number }) {
  if (meses.length === 0) return null;
  return (
    <span data-testid="sin-asignar" title="Pedidos de equipos de Odoo que no pertenecen a ningún canal (hoy: el equipo «Sales»). Ningún jefe de canal los pronostica.">
      <strong>Sin canal asignado:</strong> {n(total)} unidades pedidas en {meses.length} meses
      ({meses[0].slice(0, 7)} a {meses[meses.length - 1].slice(0, 7)}).
    </span>
  );
}
