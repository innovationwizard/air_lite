'use client';

import { useMemo } from 'react';
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

export function Consolidado({ datos, mes }: { datos: Datos; mes: string }) {
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
  const cerrado = mes === datos.mesCerrado;
  const label = mesLabel(mes);
  const recomendadoDe = (area: string, productId: number): number | null =>
    datos.recomendaciones?.[area]?.[mes]?.[productId] ?? null;
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
          Consolidado de {etiquetaMes(mes)} — {filasCons.length} códigos
          {cerrado && <span className="text-gray-500 font-normal"> · mes cerrado: capturado contra real</span>}
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
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 align-bottom">
              <th className="py-2 pr-3 font-medium">Código</th>
              {areasConDatos.map((a) => (
                <th key={a.slug} className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                    title={cerrado
                      ? 'Arriba lo que el canal capturó; abajo lo que realmente pidió / se le entregó ese mes'
                      : 'Arriba lo que el canal capturó; abajo, en gris, lo que la app le recomendaba'}>
                  {a.nombre}
                  <span className="block font-normal text-gray-400">
                    {cerrado ? 'capturado · real pedido / entregado' : 'capturado · recomendado'}
                  </span>
                </th>
              ))}
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
                  const cap = c.porArea[a.slug];
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
                    </td>
                  );
                })}
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
              <td className="pt-3 pr-3" colSpan={areasConDatos.length + 1}>
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
