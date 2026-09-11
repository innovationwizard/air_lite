'use client';

import { useMemo } from 'react';
import { etiquetaMes, consolidar, type FilaForecast } from '@/lib/comercial/forecast';
import type { Datos } from './types';

/** Consolidado: lo que hoy se arma a mano. */

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

