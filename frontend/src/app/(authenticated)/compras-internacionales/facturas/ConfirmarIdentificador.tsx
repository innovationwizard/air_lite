'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

/**
 * «Por favor confirme que el identificador X corresponde al SKU Y» — y si la
 * respuesta es No, «¿Cuál es el SKU correcto?».
 *
 * Es la misma pregunta en las dos pantallas (carga de facturas y facturas
 * pendientes), así que vive una sola vez. Reglas (Jorge, 2026-09-12):
 *
 *   · La app PROPONE (orden de compra + la palabra de REYMA en Odoo +
 *     estructura de la descripción). NUNCA asigna sola: sin un «Sí» de
 *     Alexis no se escribe nada.
 *   · Alexis es la única fuente autorizada. No hay cola para nadie más.
 *   · Vocabulario del documento de REYMA: «identificador» (CH2PRXN) y «SKU»
 *     (77201001). Nunca «clave» ni «código» en pantalla.
 *   · Un SKU escrito a mano se verifica en Odoo y se muestra su nombre antes
 *     de confirmarlo; si no existe, no se acepta.
 */

export interface Candidato {
  sku: string; nombre_odoo: string; nombre_reyma: string | null;
  uom: string | null; cubicaje: number; activo: boolean; oc: string | null;
  puntaje: number; evidencia: string[]; en_contra: string[];
}
interface Verificado {
  sku: string; nombre_odoo: string; uom: string | null; cubicaje: number;
  activo: boolean; es_de_reyma: boolean; ya_asignado_a: string | null;
}
export interface Resuelto {
  sku: string; nombre: string | null; aplicadas: number; siguenPendientes: number; aviso?: string;
}

type Fase = 'proponiendo' | 'pregunta' | 'sku' | 'confirmando';

export function ConfirmarIdentificador({
  identificador, descripcion, fecha, cantidad, unidad, onResuelto, onError,
}: {
  identificador: string;
  descripcion: string;
  fecha?: string | null;
  cantidad?: number | null;
  unidad?: string | null;
  onResuelto: (r: Resuelto) => void;
  onError?: (texto: string) => void;
}) {
  const [fase, setFase] = useState<Fase>('proponiendo');
  const [propuesta, setPropuesta] = useState<Candidato | null>(null);
  const [otras, setOtras] = useState<Candidato[]>([]);
  const [errorPropuesta, setErrorPropuesta] = useState<string | null>(null);
  const [rechazados, setRechazados] = useState<string[]>([]);

  const [skuTexto, setSkuTexto] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [verificado, setVerificado] = useState<Verificado | null>(null);
  const [errorSku, setErrorSku] = useState<string | null>(null);

  // ── Paso 0: pedir la propuesta ────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/compras-internacionales/reyma/clave-pendiente/proponer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identificador, descripcion, fecha: fecha ?? null, cantidad: cantidad ?? null, unidad: unidad ?? null }),
        });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) {
          setErrorPropuesta(typeof j.error === 'string' ? j.error : 'No se pudo consultar Odoo.');
          setFase('sku');
          return;
        }
        if (typeof j.ya_asignado === 'string' && j.ya_asignado) {
          // Alguien lo resolvió mientras tanto (otro furgón de la misma semana).
          onResuelto({ sku: j.ya_asignado, nombre: null, aplicadas: 0, siguenPendientes: 0 });
          return;
        }
        const p = (j.propuesta ?? null) as Candidato | null;
        setPropuesta(p);
        setOtras(Array.isArray(j.otras) ? j.otras : []);
        setFase(p ? 'pregunta' : 'sku');
      } catch {
        if (!vivo) return;
        setErrorPropuesta('No se pudo consultar Odoo (error de red).');
        setFase('sku');
      }
    })();
    return () => { vivo = false; };
    // Se pide UNA vez por identificador; la descripción/fecha son del mismo documento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identificador]);

  // ── Escribir el mapeo (sólo tras un Sí, o un SKU verificado y confirmado) ──
  const confirmar = useCallback(async (
    sku: string, nombre: string | null, uom: string | null, cubicaje: number, fuente: 'propuesta' | 'manual',
  ) => {
    setFase('confirmando');
    try {
      const r = await fetch('/api/compras-internacionales/reyma/clave-pendiente/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clave: identificador, codigo: sku, descripcion, nombreOdoo: nombre, uom, cubicaje, fuente,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError?.(typeof j.error === 'string' ? j.error : `No se pudo asignar el identificador ${identificador}.`);
        setFase(fuente === 'propuesta' ? 'pregunta' : 'sku');
        return;
      }
      onResuelto({
        sku, nombre,
        aplicadas: Number(j.aplicadas ?? 0),
        siguenPendientes: Number(j.siguenPendientes ?? 0),
        aviso: typeof j.aviso === 'string' ? j.aviso : undefined,
      });
    } catch {
      onError?.(`Error de red asignando el identificador ${identificador}.`);
      setFase(fuente === 'propuesta' ? 'pregunta' : 'sku');
    }
  }, [identificador, descripcion, onResuelto, onError]);

  // ── «No» → ¿Cuál es el SKU correcto? ──────────────────────────────────────
  const decirNo = useCallback(() => {
    if (propuesta) setRechazados((prev) => [...prev, propuesta.sku]);
    setFase('sku');
  }, [propuesta]);

  const verificar = useCallback(async (sku: string) => {
    const s = sku.trim();
    if (!s) return;
    setVerificando(true);
    setVerificado(null);
    setErrorSku(null);
    try {
      const r = await fetch(`/api/compras-internacionales/reyma/clave-pendiente/verificar-sku?sku=${encodeURIComponent(s)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorSku(typeof j.error === 'string' ? j.error : `No se pudo verificar el SKU ${s}.`);
        return;
      }
      setVerificado(j as Verificado);
    } catch {
      setErrorSku('No se pudo verificar el SKU (error de red).');
    } finally {
      setVerificando(false);
    }
  }, []);

  const sugerencias = otras.filter((c) => !rechazados.includes(c.sku));

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (fase === 'proponiendo') {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Buscando en Odoo el SKU del identificador <span className="font-mono font-semibold">{identificador}</span>…
      </div>
    );
  }

  if (fase === 'confirmando') {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Asignando…
      </div>
    );
  }

  if (fase === 'pregunta' && propuesta) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-white p-3">
        <p className="text-[14px] leading-snug text-slate-900">
          Por favor confirme que el identificador{' '}
          <span className="font-mono font-semibold">{identificador}</span>{' '}
          corresponde al SKU{' '}
          <span className="font-mono font-semibold">{propuesta.sku}</span>
        </p>
        <p className="mt-1 text-[13px] text-slate-700">
          <span className="font-medium">{propuesta.nombre_odoo}</span>
          {propuesta.uom ? <span className="text-slate-500"> · {propuesta.uom}</span> : null}
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          En la factura: «{descripcion}»
        </p>
        {propuesta.evidencia.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[12px] text-slate-600">
            {propuesta.evidencia.map((e, i) => <li key={i}>· {e}</li>)}
          </ul>
        )}
        {propuesta.en_contra.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800">
            {propuesta.en_contra.map((e, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void confirmar(propuesta.sku, propuesta.nombre_odoo, propuesta.uom, propuesta.cubicaje, 'propuesta')}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[15px] font-semibold text-white"
          >
            <Check className="h-4 w-4" /> Sí
          </button>
          <button
            type="button"
            onClick={decirNo}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-slate-300 bg-white px-4 text-[15px] font-semibold text-slate-800"
          >
            <X className="h-4 w-4" /> No
          </button>
        </div>
      </div>
    );
  }

  // fase === 'sku'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[14px] font-medium text-slate-900">
        ¿Cuál es el SKU correcto para el identificador{' '}
        <span className="font-mono font-semibold">{identificador}</span>?
      </p>
      <p className="mt-1 text-[12px] text-slate-500">En la factura: «{descripcion}»</p>

      {errorPropuesta && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          No se pudo consultar Odoo para proponer un SKU: {errorPropuesta} Si lo sabés, escribilo abajo.
        </p>
      )}

      {sugerencias.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Puede ser uno de estos
          </div>
          <ul className="mt-1 space-y-1">
            {sugerencias.slice(0, 6).map((c) => (
              <li key={c.sku}>
                <button
                  type="button"
                  onClick={() => { setSkuTexto(c.sku); void verificar(c.sku); }}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-slate-300"
                >
                  <span className="font-mono text-[13px] font-semibold text-slate-800">{c.sku}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{c.nombre_odoo}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="text-[12px] font-medium text-slate-600">SKU</label>
          <input
            type="text"
            inputMode="numeric"
            value={skuTexto}
            onChange={(e) => { setSkuTexto(e.target.value); setVerificado(null); setErrorSku(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void verificar(skuTexto); }}
            placeholder="p. ej. 77201001"
            className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-[15px] text-slate-900"
          />
        </div>
        <button
          type="button"
          disabled={verificando || !skuTexto.trim()}
          onClick={() => void verificar(skuTexto)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[13px] font-medium text-white disabled:bg-slate-300"
        >
          {verificando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Buscar
        </button>
      </div>

      {errorSku && <p className="mt-2 text-[12px] text-red-700">{errorSku}</p>}

      {verificado && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[13px] text-slate-900">
            <span className="font-mono font-semibold">{verificado.sku}</span> — {verificado.nombre_odoo}
            {verificado.uom ? <span className="text-slate-500"> · {verificado.uom}</span> : null}
          </p>
          {!verificado.es_de_reyma && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Este SKU no aparece como producto de REYMA en Odoo. Confirmalo sólo si estás seguro.
            </p>
          )}
          {verificado.ya_asignado_a && verificado.ya_asignado_a !== identificador && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Este SKU ya está asignado al identificador {verificado.ya_asignado_a}.
            </p>
          )}
          {!verificado.activo && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Este producto está inactivo en Odoo.
            </p>
          )}
          <button
            type="button"
            onClick={() => void confirmar(verificado.sku, verificado.nombre_odoo, verificado.uom, verificado.cubicaje, 'manual')}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[15px] font-semibold text-white"
          >
            <Check className="h-4 w-4" /> Confirmar SKU {verificado.sku}
          </button>
        </div>
      )}
    </div>
  );
}
