'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FALLBACK, PREVIEW_KEYS, REGLA_TITULO, aceptarRegla, resumenRegla, type RuleKey,
} from '@/lib/compras/reglasConfig';
import type { ExplicacionSku } from '@/lib/compras/explicarSku';

interface ReglaCargada {
  key: RuleKey;
  value: unknown;
  origen: 'tabla' | 'constante' | 'ignorado';
  resumen: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

const INPUT = 'w-full rounded border border-gray-300 px-2 py-1 text-sm';
const ETIQUETA: Record<string, string> = {
  'San Jose VN': 'San José',
  Zacapa: 'Zacapa',
  'Petén': 'Petén',
  General: 'General',
};

export function ReglasClient() {
  const [reglas, setReglas] = useState<ReglaCargada[] | null>(null);
  const [draft, setDraft] = useState<Partial<Record<RuleKey, unknown>>>({});
  const [crudo, setCrudo] = useState<Partial<Record<RuleKey, boolean>>>({});
  const [texto, setTexto] = useState<Partial<Record<RuleKey, string>>>({});
  const [aviso, setAviso] = useState<Partial<Record<RuleKey, string>>>({});
  const [guardando, setGuardando] = useState<RuleKey | null>(null);
  const [cargaError, setCargaError] = useState<string | null>(null);
  const [sku, setSku] = useState('');
  const [preview, setPreview] = useState<ExplicacionSku | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewCargando, setPreviewCargando] = useState(false);

  const aplicarRespuesta = useCallback((lista: ReglaCargada[]) => {
    setReglas(lista);
    const valores: Partial<Record<RuleKey, unknown>> = {};
    const modos: Partial<Record<RuleKey, boolean>> = {};
    const json: Partial<Record<RuleKey, string>> = {};
    for (const r of lista) {
      valores[r.key] = r.value;
      modos[r.key] = r.origen === 'ignorado';
      json[r.key] = JSON.stringify(r.value, null, 2);
    }
    setDraft(valores);
    setCrudo(modos);
    setTexto(json);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/configuracion/reglas');
        const cuerpo = await r.json();
        if (!r.ok) throw new Error(cuerpo.error ?? `HTTP ${r.status}`);
        if (vivo) aplicarRespuesta(cuerpo.reglas);
      } catch (e) {
        if (vivo) setCargaError(e instanceof Error ? e.message : 'No se pudieron leer las reglas');
      }
    })();
    return () => { vivo = false; };
  }, [aplicarRespuesta]);

  function valorDe(key: RuleKey): unknown {
    if (crudo[key]) {
      try {
        return JSON.parse(texto[key] ?? '');
      } catch {
        return undefined;
      }
    }
    return draft[key];
  }

  async function guardar(key: RuleKey) {
    const value = valorDe(key);
    if (crudo[key] && value === undefined) {
      setAviso((a) => ({ ...a, [key]: 'El JSON no se pudo leer' }));
      return;
    }
    if (aceptarRegla(key, value) === null) {
      setAviso((a) => ({ ...a, [key]: 'Esa forma no la aplica el cálculo, así que no se guardó.' }));
      return;
    }
    setGuardando(key);
    setAviso((a) => ({ ...a, [key]: '' }));
    try {
      const r = await fetch('/api/configuracion/reglas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? `HTTP ${r.status}`);
      setReglas((lista) => (lista ?? []).map((item) => item.key === key
        ? { ...item, value: cuerpo.value, origen: 'tabla', resumen: cuerpo.resumen, updatedBy: 'ahora' }
        : item));
      setDraft((d) => ({ ...d, [key]: cuerpo.value }));
      setTexto((t) => ({ ...t, [key]: JSON.stringify(cuerpo.value, null, 2) }));
      setAviso((a) => ({ ...a, [key]: 'Guardado. El historial quedó en config_rules_history.' }));
    } catch (e) {
      setAviso((a) => ({ ...a, [key]: e instanceof Error ? e.message : 'No se pudo guardar' }));
    } finally {
      setGuardando(null);
    }
  }

  async function comparar() {
    const reglasBorrador: Record<string, unknown> = {};
    for (const key of PREVIEW_KEYS) {
      const value = valorDe(key);
      if (aceptarRegla(key, value) === null) {
        setPreviewError(`${REGLA_TITULO[key]} no tiene una forma aplicable. Corrija esa tarjeta antes de comparar.`);
        setPreview(null);
        return;
      }
      reglasBorrador[key] = value;
    }
    setPreviewCargando(true);
    setPreviewError(null);
    try {
      const r = await fetch('/api/configuracion/reglas/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, reglas: reglasBorrador }),
      });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? `HTTP ${r.status}`);
      setPreview(cuerpo as ExplicacionSku);
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : 'No se pudo comparar');
    } finally {
      setPreviewCargando(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Reglas de reabastecimiento</h1>
        <p className="mt-1 text-sm text-gray-600">
          Estas once reglas son las que usa el cálculo. Guardar escribe <code>config_rules</code> y
          el historial. La grilla no cambia hasta la próxima sincronización, salvo el pendiente de
          reserva, que se lee en vivo. La semilla reproduce el comportamiento anterior.
        </p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">Vista previa en un SKU</h2>
        <p className="mt-1 text-xs text-gray-500">
          Compara existencias, patio, tránsito y pendiente. Es una lectura en vivo y no escribe la
          sincronización. DOH, ABC, Sugerido y cobertura se guardan en sus tarjetas y no entran en
          esta comparación. Con la semilla, las dos columnas coinciden.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className={`${INPUT} max-w-xs`}
            value={sku}
            placeholder="SKU, por ejemplo 77205003"
            onChange={(e) => setSku(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={previewCargando || !sku.trim()}
            onClick={() => void comparar()}
          >
            {previewCargando ? 'Leyendo…' : 'Comparar'}
          </button>
        </div>
        {previewError && <p className="mt-2 text-sm text-red-700">{previewError}</p>}
        {preview && <TablaPreview data={preview} />}
      </section>

      {cargaError && <p className="text-sm text-red-700">{cargaError}</p>}
      {!reglas && !cargaError && <p className="text-sm text-gray-500">Cargando reglas…</p>}

      {reglas?.map((regla) => (
        <Tarjeta
          key={regla.key}
          regla={regla}
          valor={draft[regla.key]}
          modoCrudo={Boolean(crudo[regla.key])}
          texto={texto[regla.key] ?? ''}
          aviso={aviso[regla.key] ?? ''}
          guardando={guardando === regla.key}
          onValor={(value) => setDraft((d) => ({ ...d, [regla.key]: value }))}
          onModo={(raw) => {
            if (raw) {
              setTexto((t) => ({ ...t, [regla.key]: JSON.stringify(draft[regla.key] ?? FALLBACK[regla.key], null, 2) }));
            } else {
              let parsed: unknown;
              try {
                parsed = JSON.parse(texto[regla.key] ?? '');
              } catch {
                setAviso((a) => ({ ...a, [regla.key]: 'El JSON no se pudo leer; se queda en modo texto.' }));
                return;
              }
              if (aceptarRegla(regla.key, parsed) === null) {
                setAviso((a) => ({ ...a, [regla.key]: 'Ese JSON no tiene la forma aplicable; se queda en modo texto.' }));
                return;
              }
              setDraft((d) => ({ ...d, [regla.key]: parsed }));
            }
            setCrudo((m) => ({ ...m, [regla.key]: raw }));
          }}
          onTexto={(value) => setTexto((t) => ({ ...t, [regla.key]: value }))}
          onGuardar={() => void guardar(regla.key)}
        />
      ))}
    </div>
  );
}

function Tarjeta({
  regla, valor, modoCrudo, texto, aviso, guardando, onValor, onModo, onTexto, onGuardar,
}: {
  regla: ReglaCargada;
  valor: unknown;
  modoCrudo: boolean;
  texto: string;
  aviso: string;
  guardando: boolean;
  onValor: (value: unknown) => void;
  onModo: (raw: boolean) => void;
  onTexto: (value: string) => void;
  onGuardar: () => void;
}) {
  const resumen = aceptarRegla(regla.key, modoCrudo ? safeParse(texto) : valor)
    ? resumenRegla(regla.key, modoCrudo ? safeParse(texto) : valor)
    : regla.resumen;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{REGLA_TITULO[regla.key]}</h2>
          <p className="text-[11px] text-gray-400">{regla.key}</p>
        </div>
        <span className="text-[11px] text-gray-500">
          {regla.origen === 'tabla' ? 'Guardada' : regla.origen === 'ignorado' ? 'Guardada, pero el cálculo la ignora' : 'Aún no hay fila: se usa la constante'}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{resumen}</p>
      <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={modoCrudo} onChange={(e) => onModo(e.target.checked)} />
        Editar el JSON
      </label>
      <div className="mt-3">
        {modoCrudo
          ? <textarea className={`${INPUT} min-h-36 font-mono text-xs`} value={texto} onChange={(e) => onTexto(e.target.value)} />
          : <Editor clave={regla.key} valor={valor} onChange={onValor} />}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={guardando}
          onClick={onGuardar}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        {aviso && (
          <p className={`text-sm ${aviso.startsWith('Guardado') ? 'text-gray-700' : 'text-red-700'}`}>{aviso}</p>
        )}
      </div>
    </section>
  );
}

function Editor({ clave, valor, onChange }: { clave: RuleKey; valor: unknown; onChange: (v: unknown) => void }) {
  if (clave === 'stock.existencias.locations') {
    const kind = obj(valor).kind;
    return <Campo label="Segmento de la ubicación" value={str(kind)} onChange={(kind) => onChange({ kind })} />;
  }
  if (clave === 'stock.patio') {
    const rec = obj(valor);
    return (
      <div className="space-y-3">
        <Campo label="Ubicación" value={str(rec.location)} onChange={(location) => onChange({ ...rec, location })} />
        <Lista label="Bodegas que muestran patio" items={strList(rec.bodegas)} placeholder="San Jose VN"
          onChange={(bodegas) => onChange({ ...rec, bodegas })} />
      </div>
    );
  }
  if (clave === 'transit.rules') {
    const rec = obj(valor);
    return (
      <div className="space-y-3">
        <Lista label="Estados de la orden" items={strList(rec.states)} placeholder="purchase"
          onChange={(states) => onChange({ ...rec, states, date_cutoff: 'today_utc' })} />
        <p className="text-xs text-gray-500">Corte de fecha: hoy (UTC) en adelante. Otro corte no se aplica.</p>
      </div>
    );
  }
  if (clave === 'transit.prefix_map') {
    const rows = Object.entries(obj(valor)).map(([prefix, code]) => ({ prefix, code: str(code) }));
    return <Prefijos rows={rows} onChange={(next) => onChange(Object.fromEntries(next.map((r) => [r.prefix, r.code])))} />;
  }
  if (clave === 'pendiente.rules') {
    const rec = obj(valor);
    return (
      <div className="space-y-3">
        <Lista label="Códigos de albarán" items={strList(rec.sequence_codes)} placeholder="OUT"
          onChange={(sequence_codes) => onChange({ ...rec, sequence_codes, origin: 'warehouse_lot_stock' })} />
        <Lista label="Estados que no entran" items={strList(rec.excluded_states)} placeholder="cancel"
          onChange={(excluded_states) => onChange({ ...rec, excluded_states, origin: 'warehouse_lot_stock' })} />
        <p className="text-xs text-gray-500">Origen: el movimiento sale de las existencias de la bodega.</p>
      </div>
    );
  }
  if (clave === 'doh.bands') {
    return (
      <Numeros valor={valor} onChange={onChange} campos={[
        { key: 'critico', label: 'Crítico por debajo de' },
        { key: 'bajo', label: 'Bajo por debajo de' },
        { key: 'normal', label: 'Normal hasta' },
      ]} />
    );
  }
  if (clave === 'engine.factors') {
    return (
      <Numeros valor={valor} onChange={onChange} campos={[
        { key: 'general_growth', label: 'Crecimiento de General', step: '0.01' },
        { key: 't_divisor', label: 'Divisor de la proyección T' },
        { key: 'weekdays', label: 'Días hábiles del DOH' },
        { key: 'win_general', label: 'Ventana de General' },
        { key: 'win_other', label: 'Ventana de las demás bodegas' },
      ]} />
    );
  }
  if (clave === 'abc.cutoffs') {
    return (
      <Numeros valor={valor} onChange={onChange} campos={[
        { key: 'min_qty_for_class', label: 'Mínimo ordenado para no ser D' },
        { key: 'a_share', label: 'Acumulado de A', step: '0.01' },
        { key: 'b_share', label: 'Acumulado de B', step: '0.01' },
      ]} />
    );
  }
  if (clave === 'trend.thresholds') {
    return (
      <Numeros valor={valor} onChange={onChange} campos={[
        { key: 'rises', label: 'Subidas seguidas', step: '1' },
        { key: 'divergence', label: 'Divergencia |p3 − p6| / p6', step: '0.01' },
        { key: 'mtd_color_high', label: 'Mes en curso, ritmo alto', step: '0.01' },
        { key: 'mtd_color_low', label: 'Mes en curso, ritmo bajo', step: '0.01' },
      ]} />
    );
  }
  if (clave === 'cobertura.defaults') {
    return (
      <Numeros valor={valor} onChange={onChange} campos={[
        { key: 'default_dias', label: 'Días si la bodega no tiene cifra', step: '1' },
        { key: 'min_dias', label: 'Mínimo que se puede guardar', step: '1' },
        { key: 'max_dias', label: 'Máximo que se puede guardar', step: '1' },
      ]} />
    );
  }
  return <Lista label="Códigos de almacén" items={strList(valor)} placeholder="5DEP" onChange={onChange} />;
}

function Numeros({
  campos, valor, onChange,
}: {
  campos: { key: string; label: string; step?: string }[];
  valor: unknown;
  onChange: (v: unknown) => void;
}) {
  const rec = obj(valor);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {campos.map((c) => {
        const actual = rec[c.key];
        const visible = typeof actual === 'number' && Number.isFinite(actual) ? String(actual) : '';
        return (
          <label key={c.key} className="block text-xs text-gray-600">
            {c.label}
            <input
              type="number"
              step={c.step ?? 'any'}
              className={`${INPUT} mt-1`}
              value={visible}
              onChange={(e) => {
                const raw = e.target.value;
                const n = raw.trim() === '' ? Number.NaN : Number(raw);
                onChange({ ...rec, [c.key]: n });
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

function Campo({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-gray-600">
      {label}
      <input className={`${INPUT} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Lista({ label, items, placeholder, onChange }: {
  label: string; items: string[]; placeholder: string; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <p className="text-xs text-gray-600">{label}</p>
      <div className="mt-1 space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input className={INPUT} value={item} placeholder={placeholder}
              onChange={(e) => onChange(items.map((v, j) => j === i ? e.target.value : v))} />
            <button type="button" className="text-xs text-gray-500" onClick={() => onChange(items.filter((_, j) => j !== i))}>Quitar</button>
          </div>
        ))}
        <button type="button" className="text-xs font-medium text-teal-800" onClick={() => onChange([...items, ''])}>Agregar</button>
      </div>
    </div>
  );
}

function Prefijos({ rows, onChange }: {
  rows: { prefix: string; code: string }[];
  onChange: (rows: { prefix: string; code: string }[]) => void;
}) {
  return (
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
          <input className={INPUT} value={row.prefix} placeholder="PO-P-"
            onChange={(e) => onChange(rows.map((r, j) => j === i ? { ...r, prefix: e.target.value } : r))} />
          <input className={INPUT} value={row.code} placeholder="1CET"
            onChange={(e) => onChange(rows.map((r, j) => j === i ? { ...r, code: e.target.value } : r))} />
          <button type="button" className="text-xs text-gray-500" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Quitar</button>
        </div>
      ))}
      <button type="button" className="text-xs font-medium text-teal-800"
        onClick={() => onChange([...rows, { prefix: '', code: '' }])}>Agregar prefijo</button>
    </div>
  );
}

function TablaPreview({ data }: { data: ExplicacionSku }) {
  return (
    <div className="mt-4 overflow-auto">
      <p className="mb-2 text-xs text-gray-500">{data.producto || data.sku}. Lectura en vivo, no la cifra de la grilla.</p>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="py-1 pr-3">Bodega</th>
            <th className="py-1 pr-3">Exist. neta</th>
            <th className="py-1 pr-3">Patio</th>
            <th className="py-1 pr-3">Tránsito</th>
            <th className="py-1">Pend. reserva</th>
          </tr>
        </thead>
        <tbody>
          {data.bodegas.map((b) => (
            <tr key={b.bodega} className="border-t border-gray-100">
              <td className="py-1.5 pr-3">{ETIQUETA[b.bodega] ?? b.bodega}</td>
              <td className="py-1.5 pr-3"><Par a={b.actual.existNeta} b={b.propuesto?.existNeta} /></td>
              <td className="py-1.5 pr-3"><Par a={b.actual.patio} b={b.propuesto?.patio} /></td>
              <td className="py-1.5 pr-3"><Par a={b.actual.transito} b={b.propuesto?.transito} /></td>
              <td className="py-1.5"><Par a={b.actual.pendiente} b={b.propuesto?.pendiente} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-400">Guardada → borrador. Si son iguales, el borrador no mueve el número.</p>
    </div>
  );
}

function Par({ a, b }: { a: number; b?: number }) {
  const izq = fmt(a);
  if (b === undefined) return <>{izq}</>;
  const der = fmt(b);
  const igual = izq === der;
  return <span className={igual ? '' : 'font-semibold text-amber-800'}>{izq} → {der}</span>;
}

function fmt(n: number) {
  return Number.isFinite(n) ? n.toLocaleString('es-GT', { maximumFractionDigits: 1 }) : '—';
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : '')) : [];
}

function safeParse(texto: string): unknown {
  try { return JSON.parse(texto); } catch { return undefined; }
}
