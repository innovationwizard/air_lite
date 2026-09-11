'use client';

import { useCallback, useState } from 'react';
import { Download } from 'lucide-react';
import { buildWorkbook } from '@/lib/xlsx/writer';
import {
  construirLibroForecast, nombreArchivo, sha256Hex,
  type ContextoForecastExport, type FilaForecastExport,
} from '@/lib/comercial/forecastExport';

/**
 * «Exportar a Excel» — the leader's table, as shown, plus every saved row of
 * the month that the 50-row cap keeps off screen (Jorge, 2026-09-11).
 *
 * The on-screen rows come from props — the same array the table paints. The
 * saved rows beyond the cap come from `cargarGuardadas`, which the parent
 * implements against `/api/comercial/historial?guardados=1`; this component
 * only unions the two (screen first, in screen order; then the rest).
 *
 * The download never waits on the audit record: the bytes go down, then the
 * record is posted; if the record fails the screen says so in red and the
 * user still has the file.
 */
export function ExportarForecast({ filas, contexto, cargarGuardadas }: {
  filas: readonly FilaForecastExport[];
  contexto: Omit<ContextoForecastExport, 'generadoEn' | 'enPantalla' | 'guardadasFueraDePantalla'>;
  cargarGuardadas: () => Promise<FilaForecastExport[]>;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportar = useCallback(async () => {
    setTrabajando(true); setError(null); setAviso(null);
    try {
      const enPantalla = new Set(filas.map((f) => f.productId));
      const guardadas = (await cargarGuardadas()).filter((f) => !enPantalla.has(f.productId))
        .map((f) => ({ ...f, fueraDePantalla: true }));
      const todas = [...filas, ...guardadas];
      const ctx: ContextoForecastExport = {
        ...contexto, generadoEn: new Date(),
        enPantalla: filas.length, guardadasFueraDePantalla: guardadas.length,
      };
      const archivo = nombreArchivo(ctx);
      const bytes = buildWorkbook(construirLibroForecast(todas, ctx));

      const blob = new Blob([bytes as unknown as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = archivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setAviso(`${todas.length} filas · ${ctx.areaNombre} · ${ctx.mes.slice(0, 7)}`
        + (guardadas.length ? ` (${guardadas.length} guardadas fuera de pantalla)` : ''));

      // The record: who downloaded what. Never blocks the download.
      try {
        const hash = await sha256Hex(bytes);
        const r = await fetch('/api/comercial/exportado', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            area: ctx.areaSlug, month: ctx.mes, archivo, hash, totalFilas: todas.length,
            filtros: {
              ...ctx.filtros, bloqueado: ctx.bloqueo !== null,
              enPantalla: ctx.enPantalla, guardadasFueraDePantalla: ctx.guardadasFueraDePantalla,
            },
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
      } catch (e) {
        setError(`El archivo se descargó, pero no quedó registrado: ${e instanceof Error ? e.message : 'error'}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el archivo');
    } finally {
      setTrabajando(false);
    }
  }, [filas, contexto, cargarGuardadas]);

  return (
    <div className="inline-flex items-center gap-2">
      {aviso && <span className="text-xs text-gray-500">{aviso}</span>}
      {error && <span className="text-xs font-semibold text-red-600">⚠ {error}</span>}
      <button
        type="button"
        onClick={exportar}
        disabled={trabajando || filas.length === 0}
        title="Descarga lo que ves en pantalla con los filtros actuales, más todo lo guardado para este mes aunque no esté en pantalla. Los tres meses van desplegados."
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-4 py-2 text-sm text-white
                   hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download size={14} /> {trabajando ? 'Exportando…' : 'Exportar a Excel'}
      </button>
    </div>
  );
}
