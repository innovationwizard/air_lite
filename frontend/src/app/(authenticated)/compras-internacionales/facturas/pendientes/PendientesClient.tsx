'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, PackageSearch } from 'lucide-react';
import { ConfirmarIdentificador, type Resuelto } from '../ConfirmarIdentificador';

/**
 * Facturas pendientes — identificadores de REYMA que todavía no tienen SKU.
 *
 * La misma pregunta que en la pantalla de carga («Por favor confirme que el
 * identificador X corresponde al SKU Y» → Sí / No → «¿Cuál es el SKU
 * correcto?»), para las líneas que Alexis no confirmó en el momento de
 * cargar. Las facturas donde aparecieron ya se cargaron completas; confirmar
 * acá aplica de un tirón todas las líneas que esperan ese identificador.
 *
 * Reglas (Jorge, 2026-09-12): la app propone, Alexis confirma, nada se asigna
 * solo, y no hay cola para nadie más. Vocabulario del documento de REYMA:
 * «identificador» y «SKU» — nunca «clave» ni «código» en pantalla.
 */

interface PendienteIdentificador {
  clave: string; descripcion: string; primeraVez: string;
  facturas: number; guias: string[]; lineas: number; cantidad: number; unidad: string;
  fecha: string; cantidadLinea: number;
}
interface Mensaje { tono: 'ok' | 'ambar' | 'error'; texto: string }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function PendientesClient() {
  const [pendientes, setPendientes] = useState<PendienteIdentificador[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);

  const recargar = useCallback(async () => {
    try {
      const r = await fetch('/api/compras-internacionales/reyma/clave-pendiente');
      const j = await r.json().catch(() => ({}));
      setPendientes(Array.isArray(j.pendientes) ? j.pendientes : []);
    } catch {
      setPendientes((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => { void recargar(); }, [recargar]);

  const alResolver = useCallback((p: PendienteIdentificador, r: Resuelto) => {
    if (r.aviso) {
      setMensaje({ tono: 'ambar', texto: r.aviso });
    } else {
      const cuantas = r.aplicadas === 1 ? '1 línea' : `${r.aplicadas} líneas`;
      setMensaje({
        tono: 'ok',
        texto: `Identificador ${p.clave} → SKU ${r.sku}: se cargaron ${cuantas}`
             + (r.siguenPendientes > 0 ? ` — ${r.siguenPendientes} siguen pendientes por otro motivo.` : '.'),
      });
      setAbierto(null);
    }
    void recargar();
  }, [recargar]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <PackageSearch className="h-5 w-5 text-emerald-600" />
          Facturas pendientes
        </h1>
        <p className="mt-1 text-[13px] leading-snug text-slate-600">
          Identificadores nuevos de REYMA que todavía no tienen SKU. Las facturas donde
          aparecieron <strong>ya se cargaron completas</strong> — esto es lo único que falta.
          En cuanto confirmés el SKU, se aplica solo en todas las facturas que lo esperan.
        </p>
      </header>

      {mensaje && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-[13px] ${
            mensaje.tono === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : mensaje.tono === 'ambar'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      {pendientes === null && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      {pendientes && pendientes.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[13px] text-emerald-900">
          <Check className="mr-1.5 inline h-4 w-4" />
          No hay nada pendiente — todos los identificadores de REYMA tienen SKU.
        </div>
      )}

      <div className="space-y-3">
        {pendientes?.map((p) => (
          <section key={p.clave} className="rounded-xl border border-slate-200 bg-white p-4">
            <button
              type="button"
              onClick={() => setAbierto((prev) => (prev === p.clave ? null : p.clave))}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div>
                <div className="text-[12px] text-slate-500">Identificador</div>
                <div className="font-mono text-[14px] font-semibold text-slate-900">{p.clave}</div>
                <div className="mt-0.5 text-[13px] text-slate-700">{p.descripcion}</div>
                <div className="mt-1 text-[12px] text-slate-500">
                  {p.lineas} línea{p.lineas === 1 ? '' : 's'} · {p.facturas} factura{p.facturas === 1 ? '' : 's'}
                  {' '}({p.guias.join(', ')}) · esperando desde {fechaCorta(p.primeraVez)}
                </div>
              </div>
              {abierto === p.clave
                ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
            </button>

            {abierto === p.clave && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <ConfirmarIdentificador
                  identificador={p.clave}
                  descripcion={p.descripcion}
                  fecha={p.fecha}
                  cantidad={p.cantidadLinea}
                  unidad={p.unidad}
                  onResuelto={(r) => alResolver(p, r)}
                  onError={(texto) => setMensaje({ tono: 'error', texto })}
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
