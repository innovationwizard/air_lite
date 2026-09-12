'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, Loader2, PackageSearch, Search,
} from 'lucide-react';

/**
 * Facturas pendientes — resolución de claves REYMA sin código (A12b).
 *
 * UNA sola acción por clave: elegir un candidato de la búsqueda en vivo
 * contra Odoo, o escribir el código a mano. Ninguna de las dos escribe nada
 * hasta que Alexis confirma — la búsqueda es sólo lectura (GET), igual que la
 * pantalla de carga no adivina destino ni ETA.
 *
 * No hay "ninguno de estos": si la clave no está en Odoo bajo ningún nombre,
 * la clave se queda pendiente — no hay a qué código mapearla todavía, y esta
 * pantalla no inventa uno.
 */

interface PendienteClave {
  clave: string; descripcion: string; primeraVez: string;
  facturas: number; guias: string[]; lineas: number; cantidad: number; unidad: string;
}
interface Candidato {
  codigo: string; nombre_odoo: string; nombre_reyma: string | null;
  uom: string | null; cubicaje: number; activo: boolean; fuente: string;
}
interface Mensaje { tono: 'ok' | 'ambar' | 'error'; texto: string }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function PendientesClient() {
  const [pendientes, setPendientes] = useState<PendienteClave[] | null>(null);
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <PackageSearch className="h-5 w-5 text-emerald-600" />
          Facturas pendientes
        </h1>
        <p className="mt-1 text-[13px] leading-snug text-slate-600">
          Productos nuevos de REYMA que todavía no tienen código de Suplicentro. Las facturas
          donde aparecieron <strong>ya se cargaron completas</strong> — esto es lo único que falta.
          En cuanto elijas el producto correcto, se aplica solo, en todas las facturas que lo esperan.
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
          No hay nada pendiente — todas las claves de REYMA tienen código.
        </div>
      )}

      <div className="space-y-3">
        {pendientes?.map((p) => (
          <TarjetaPendiente
            key={p.clave}
            p={p}
            abierto={abierto === p.clave}
            onAbrir={() => setAbierto((prev) => (prev === p.clave ? null : p.clave))}
            onResultado={(m) => { setMensaje(m); void recargar(); if (m.tono === 'ok') setAbierto(null); }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function TarjetaPendiente({
  p, abierto, onAbrir, onResultado,
}: {
  p: PendienteClave;
  abierto: boolean;
  onAbrir: () => void;
  onResultado: (m: Mensaje) => void;
}) {
  const [query, setQuery] = useState(p.descripcion);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [otros, setOtros] = useState<Candidato[]>([]);
  // Distinto de «no apareció nada»: si el servicio de búsqueda falló (Odoo no
  // configurado en el ML, timeout…), decirlo tal cual. Tratarlo como resultado
  // vacío le dice a Alexis que el producto no existe cuando ni se preguntó —
  // y de ahí salen reportes de «no acepta el código».
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [codigoManual, setCodigoManual] = useState('');
  const [resolviendo, setResolviendo] = useState<string | null>(null); // código en vuelo

  const buscar = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const r = await fetch(`/api/compras-internacionales/reyma/clave-pendiente/buscar?q=${encodeURIComponent(q)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCandidatos([]); setOtros([]);
        setErrorBusqueda(typeof j.error === 'string' ? j.error : 'No se pudo buscar en Odoo.');
        return;
      }
      setCandidatos(Array.isArray(j.candidatos) ? j.candidatos : []);
      setOtros(Array.isArray(j.otros) ? j.otros : []);
    } catch {
      setCandidatos([]); setOtros([]);
      setErrorBusqueda('No se pudo buscar en Odoo (error de red).');
    } finally {
      setBuscando(false);
      setBuscado(true);
    }
  }, [query]);

  // Al abrir la tarjeta, buscar sola con la descripción del CFDI — Alexis
  // ajusta el texto sólo si hace falta, no parte de una caja vacía.
  useEffect(() => {
    if (abierto && !buscado) void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const resolver = useCallback(async (codigo: string, candidato?: Candidato) => {
    if (!codigo.trim()) return;
    setResolviendo(codigo);
    try {
      const r = await fetch('/api/compras-internacionales/reyma/clave-pendiente/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clave: p.clave,
          codigo: codigo.trim(),
          descripcion: p.descripcion,
          nombreOdoo: candidato?.nombre_odoo ?? null,
          uom: candidato?.uom ?? null,
          cubicaje: candidato?.cubicaje ?? 0,
          fuente: candidato?.fuente ?? 'manual',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        onResultado({ tono: 'error', texto: j.error ?? `No se pudo resolver ${p.clave}.` });
        return;
      }
      if (j.aviso) {
        onResultado({ tono: 'ambar', texto: j.aviso });
        return;
      }
      const cuantas = j.aplicadas === 1 ? '1 línea' : `${j.aplicadas} líneas`;
      onResultado({
        tono: 'ok',
        texto: `${p.clave} → ${codigo}: se cargaron ${cuantas}`
             + (j.siguenPendientes > 0 ? ` — ${j.siguenPendientes} siguen pendientes por otro motivo.` : '.'),
      });
    } catch {
      onResultado({ tono: 'error', texto: `Error de red resolviendo ${p.clave}.` });
    } finally {
      setResolviendo(null);
    }
  }, [p.clave, p.descripcion, onResultado]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <button type="button" onClick={onAbrir} className="flex w-full items-start justify-between gap-3 text-left">
        <div>
          <div className="font-mono text-[14px] font-semibold text-slate-900">{p.clave}</div>
          <div className="mt-0.5 text-[13px] text-slate-700">{p.descripcion}</div>
          <div className="mt-1 text-[12px] text-slate-500">
            {p.lineas} línea{p.lineas === 1 ? '' : 's'} · {p.facturas} factura{p.facturas === 1 ? '' : 's'}
            {' '}({p.guias.join(', ')}) · esperando desde {fechaCorta(p.primeraVez)}
          </div>
        </div>
        {abierto ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                 : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {abierto && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setBuscado(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }}
              placeholder="Buscar en Odoo por nombre o código…"
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-[15px] text-slate-900"
            />
            <button
              type="button"
              onClick={() => void buscar()}
              disabled={buscando || query.trim().length < 2}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[13px] font-medium text-white disabled:bg-slate-300"
            >
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>

          {buscado && !buscando && errorBusqueda && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              La búsqueda en Odoo no funcionó: {errorBusqueda} Esto no dice nada sobre el
              producto — si ya sabés el código, escribilo abajo y confirmá; sirve igual.
            </p>
          )}

          {buscado && !buscando && !errorBusqueda && candidatos.length === 0 && otros.length === 0 && (
            <p className="mt-2 text-[12px] text-slate-500">
              No apareció nada en Odoo con ese texto. Probá con otra palabra de la descripción,
              o escribí el código directamente abajo si ya lo sabés.
            </p>
          )}

          {candidatos.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Así le dice REYMA a esto en Odoo
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {candidatos.map((c) => (
                  <CandidatoFila key={c.codigo} c={c} resolviendo={resolviendo} onElegir={() => void resolver(c.codigo, c)} />
                ))}
              </ul>
            </div>
          )}

          {otros.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Otros productos de Odoo que coinciden
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {otros.map((c) => (
                  <CandidatoFila key={c.codigo} c={c} resolviendo={resolviendo} onElegir={() => void resolver(c.codigo, c)} />
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex items-end gap-2 border-t border-slate-100 pt-3">
            <div className="flex-1">
              <label className="text-[12px] font-medium text-slate-600">¿Ya sabés el código?</label>
              <input
                type="text"
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value)}
                placeholder="p. ej. 77201001"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-[14px] text-slate-900"
              />
            </div>
            <button
              type="button"
              disabled={!codigoManual.trim() || resolviendo !== null}
              onClick={() => void resolver(codigoManual)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[14px] font-semibold text-white disabled:bg-slate-300"
            >
              {resolviendo === codigoManual.trim() ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirmar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CandidatoFila({
  c, resolviendo, onElegir,
}: {
  c: Candidato;
  resolviendo: string | null;
  onElegir: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-slate-500">{c.codigo}</span>
          {!c.activo && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">archivado</span>
          )}
        </div>
        <div className="truncate text-[13px] text-slate-800">{c.nombre_odoo}</div>
        {c.nombre_reyma && (
          <div className="truncate text-[11px] text-emerald-700">REYMA: «{c.nombre_reyma}»</div>
        )}
      </div>
      <button
        type="button"
        disabled={resolviendo !== null}
        onClick={onElegir}
        className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-800 disabled:opacity-50"
      >
        {resolviendo === c.codigo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Elegir
      </button>
    </li>
  );
}
