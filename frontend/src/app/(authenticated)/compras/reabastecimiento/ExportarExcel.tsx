'use client';

import { useCallback, useState } from 'react';
import { Download } from 'lucide-react';
import { buildWorkbook } from '@/lib/xlsx/writer';
import {
  type ContextoExport, type FilaExport,
  construirLibroSugerido, nombreArchivo, proveedorParaMostrar, sinCubicaje,
} from '@/lib/compras/sugeridoExport';

/**
 * «Exportar Excel» — descarga la vista activa, de un click.
 *
 * TODO LO QUE ESTE COMPONENTE SABE VIENE DE SUS PROPS, y sus props son el
 * mismo arreglo `list` que la tabla está pintando. No hace fetch, no consulta
 * otra bodega y no propone ninguna cantidad. Ésa es la corrección entera de
 * los cuatro defectos del 26-ago (D1–D4): no se arreglaron uno por uno, se
 * quitó la única cosa que los producía — una segunda fuente de datos.
 *
 * Ver `lib/compras/sugeridoExport.ts` para la forma del archivo y el porqué de
 * cada decisión; acá sólo queda armar los bytes y bajarlos.
 *
 * Sin modal a propósito (Jorge, 2026-09-07): el modal anterior existía para
 * corregir una propuesta inventada (`Sugerido ÷ cobertura × 7`). Sin propuesta
 * que corregir, un paso más entre él y el archivo no compra nada — y lo que
 * pidió fue manipularlo en Excel, no en la app.
 */
export function ExportarExcel({ filas, contexto, filasEnPantalla, areas = [] }: {
  filas: readonly FilaExport[];
  /** Canales comerciales — sus columnas van en el archivo igual que en pantalla. */
  areas?: readonly { slug: string; nombre: string }[];
  /** Todo menos `generadoEn`, que se fija en el instante del click. */
  contexto: Omit<ContextoExport, 'generadoEn'>;
  /**
   * Cuántas filas ALCANZA A PINTAR la tabla (hoy 400). El archivo lleva todas
   * las del filtro, que es lo que sirve en Excel — pero entonces el archivo y
   * la pantalla no traen lo mismo, y eso hay que decirlo ANTES del click y no
   * descubrirlo abriendo el archivo. Es la misma clase de sorpresa que
   * arruinó la confianza en este botón.
   */
  filasEnPantalla: number;
}) {
  const recortada = filas.length > filasEnPantalla;
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportar = useCallback(() => {
    setError(null);
    try {
      const ctx: ContextoExport = { ...contexto, generadoEn: new Date() };
      const archivo = nombreArchivo(ctx);
      const bytes = buildWorkbook(construirLibroSugerido(filas, ctx, areas));

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

      // La confirmación repite la IDENTIDAD del archivo — bodega y proveedor —
      // porque los dos defectos que reportó eran de identidad. Si alguna vez
      // vuelve a bajar lo que no es, se ve acá y no media hora después.
      const faltantes = sinCubicaje(filas);
      setAviso(
        `${filas.length} filas · ${ctx.bodegaLabel} · ${proveedorParaMostrar(ctx.proveedorLabel)}`
        + (recortada ? ` (en pantalla se ven ${filasEnPantalla})` : '')
        + (faltantes > 0 ? ` · ⚠ ${faltantes} sin cubicaje` : ''),
      );
      setTimeout(() => setAviso(null), 6000);
    } catch (e) {
      // Un fallo acá es silencioso por naturaleza (no baja nada), que es el
      // peor modo posible para un botón de descarga.
      setError(e instanceof Error ? e.message : 'No se pudo generar el archivo');
    }
  }, [filas, contexto, recortada, filasEnPantalla, areas]);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={exportar}
        disabled={filas.length === 0}
        title={filas.length === 0
          ? 'No hay filas que exportar con los filtros actuales'
          : `Descargar las ${filas.length} filas de ${contexto.bodegaLabel} `
            + `(${proveedorParaMostrar(contexto.proveedorLabel)}) tal como están en pantalla`
            + (recortada
              ? ` — el archivo lleva las ${filas.length} del filtro, aunque la tabla `
                + `sólo alcance a mostrar las primeras ${filasEnPantalla}`
              : '')}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-teal-600
                   bg-teal-600 px-3 py-2 text-xs text-white hover:bg-teal-700
                   disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-400"
      >
        <Download size={13} /> Exportar Excel
      </button>
      {aviso && <span className="text-xs text-gray-500">{aviso}</span>}
      {error && <span className="text-xs font-semibold text-red-600">⚠ {error}</span>}
    </div>
  );
}
