'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, FileCheck2, History, Loader2, X } from 'lucide-react';
import type { Filtros, Orden } from '@/lib/compras/tabla';
import type { SnapshotPayload } from '@/lib/pdf/reabastecimientoStatusPdf';
import { BODEGA_LABEL } from '@/lib/compras/bodega';

/**
 * "Emitir prueba de estado" — proof of status for posterior audits.
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
 */

const CONFIRM_THRESHOLD = 300;

interface SnapshotButtonProps {
  bodega: string;
  filtros: Filtros;
  orden: Orden | null;
  visibleCount: number;
  canViewAllSnapshots: boolean;
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

async function descargarPdf(snapshot: SnapshotPayload): Promise<string> {
  const { renderReabastecimientoStatusPdf, reabastecimientoStatusFilename } =
    await import('@/lib/pdf/reabastecimientoStatusPdf');
  const blob = await renderReabastecimientoStatusPdf(snapshot);
  const filename = reabastecimientoStatusFilename(snapshot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

export function SnapshotButton({ bodega, filtros, orden, visibleCount, canViewAllSnapshots }: SnapshotButtonProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'idle' });
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const emitir = useCallback(async () => {
    setEstado({ tipo: 'generando' });
    try {
      const snapshot = await pedirSnapshot(bodega, filtros, orden);
      const nombreArchivo = await descargarPdf(snapshot);
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
    <div className="relative inline-flex items-center gap-2">
      {estado.tipo === 'confirmando' ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
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
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm
                     text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          title="Genera un PDF con todo lo que se ve en esta vista y un registro inmutable en el servidor, para auditorías posteriores"
        >
          {estado.tipo === 'generando' ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
          Emitir prueba de estado
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

      <button
        onClick={() => setHistorialAbierto((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs
                   text-gray-600 hover:bg-gray-50"
        title="Ver snapshots anteriores"
      >
        <History size={13} /> Historial
      </button>

      {historialAbierto && (
        <SnapshotHistoryPanel
          canViewAll={canViewAllSnapshots}
          onClose={() => setHistorialAbierto(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

interface HistoryRow {
  id: string;
  bodega: string;
  filtros: Filtros & { orden?: Orden | null };
  total_filas: number;
  created_at: string;
  autor: string;
}

function SnapshotHistoryPanel({ canViewAll, onClose }: { canViewAll: boolean; onClose: () => void }) {
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
      const res = await fetch(`/api/compras/reabastecimiento/snapshot/${id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const snapshot: SnapshotPayload = await res.json();
      await descargarPdf(snapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo volver a descargar');
    } finally {
      setDescargando(null);
    }
  }, []);

  return (
    <div className="absolute z-20 mt-1 w-[420px] rounded-md border border-gray-300 bg-white p-3 shadow-lg"
         style={{ top: '100%' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Snapshots emitidos</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      {canViewAll && (
        <div className="mb-2 flex gap-1 text-xs">
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

      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && rows === null && <p className="text-xs text-gray-400">Cargando…</p>}
      {!error && rows !== null && rows.length === 0 && (
        <p className="text-xs text-gray-400">Sin snapshots todavía.</p>
      )}
      {!error && rows !== null && rows.length > 0 && (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-700">
                  {BODEGA_LABEL[r.bodega] ?? r.bodega} · {new Date(r.created_at).toLocaleString('es-GT', { timeZone: 'America/Guatemala' })}
                </div>
                <div className="truncate text-gray-500">{r.total_filas} filas · {r.autor}</div>
              </div>
              <button
                onClick={() => void redescargar(r.id)}
                disabled={descargando === r.id}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                {descargando === r.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
