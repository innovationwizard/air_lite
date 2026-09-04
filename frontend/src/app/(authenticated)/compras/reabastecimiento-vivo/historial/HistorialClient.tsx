'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import type { Filtros, Orden } from '@/lib/compras/tabla';
import { BODEGA_LABEL } from '@/lib/compras/bodega';
import { redescargarSnapshot } from '@/lib/compras/snapshotDownload';

interface HistoryRow {
  id: string;
  bodega: string;
  filtros: Filtros & { orden?: Orden | null };
  total_filas: number;
  created_at: string;
  autor: string;
}

function resumenFiltros(f: HistoryRow['filtros']): string {
  const partes: string[] = [];
  if (f.texto) partes.push(`texto "${f.texto}"`);
  if (f.proveedor) partes.push(`proveedor ${f.proveedor.startsWith('group:') ? `grupo ${f.proveedor.slice(6)}` : f.proveedor}`);
  if (f.soloConSugerido) partes.push('con sugerido');
  if (f.soloCriticos) partes.push('críticos');
  if (f.soloEnAlza) partes.push('en alza');
  if (f.soloComprables) partes.push('comprables');
  const rangos = Object.keys(f.rangos ?? {}).length;
  if (rangos > 0) partes.push(`${rangos} rango${rangos > 1 ? 's' : ''}`);
  return partes.length ? partes.join(' · ') : 'sin filtros';
}

export function HistorialClient({ isSuperuser }: { isSuperuser: boolean }) {
  const [scope, setScope] = useState<'own' | 'all'>('own');
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setRows(null);
    setError(null);
    fetch(`/api/compras/reabastecimiento/snapshot?scope=${scope}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((body) => { if (!cancelado) setRows(body.snapshots ?? []); })
      .catch((e) => { if (!cancelado) setError(e instanceof Error ? e.message : 'Error leyendo el historial'); });
    return () => { cancelado = true; };
  }, [scope]);

  const redescargar = useCallback(async (id: string) => {
    setDescargando(id);
    try {
      await redescargarSnapshot(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo volver a descargar');
    } finally {
      setDescargando(null);
    }
  }, []);

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <div className="mb-4">
        <Link
          href="/compras/reabastecimiento-vivo"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={13} /> Volver a Reabastecimiento en Vivo
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900">Historial de snapshots</h1>
        <p className="text-sm text-gray-500">Pruebas de estado emitidas — cada una es un registro inmutable, para auditorías</p>
      </div>

      {isSuperuser && (
        <div className="mb-3 flex gap-1 text-xs">
          <button
            onClick={() => setScope('own')}
            className={`rounded px-2 py-1 ${scope === 'own' ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-600'}`}
          >
            Míos
          </button>
          <button
            onClick={() => setScope('all')}
            className={`rounded px-2 py-1 ${scope === 'all' ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-600'}`}
          >
            Todos (superuser)
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && rows === null && <p className="text-sm text-gray-400">Cargando…</p>}
      {!error && rows !== null && rows.length === 0 && (
        <p className="text-sm text-gray-400">Sin snapshots todavía.</p>
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Bodega</th>
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Filas</th>
                <th className="px-3 py-2 font-semibold">Filtros</th>
                <th className="px-3 py-2 font-semibold">Autor</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium text-gray-700">{BODEGA_LABEL[r.bodega] ?? r.bodega}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {new Date(r.created_at).toLocaleString('es-GT', { timeZone: 'America/Guatemala' })}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.total_filas}</td>
                  <td className="px-3 py-2 text-gray-500">{resumenFiltros(r.filtros)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.autor}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => void redescargar(r.id)}
                      disabled={descargando === r.id}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {descargando === r.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      Descargar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
