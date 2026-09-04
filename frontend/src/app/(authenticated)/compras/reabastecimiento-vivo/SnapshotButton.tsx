'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, FileCheck2, Loader2 } from 'lucide-react';
import type { Filtros, Orden } from '@/lib/compras/tabla';
import { descargarSnapshotPdf } from '@/lib/compras/snapshotDownload';
import type { SnapshotPayload } from '@/lib/pdf/reabastecimientoStatusPdf';

/**
 * "Capturar" — proof of status for posterior audits.
 * Plan: docs/compras/PROOF_OF_STATUS_IMPLEMENTATION_PLAN_2026-09-03.md
 *
 * Flow: POST /snapshot (server freezes the exact rows, server-authoritative —
 * see the route's own header comment for why) → the response IS the frozen
 * record → render + download the PDF from THAT response, never from local
 * page state.
 *
 * D-8: if the freeze POST fails, NOTHING downloads. This is the one place
 * this feature deliberately does not follow the Carvajal export's
 * "never block the download" posture (ExportCarvajal.tsx) — there the
 * download is the deliverable and the log is secondary; here the frozen
 * server record IS the deliverable, and a PDF without one would silently
 * look identical to a real proof while not being backed by anything.
 *
 * Past snapshots live at their own page (historial/), not a dropdown here —
 * "browse history" isn't an action on this toolbar, it's navigation
 * (Jorge, 2026-09-04).
 */

const CONFIRM_THRESHOLD = 300;

interface SnapshotButtonProps {
  bodega: string;
  filtros: Filtros;
  orden: Orden | null;
  visibleCount: number;
}

type Estado =
  | { tipo: 'idle' }
  | { tipo: 'confirmando' }
  | { tipo: 'generando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'ok'; nombreArchivo: string };

async function pedirSnapshot(bodega: string, filtros: Filtros, orden: Orden | null): Promise<SnapshotPayload> {
  const res = await fetch('/api/compras/reabastecimiento/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bodega, filtros, orden }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function SnapshotButton({ bodega, filtros, orden, visibleCount }: SnapshotButtonProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'idle' });

  const emitir = useCallback(async () => {
    setEstado({ tipo: 'generando' });
    try {
      const snapshot = await pedirSnapshot(bodega, filtros, orden);
      const nombreArchivo = await descargarSnapshotPdf(snapshot);
      setEstado({ tipo: 'ok', nombreArchivo });
    } catch (e) {
      // D-8: freeze failed → nothing was rendered, nothing was downloaded.
      setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'Error desconocido' });
    }
  }, [bodega, filtros, orden]);

  const onClick = useCallback(() => {
    if (visibleCount > CONFIRM_THRESHOLD && estado.tipo === 'idle') {
      setEstado({ tipo: 'confirmando' });
      return;
    }
    void emitir();
  }, [visibleCount, estado.tipo, emitir]);

  useEffect(() => {
    if (estado.tipo !== 'ok') return;
    const t = setTimeout(() => setEstado({ tipo: 'idle' }), 6000);
    return () => clearTimeout(t);
  }, [estado.tipo]);

  return (
    <div className="inline-flex items-center gap-2">
      {estado.tipo === 'confirmando' ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          <span>Esto generará un documento con las {visibleCount} filas visibles. ¿Continuar?</span>
          <button
            onClick={() => void emitir()}
            className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            Continuar
          </button>
          <button
            onClick={() => setEstado({ tipo: 'idle' })}
            className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={onClick}
          disabled={estado.tipo === 'generando' || visibleCount === 0}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs
                     text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Genera un PDF con todo lo que se ve en esta vista y un registro inmutable en el servidor, para auditorías posteriores"
        >
          {estado.tipo === 'generando' ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
          Capturar
        </button>
      )}

      {estado.tipo === 'ok' && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <Download size={12} /> {estado.nombreArchivo}
        </span>
      )}
      {estado.tipo === 'error' && (
        <span className="inline-flex items-center gap-1 text-xs text-red-700" title={estado.mensaje}>
          <AlertTriangle size={12} /> No se pudo generar: {estado.mensaje}
        </span>
      )}
    </div>
  );
}
