'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MOTIVOS, esBase, etiquetaMes, type Motivo } from '@/lib/comercial/forecast';
import type { BloqueoResumen } from './types';
import { ExportarForecast } from './ExportarForecast';
import type { FilaForecastExport } from '@/lib/comercial/forecastExport';
import {
  ETIQUETA_TEXTO, FALTA_CRITICA, DIVERGENCIA_ANIO_ANTERIOR, TOP_N, type Etiqueta, type Recomendacion,
} from '@/lib/comercial/recomendacion';

/**
 * La tabla del jefe de canal (nivel 2): por código, lo que su canal pidió y
 * recibió, quién lo compra, cómo fue el mismo mes el año pasado, y la
 * recomendación ya calculada — para que aprobar sea lo normal y editar la
 * excepción.
 *
 * TODOS los números vienen de /api/comercial/historial ya calculados
 * (lib/comercial/recomendacion.ts). Este componente no suma, no promedia,
 * no redondea: sólo muestra y escribe. Si un número está mal, está mal en
 * la regla, no acá.
 *
 * Spec: docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md §4
 * Plan: docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md §0, Phase 3
 */

export interface FilaHistorial {
  productId: number;
  sku: string;
  nombre: string;
  uom: string | null;
  etiqueta: Etiqueta | null;
  serie: { mes: string; pedido: number }[];
  meses3: { mes: string; pedido: number; entregado: number; falta: number; critica: boolean }[];
  anteriores: { mes: string; pedido: number; entregado: number; diverge: boolean }[];
  clientes: { n: number; principal: string | null; share: number | null };
  recomendacion: Recomendacion | null;
  ventaPublico: number | null;
  capturado: { quantity: number; motivo: Motivo } | null;
  proveedor: { id: number | null; nombre: string; grupoId: string | null; grupoNombre: string | null };
  categoria: string;
  compras: { compra: number; proyeccion: number; bodega: string; coberturaDias: number } | null;
  cicloAnterior: { mes: string; capturado: number | null; pedidoReal: number; entregadoReal: number } | null;
}

export interface Historial {
  area: { slug: string; nombre: string; aplicaEstacional: boolean };
  mes: string;
  historialDisponible: boolean;
  asOf: string | null;
  bodega: string;
  total: number;
  totalCanal?: number;
  busqueda?: string | null;
  filtros?: {
    proveedor: string | null; categoria: string | null; modificados?: boolean;
    proveedores: { valor: string; etiqueta: string; grupo: boolean }[];
    categorias: string[];
  };
  filas: FilaHistorial[];
}

const n = (v: number) => Math.round(v).toLocaleString('es-GT');
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const nombreBodega = (b: string) => (b === 'San Jose VN' ? 'San José' : b);
const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const mesCorto = (label: string) => MES_CORTO[Number(label.slice(5, 7)) - 1];
const mesCortoAnio = (label: string) => `${mesCorto(label)} ${label.slice(0, 4)}`;

const CHIP: Record<Etiqueta, string> = {
  estable: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  medio: 'bg-gray-100 text-gray-700 border-gray-200',
  variable: 'bg-amber-50 text-amber-800 border-amber-200',
  erratico: 'bg-red-50 text-red-800 border-red-200',
};

/** Six bars, no library: the shape is the information (spec §2.2). */
function Sparkline({ serie }: { serie: { mes: string; pedido: number }[] }) {
  const max = Math.max(1, ...serie.map((s) => s.pedido));
  const w = 6, gap = 2, h = 18;
  return (
    <svg width={serie.length * (w + gap)} height={h} aria-label="Pedido de los últimos 6 meses" className="block">
      {serie.map((s, i) => {
        const bh = Math.max(1, Math.round((s.pedido / max) * h));
        return (
          <rect key={s.mes} x={i * (w + gap)} y={h - bh} width={w} height={bh}
                className="fill-gray-400"><title>{`${mesCortoAnio(s.mes)}: ${n(s.pedido)}`}</title></rect>
        );
      })}
    </svg>
  );
}

/** What the leader sees for one client set. Name + share only at ≥ 50 % (Q-C). */
function Clientes({ c }: { c: FilaHistorial['clientes'] }) {
  if (c.n === 0) return <span className="text-gray-300">sin pedidos</span>;
  if (c.principal && c.share !== null && c.share >= 0.5) {
    return (
      <span title={`Un solo cliente concentra el ${Math.round(c.share * 100)} % de lo pedido en 3 meses (${c.n} clientes en total). Si ese cliente cambia, este número cambia.`}>
        <span className="text-gray-800">{c.principal}</span>
        <span className="whitespace-nowrap">
          <span className="text-amber-800 font-medium"> · {Math.round(c.share * 100)} %</span>
          <span className="text-gray-400"> de {c.n}</span>
        </span>
      </span>
    );
  }
  return (
    <span title={`${c.n} clientes distintos en los últimos 3 meses; el mayor pesa ${Math.round((c.share ?? 0) * 100)} %`}>
      {c.n} clientes <span className="text-gray-400">(mayor {Math.round((c.share ?? 0) * 100)} %)</span>
    </span>
  );
}

/** Short on purpose: the channel is already in the page header (Jorge 2026-09-11). */
function fraseFactor(r: Recomendacion, mes: string): string | null {
  if (r.indiceMes === null) return null;
  const f = r.indiceMes.toFixed(2);
  return r.aplicado
    ? `${mesCorto(mes)} = ${f}× mes normal`
    : `${mesCorto(mes)} suele ser ${f}× mes normal (no se aplica)`;
}

interface Props {
  area: string;
  mes: string;
  /** Read-only for the roles that look but do not capture. */
  soloLectura: boolean;
  /** Called after any write so the shell can refresh its own counts. */
  onCambio?: () => void;
  /** Active «Bloquear cambios» lock for this area and month, if any. */
  bloqueo?: BloqueoResumen | null;
  /** sales_manager / admin / superuser may lift the lock. */
  puedeDesbloquear?: boolean;
}

const fechaHoraCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });

export function TablaRecomendacion({ area, mes, soloLectura, onCambio, bloqueo = null, puedeDesbloquear = false }: Props) {
  const [h, setH] = useState<Historial | null>(null);
  const [error, setError] = useState<string | null>(null);
  // productId -> what the input shows. Absent = the pre-filled value.
  const [edits, setEdits] = useState<Record<number, string>>({});
  // productId -> quantity saved in THIS session (✓), or 0 for cleared.
  const [guardado, setGuardado] = useState<Record<number, number>>({});
  const [motivoGuardado, setMotivoGuardado] = useState<Record<number, Motivo>>({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ultimaEdicion, setUltimaEdicion] = useState<Date | null>(null);
  const [verComoSeCalcula, setVerComoSeCalcula] = useState(false);
  // «Bloquear cambios» (PM 2026-09-11): a confirm step, then POST. Once
  // locked, the cells are read-only and only a manager can lift it.
  const [confirmarBloqueo, setConfirmarBloqueo] = useState(false);
  const [confirmarDesbloqueo, setConfirmarDesbloqueo] = useState(false);
  const [bloqueando, setBloqueando] = useState(false);
  const bloqueado = bloqueo !== null;
  const aprobado = !!bloqueo?.aprobadoAt;
  const editable = !soloLectura && !bloqueado;
  const [confirmarAprobacion, setConfirmarAprobacion] = useState(false);
  // The three month columns are the widest part of the row and the
  // sparkline already carries the shape; collapsed by default (Jorge
  // 2026-09-10), one click opens them. Collapsed, the cell keeps the one
  // number the ranking is built on: units short over the three months.
  const [verMeses, setVerMeses] = useState(false);
  // Search by code or name. Typed text filters the loaded rows at once;
  // after a pause it also asks the server for matches beyond the ranked 50
  // (the whole history of the channel). A product the channel never ordered
  // is not in that history: the add form below is for it.
  const [busqueda, setBusqueda] = useState('');
  const [busquedaServidor, setBusquedaServidor] = useState('');
  // Variability filter: which rows to trust, at a glance.
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<Etiqueta | ''>('');
  // Supplier (or Wilmer's supplier group) and Odoo category — server-side,
  // over the channel's whole history, like the search (Jorge 2026-09-11).
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  // «Modificados»: only rows whose saved number is the leader's own (server-side).
  const [soloModificados, setSoloModificados] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const extra = [
        busquedaServidor ? `&q=${encodeURIComponent(busquedaServidor)}` : '',
        filtroProveedor ? `&proveedor=${encodeURIComponent(filtroProveedor)}` : '',
        filtroCategoria ? `&categoria=${encodeURIComponent(filtroCategoria)}` : '',
        soloModificados ? '&modificados=1' : '',
      ].join('');
      const r = await fetch(`/api/comercial/historial?area=${encodeURIComponent(area)}&mes=${encodeURIComponent(mes)}${extra}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar el historial');
      setH(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial');
    }
  }, [area, mes, busquedaServidor, filtroProveedor, filtroCategoria, soloModificados]);

  // A new area or month is a new table: forget edits and ✓s. A search is not.
  useEffect(() => {
    setH(null); setEdits({}); setGuardado({}); setMotivoGuardado({}); setBusqueda(''); setBusquedaServidor('');
    setFiltroProveedor(''); setFiltroCategoria(''); setSoloModificados(false);
  }, [area, mes]);
  useEffect(() => { cargar(); }, [cargar]);
  // Search with a brake: the server is asked after the typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaServidor(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  /**
   * What the «Voy a pedir» box holds: ONLY the leader's number — being
   * edited, saved this session, or saved before. Empty means the leader has
   * not taken a position; the app's suggestion is shown as a grey
   * placeholder, never as a value (Jorge 2026-09-11: a full column of
   * pre-filled numbers read as a full request while nothing was saved).
   */
  const valorDe = useCallback((f: FilaHistorial): string => {
    if (f.productId in edits) return edits[f.productId];
    if (f.productId in guardado) return guardado[f.productId] ? String(guardado[f.productId]) : '';
    if (f.capturado) return String(f.capturado.quantity);
    return '';
  }, [edits, guardado]);
  const sugerenciaDe = (f: FilaHistorial): string => (f.recomendacion ? String(f.recomendacion.valor) : '');

  /**
   * The reason a saved row carries. A code added by hand keeps its own
   * reason. Otherwise: the app's number as-is is `base`; any other number is
   * `ajustado` — recorded now, so «Modificados» does not depend on where the
   * recommendation drifts to after the next sync.
   */
  const motivoDe = (f: FilaHistorial, q: number): Motivo => {
    if (f.capturado && !esBase(f.capturado.motivo)) return f.capturado.motivo;
    if (f.recomendacion === null) return 'ajustado';
    return q === f.recomendacion.valor ? 'base' : 'ajustado';
  };

  async function enviar(filas: { productId: number; quantity: number; motivo: Motivo }[]) {
    const r = await fetch('/api/comercial/forecast', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: mes, filas }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'No se pudo guardar');
    return j as { guardadas: number; quitadas: number };
  }

  async function guardarFila(f: FilaHistorial) {
    const texto = valorDe(f).trim();
    const q = texto === '' ? 0 : Number(texto);
    if (!Number.isFinite(q) || q < 0) { setAviso(`${f.sku}: la cantidad no es válida`); return; }
    // Only an EDITED cell writes on blur. Tabbing through the column must
    // not approve rows one by one; that is what «Aprobar todo» is for.
    if (!(f.productId in edits)) return;
    setGuardando(true); setAviso(null);
    try {
      await enviar([{ productId: f.productId, quantity: q, motivo: motivoDe(f, q) }]);
      setGuardado((g) => ({ ...g, [f.productId]: q }));
      setMotivoGuardado((m) => ({ ...m, [f.productId]: motivoDe(f, q) }));
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => Number(k) !== f.productId)));
      setUltimaEdicion(new Date());
      onCambio?.();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  /** Adopt the app's suggestion wherever the box is empty; keep the leader's own number where it is not. */
  async function tomarSugerencias() {
    if (!h) return;
    const filas = visibles
      .map((f) => ({ f, texto: (valorDe(f).trim() || sugerenciaDe(f)) }))
      .filter(({ texto }) => texto !== '' && Number.isFinite(Number(texto)) && Number(texto) > 0)
      .map(({ f, texto }) => ({ productId: f.productId, quantity: Number(texto), motivo: motivoDe(f, Number(texto)) }));
    if (filas.length === 0) { setAviso('No hay sugerencias que tomar'); return; }
    setGuardando(true); setAviso(null);
    try {
      const r = await enviar(filas);
      setGuardado((g) => {
        const nuevo = { ...g };
        for (const x of filas) nuevo[x.productId] = x.quantity;
        return nuevo;
      });
      setMotivoGuardado((m) => {
        const nuevo = { ...m };
        for (const x of filas) nuevo[x.productId] = x.motivo;
        return nuevo;
      });
      setEdits({});
      setUltimaEdicion(new Date());
      setAviso(`${r.guardadas} códigos en «Voy a pedir» para ${etiquetaMes(mes)}. Se envían con «Bloquear cambios».`);
      onCambio?.();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function bloquear() {
    setBloqueando(true); setAviso(null);
    try {
      const r = await fetch('/api/comercial/bloqueo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: mes, area }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo bloquear');
      setConfirmarBloqueo(false);
      setAviso(`Cambios bloqueados: ${j.bloqueo.total_filas} códigos de ${etiquetaMes(mes)} quedaron registrados. Falta «Aprobar pedido» para que lleguen a Compras.`);
      onCambio?.();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo bloquear');
    } finally {
      setBloqueando(false);
    }
  }

  /** «Aprobar pedido»: send the frozen record to Compras. Requires the lock; no partial approval. */
  async function aprobarPedido() {
    setBloqueando(true); setAviso(null);
    try {
      const r = await fetch('/api/comercial/bloqueo', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: mes, area }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo aprobar');
      setConfirmarAprobacion(false);
      setAviso(`Pedido aprobado: ${etiquetaMes(mes)} ya está en la pantalla de Compras.`);
      onCambio?.();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo aprobar');
    } finally {
      setBloqueando(false);
    }
  }

  async function desbloquear() {
    setBloqueando(true); setAviso(null);
    try {
      const r = await fetch(`/api/comercial/bloqueo?area=${encodeURIComponent(area)}&month=${encodeURIComponent(mes)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo desbloquear');
      setConfirmarDesbloqueo(false);
      setAviso('Desbloqueado. El canal puede volver a editar; el registro anterior se conserva.');
      onCambio?.();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo desbloquear');
    } finally {
      setBloqueando(false);
    }
  }

  /** What the table shows: the loaded rows, narrowed by the typed text at once and by the label. */
  const visibles = useMemo(() => {
    if (!h) return [];
    const q = normalizar(busqueda);
    return h.filas.filter((f) =>
      (!q || normalizar(f.sku).includes(q) || normalizar(f.nombre).includes(q))
      && (!filtroEtiqueta || f.etiqueta === filtroEtiqueta));
  }, [h, busqueda, filtroEtiqueta]);

  const cargadas = useMemo(() => visibles.filter((f) =>
    f.productId in guardado ? guardado[f.productId] > 0 : !!f.capturado).length, [visibles, guardado]);

  /** The row as the export wants it: what the cell shows, and what is saved. */
  const paraExportar = useCallback((f: FilaHistorial, fueraDePantalla: boolean): FilaForecastExport => {
    const texto = fueraDePantalla ? (f.capturado ? String(f.capturado.quantity) : '') : valorDe(f).trim();
    const mi = texto === '' ? null : Number(texto);
    const motivo = fueraDePantalla
      ? (f.capturado?.motivo ?? null)
      : (f.productId in guardado && guardado[f.productId] === 0 ? null
         : (motivoGuardado[f.productId] ?? f.capturado?.motivo ?? null));
    return { ...f, miForecast: Number.isFinite(mi as number) ? mi : null, motivoGuardado: motivo, fueraDePantalla };
  }, [valorDe, guardado, motivoGuardado]);

  // Every saved row of the month, whatever is filtered: the export reaches
  // beyond the 50 on screen (Jorge 2026-09-11).
  const cargarGuardadas = useCallback(async (): Promise<FilaForecastExport[]> => {
    const r = await fetch(`/api/comercial/historial?area=${encodeURIComponent(area)}&mes=${encodeURIComponent(mes)}&guardados=1`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'No se pudieron leer las filas guardadas');
    return (j.filas as FilaHistorial[]).map((f) => paraExportar(f, true));
  }, [area, mes, paraExportar]);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!h) return <div className="text-sm text-gray-500">Cargando el historial del canal…</div>;
  const buscando = !!h.busqueda || !!filtroProveedor || !!filtroCategoria || soloModificados;
  const filtroTexto = [
    h.busqueda ? `«${h.busqueda}»` : '',
    filtroProveedor ? (h.filtros?.proveedores.find((p) => p.valor === filtroProveedor)?.etiqueta ?? '') : '',
    filtroCategoria || '',
    soloModificados ? 'modificados' : '',
  ].filter(Boolean).join(' · ');

  if (!h.historialDisponible) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <p className="text-sm text-gray-700">
          <strong>Sin historial en este canal.</strong> Todavía no hay pedidos de {h.area.nombre} en Odoo,
          así que no hay recomendación que mostrar. Podés cargar códigos a mano abajo.
        </p>
      </section>
    );
  }

  const mesesBase = h.filas[0]?.meses3.map((m) => m.mes) ?? [];
  const esTiendas = h.area.slug === 'tiendas';
  const fechaHora = (d: Date) => d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-sm font-medium text-gray-900">
            {buscando
              ? `${h.total} códigos de ${h.area.nombre} para ${filtroTexto} — ${etiquetaMes(mes)}`
              : `Los ${h.filas.length} códigos con más riesgo de faltante en ${h.area.nombre} — ${etiquetaMes(mes)}`}
          </h2>
          <p className="text-xs text-gray-500">
            De {h.totalCanal ?? h.total} códigos con pedidos en los últimos 6 meses. Ordenados por lo que faltó y por lo que
            queda en {nombreBodega(h.bodega)}. Cualquier otro código se agrega abajo.
            {h.asOf && <> · Historial de Odoo al {new Date(h.asOf).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}</>}
            {' · '}
            <button type="button" onClick={() => setVerComoSeCalcula((v) => !v)} className="underline hover:text-gray-800">
              ¿Cómo se calcula?
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:ml-auto">
        {bloqueado ? (
          <div className="flex flex-wrap items-center gap-3">
            {aprobado ? (
              <span className="text-sm text-emerald-800 font-medium" data-testid="aprobado"
                    title={`Bloqueado el ${fechaHoraCorta(bloqueo.at)} por ${bloqueo.autor} (versión ${bloqueo.version}); aprobado y enviado a Compras.`}>
                ✅ Pedido aprobado el {fechaHoraCorta(bloqueo.aprobadoAt!)} por {bloqueo.aprobadoAutor} · en la pantalla de Compras
              </span>
            ) : (
              <span className="text-sm text-amber-800 font-medium" data-testid="bloqueado"
                    title={`Versión ${bloqueo.version}. Lo que está en «Voy a pedir» quedó registrado con su contexto; nadie del canal puede cambiarlo. Todavía NO está en la pantalla de Compras.`}>
                🔒 Cambios bloqueados el {fechaHoraCorta(bloqueo.at)} por {bloqueo.autor} · sin aprobar
              </span>
            )}
            {!soloLectura && !aprobado && !confirmarAprobacion && (
              <button type="button" onClick={() => setConfirmarAprobacion(true)} disabled={bloqueando}
                      className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
                      title="Envía el pedido bloqueado a la pantalla de Compras. No hay aprobación parcial.">
                Aprobar pedido
              </button>
            )}
            {puedeDesbloquear && !confirmarDesbloqueo && (
              <button type="button" onClick={() => setConfirmarDesbloqueo(true)}
                      className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">
                Desbloquear
              </button>
            )}
          </div>
        ) : !soloLectura && (
          <div className="flex items-center gap-3">
            <button
              type="button" onClick={tomarSugerencias} disabled={guardando || visibles.length === 0}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              title={(visibles.length < h.filas.length ? 'Sólo las filas que se ven con el filtro actual. ' : '')
                + 'Pone la sugerencia de la app en «Voy a pedir» donde esté vacío; lo que ya escribiste no se toca.'}
            >
              {guardando ? 'Guardando…' : `Tomar las ${visibles.length} sugerencias`}
            </button>
            <span className="text-xs text-gray-500" data-testid="contador">
              Voy a pedir: {cargadas} de {visibles.length} códigos
              {ultimaEdicion && <> · última edición {fechaHora(ultimaEdicion)}</>}
            </span>
            <button
              type="button" onClick={() => setConfirmarBloqueo(true)} disabled={guardando || bloqueando || cargadas === 0}
              className="px-4 py-2 text-sm bg-amber-800 text-white rounded-md hover:bg-amber-900 disabled:opacity-50"
              title={cargadas === 0
                ? 'Todavía no hay nada en «Voy a pedir»: tomá las sugerencias o escribí tus números primero.'
                : 'Envía el pedido: lo que está en «Voy a pedir» queda registrado con fecha, autor y contexto, y ya no se puede cambiar.'}
            >
              Bloquear cambios
            </button>
            <button
              type="button" disabled
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md opacity-50 cursor-not-allowed"
              title="Primero bloqueá los cambios: se aprueba el pedido bloqueado, no uno que todavía se puede editar."
            >
              Aprobar pedido
            </button>
          </div>
        )}
        {/* Far right on purpose, away from the two buttons that change data (Jorge 2026-09-11). */}
        <div className="md:ml-8">
          <ExportarForecast
            filas={visibles.map((f) => paraExportar(f, false))}
            cargarGuardadas={cargarGuardadas}
            contexto={{
              areaSlug: h.area.slug, areaNombre: h.area.nombre, mes, bodega: nombreBodega(h.bodega),
              autor: null, asOf: h.asOf, bloqueo,
              filtros: {
                busqueda: h.busqueda ?? null,
                proveedor: filtroProveedor ? (h.filtros?.proveedores.find((p) => p.valor === filtroProveedor)?.etiqueta ?? filtroProveedor) : null,
                categoria: filtroCategoria || null,
                etiqueta: filtroEtiqueta || null,
                modificados: soloModificados,
              },
            }}
          />
        </div>
        </div>
      </div>

      {!soloLectura && !bloqueado && cargadas === 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3" data-testid="sin-pedido">
          Todavía no elegiste ningún código: lo que ves en gris es lo que la app sugiere, no un pedido.
          Tocá «Tomar las sugerencias» o escribí tus números en «Voy a pedir»; después «Bloquear cambios» y, para que llegue a Compras, «Aprobar pedido».
        </p>
      )}
      {confirmarBloqueo && !bloqueado && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-2" data-testid="confirmar-bloqueo">
          <p className="text-gray-800">
            Vas a <strong>bloquear los cambios</strong> de <strong>{etiquetaMes(mes)}</strong> de {h.area.nombre}:
            lo que está en «Voy a pedir» queda registrado con fecha, autor y lo que estás viendo en pantalla,
            y <strong>después nadie del canal puede cambiarlo</strong>. Sólo la gerencia de ventas puede desbloquearlo.
            Todavía no llega a Compras: eso lo hace «Aprobar pedido».
          </p>
          <p className="text-xs text-gray-600">
            Un código con la caja vacía no va en el pedido: la sugerencia en gris no cuenta hasta que la tomes.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={bloquear} disabled={bloqueando}
                    className="px-4 py-2 text-sm bg-amber-800 text-white rounded-md hover:bg-amber-900 disabled:opacity-50">
              {bloqueando ? 'Bloqueando…' : 'Sí, bloquear'}
            </button>
            <button type="button" onClick={() => setConfirmarBloqueo(false)} disabled={bloqueando}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {confirmarAprobacion && bloqueado && !aprobado && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-2" data-testid="confirmar-aprobacion">
          <p className="text-gray-800">
            Vas a <strong>aprobar el pedido</strong> de <strong>{etiquetaMes(mes)}</strong> de {h.area.nombre}: los códigos
            bloqueados pasan a la pantalla de Compras tal como están. <strong>No hay aprobación parcial</strong>: se aprueba
            todo el pedido o nada.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={aprobarPedido} disabled={bloqueando}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
              {bloqueando ? 'Aprobando…' : 'Sí, aprobar el pedido'}
            </button>
            <button type="button" onClick={() => setConfirmarAprobacion(false)} disabled={bloqueando}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {confirmarDesbloqueo && bloqueado && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-2" data-testid="confirmar-desbloqueo">
          <p className="text-gray-800">
            Vas a <strong>desbloquear</strong> {etiquetaMes(mes)} de {h.area.nombre}. El registro bloqueado se conserva
            tal cual (versión {bloqueo.version}); el canal podrá editar y, si vuelve a bloquear, será una versión nueva.
            {aprobado && <> <strong>La aprobación se retira</strong>: el pedido deja de verse en Compras hasta que se vuelva a aprobar.</>}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={desbloquear} disabled={bloqueando}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
              {bloqueando ? 'Desbloqueando…' : 'Sí, desbloquear'}
            </button>
            <button type="button" onClick={() => setConfirmarDesbloqueo(false)} disabled={bloqueando}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código o nombre en todo tu canal"
          aria-label="Buscar por código o nombre"
          className="w-72 max-w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md"
        />
        <select
          value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)}
          aria-label="Filtrar por proveedor"
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white max-w-[16rem]"
        >
          <option value="">Todos los proveedores</option>
          {h.filtros?.proveedores.some((p) => p.grupo) && (
            <optgroup label="Grupos de proveedores">
              {h.filtros.proveedores.filter((p) => p.grupo).map((p) => (
                <option key={p.valor} value={p.valor}>{p.etiqueta}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Proveedores">
            {h.filtros?.proveedores.filter((p) => !p.grupo).map((p) => (
              <option key={p.valor} value={p.valor}>{p.etiqueta}</option>
            ))}
          </optgroup>
        </select>
        <select
          value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}
          aria-label="Filtrar por categoría"
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white max-w-[14rem]"
        >
          <option value="">Todas las categorías</option>
          {h.filtros?.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por variabilidad">
          {([['', 'Todas'], ...(Object.keys(ETIQUETA_TEXTO) as Etiqueta[]).map((e) => [e, ETIQUETA_TEXTO[e]])] as [Etiqueta | '', string][])
            .map(([valor, texto]) => (
              <button
                key={valor || 'todas'} type="button" onClick={() => setFiltroEtiqueta(valor)}
                aria-pressed={filtroEtiqueta === valor}
                className={`px-2.5 py-1 text-xs rounded-full border ${
                  filtroEtiqueta === valor
                    ? 'bg-gray-900 text-white border-gray-900'
                    : valor ? `${CHIP[valor]} hover:opacity-80` : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
              >
                {texto}
              </button>
            ))}
        </div>
        {!soloLectura && (
          <button
            type="button" onClick={() => setSoloModificados((v) => !v)} aria-pressed={soloModificados}
            title="Sólo los códigos donde vas a pedir algo distinto de lo sugerido, o que agregaste a mano."
            className={`px-2.5 py-1 text-xs rounded-full border ${
              soloModificados ? 'bg-amber-800 text-white border-amber-800' : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'}`}
          >
            Modificados
          </button>
        )}
        {visibles.length === 0 && (
          <span className="text-xs text-gray-500" data-testid="sin-resultados">
            {soloModificados && !h.busqueda && !filtroProveedor && !filtroCategoria
              ? 'Todavía no modificaste ningún número: todo lo cargado es la recomendación tal cual.'
              : buscando
                ? 'Ningún código de tu canal coincide. Si es un producto que tu canal nunca pidió, agregalo abajo.'
                : 'Ninguna fila con ese filtro.'}
          </span>
        )}
      </div>

      {verComoSeCalcula && <ComoSeCalcula area={h.area} />}
      {aviso && <p className="text-xs text-emerald-700">{aviso}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 align-bottom">
              <th className="py-2 pr-3 font-medium sticky left-0 bg-white">Código</th>
              <th className="py-2 pr-3 font-medium" title="Pedido de tu canal, últimos 6 meses">6 meses</th>
              {verMeses ? mesesBase.map((m, i) => (
                <th key={m} className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                    title="Pedido por tu canal / entregado por el almacén. Lo que falta no se vuelve a pedir al mes siguiente; Odoo no registra el motivo.">
                  {i === 0 && (
                    <button type="button" onClick={() => setVerMeses(false)}
                            className="mr-2 text-gray-400 hover:text-gray-700" title="Ocultar los meses"
                            aria-label="Ocultar los meses">◂</button>
                  )}
                  {mesCorto(m)}<span className="block font-normal text-gray-400">pedido / entregado</span>
                </th>
              )) : (
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                    title="Lo que faltó entregar de lo pedido en los últimos 3 meses. Abrí para ver cada mes: pedido / entregado.">
                  <button type="button" onClick={() => setVerMeses(true)}
                          className="text-gray-700 hover:text-gray-900" aria-label="Ver los meses">
                    {mesesBase.length ? `${mesCorto(mesesBase[0])}–${mesCorto(mesesBase[mesesBase.length - 1])}` : 'Meses'} ▸
                  </button>
                  <span className="block font-normal text-gray-400">faltó entregar</span>
                </th>
              )}
              <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                  title={`Mismo mes en años anteriores, en tu canal. Ámbar cuando se aleja más de ${Math.round(DIVERGENCIA_ANIO_ANTERIOR * 100)} % de la recomendación.`}>
                {mesCorto(mes)} años anteriores
              </th>
              <th className="py-2 pr-3 font-medium" title="Quién lo compra en tu canal (últimos 3 meses)">Clientes</th>
              <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                  title={`Lo que Compras tiene planificado comprar para ${nombreBodega(h.bodega)} ANTES de recibir los formularios de los canales, y la venta que proyecta para ese CD (todos los canales que surte). Si tu forecast cabe en lo proyectado, ya está cubierto; si no, el faltante es real.`}>
                Forecast Compras
                <span className="block font-normal text-gray-400">compra · proyección {nombreBodega(h.bodega)}</span>
              </th>
              <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                  title="Promedio de los promedios de 3 y 6 meses de lo PEDIDO por tu canal; por el factor del mes donde aplica. «Normalmente» es el rango donde cayó la realidad para códigos así de parejos.">
                Recomendación
              </th>
              {!soloLectura && (
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap"
                    title={aprobado ? 'Lo que Compras ve; ya no se cambia.' : bloqueado ? 'Bloqueado, todavía no aprobado: Compras no lo ve.' : 'Tu número. Vacío = todavía no elegiste; en gris, lo que sugiere la app.'}>
                  {aprobado ? 'Pedido aprobado' : bloqueado ? 'Pedido bloqueado' : 'Voy a pedir'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const r = f.recomendacion;
              const valor = valorDe(f);
              return (
                <tr key={f.productId} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 sticky left-0 bg-white max-w-[16rem]">
                    <div>
                      <span className="font-mono text-xs text-gray-500">{f.sku}</span>{' '}
                      {f.etiqueta && (
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border align-middle ${CHIP[f.etiqueta]}`}
                              title="Qué tan parejo vendió este código en tu canal los últimos 6 meses: estable, medio, variable o errático. Cuanto más errático, menos vale la recomendación y más vale lo que vos sabés.">
                          {ETIQUETA_TEXTO[f.etiqueta]}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-800 truncate" title={f.nombre}>{f.nombre}</div>
                    <div className="text-xs text-gray-400 truncate" title={`${f.proveedor.nombre}${f.proveedor.grupoNombre ? ` (${f.proveedor.grupoNombre})` : ''} · ${f.categoria}`}>
                      {f.proveedor.nombre || '—'} · {f.categoria}
                    </div>
                    {f.cicloAnterior && f.cicloAnterior.capturado !== null && (
                      <div className="text-xs text-gray-500" data-testid="ciclo-anterior">
                        Tu forecast de {mesCorto(f.cicloAnterior.mes)}: {n(f.cicloAnterior.capturado)} · real {n(f.cicloAnterior.pedidoReal)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3"><Sparkline serie={f.serie} /></td>
                  {!verMeses && (() => {
                    const falta3 = f.meses3.reduce((a, m) => a + m.falta, 0);
                    const critica = f.meses3.some((m) => m.critica);
                    return (
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap" data-testid="falta-3m"
                          title={f.meses3.map((m) => `${mesCorto(m.mes)}: ${n(m.pedido)} / ${n(m.entregado)}${m.critica ? ' !' : ''}`).join(' · ')}>
                        {falta3 > 0
                          ? <span className={critica ? 'text-red-700 font-medium' : 'text-gray-500'}>falta {n(falta3)}{critica ? ' !' : ''}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    );
                  })()}
                  {verMeses && f.meses3.map((m) => (
                    <td key={m.mes} className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      <span className="text-gray-800">{n(m.pedido)}</span>
                      <span className="text-gray-400"> / </span>
                      <span className="text-gray-600">{n(m.entregado)}</span>
                      {m.falta > 0 && (
                        <span className={`block text-xs ${m.critica ? 'text-red-700 font-medium' : 'text-gray-400'}`}
                              data-testid={m.critica ? 'falta-critica' : 'falta'}
                              title={m.critica
                                ? `Faltó el ${Math.round((m.falta / m.pedido) * 100)} % de lo pedido (${n(m.falta)} unidades): ≥ ${FALTA_CRITICA.pctMin * 100} % y ≥ ${FALTA_CRITICA.unidadesMin} unidades es crítico`
                                : `Faltaron ${n(m.falta)} unidades`}>
                          falta {n(m.falta)}{m.critica ? ' !' : ''}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                    {f.anteriores.length === 0
                      ? <span className="text-gray-300">—</span>
                      : f.anteriores.map((a) => (
                        <span key={a.mes} className={`block ${a.diverge ? 'text-amber-800 font-medium' : 'text-gray-600'}`}
                              data-testid={a.diverge ? 'anterior-diverge' : 'anterior'}
                              title={`${mesCortoAnio(a.mes)}: pedido ${n(a.pedido)}, entregado ${n(a.entregado)}`}>
                          {a.mes.slice(0, 4)}: {n(a.pedido)}
                        </span>
                      ))}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600 max-w-[14rem]">
                    <Clientes c={f.clientes} />
                    {esTiendas && f.ventaPublico !== null && (
                      <span className="block text-gray-400" title="Venta al público en las tiendas (facturado, promedio mensual de 3 meses). Es contexto: el forecast es lo que las tiendas piden al CD.">
                        venta al público {n(f.ventaPublico)}/mes
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap" data-testid="forecast-compras">
                    {f.compras ? (
                      <>
                        <span className="text-gray-800" title="Lo que Compras planifica comprar, sin lo que cargaron los canales">
                          {n(f.compras.compra)}
                        </span>
                        <span className="block text-xs text-gray-400"
                              title={`Venta proyectada por Compras para ${nombreBodega(f.compras.bodega)} en ${f.compras.coberturaDias} días, todos los canales`}>
                          proyecta {n(f.compras.proyeccion)}
                        </span>
                      </>
                    ) : <span className="text-gray-300" title="Compras no tiene fila para este código en la bodega que te surte">—</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                    {r ? (
                      <>
                        <span className="font-medium text-gray-900">{n(r.valor)}</span>
                        <span className="block text-xs text-gray-500" title={`Promedio 3 meses ${n(r.avg3)} · promedio 6 meses ${n(r.avg6)} · base ${n(r.base)}${r.aplicado ? ` · × ${r.factor.toFixed(2)}` : ''}`}>
                          normalmente {n(r.rango[0])}–{n(r.rango[1])}
                        </span>
                        {fraseFactor(r, mes) && (
                          <span className="block text-xs text-gray-400" data-testid="factor"
                                title={r.aplicado ? `Factor del mes para tu categoría en ${h.area.nombre}, de cuatro años de historia` : `Factor del mes en ${h.area.nombre}; se muestra pero no se aplica en este canal`}>
                            {fraseFactor(r, mes)}
                          </span>
                        )}
                      </>
                    ) : <span className="text-gray-300">sin historial</span>}
                  </td>
                  {!soloLectura && (
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <input
                        type="number" min={0} value={valor} disabled={!editable}
                        placeholder={sugerenciaDe(f)}
                        aria-label={`Voy a pedir ${f.sku}`}
                        onChange={(e) => setEdits((x) => ({ ...x, [f.productId]: e.target.value }))}
                        onBlur={() => guardarFila(f)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded-md tabular-nums placeholder:text-gray-300 disabled:bg-gray-50 disabled:text-gray-700"
                      />
                      {(() => {
                        // Under the box: only what helps decide — the suggestion when
                        // the leader's number differs from it, or the reason of a
                        // hand-added code. Nothing when they match, nothing when empty.
                        if (valor.trim() === '') return null;
                        const m = motivoGuardado[f.productId] ?? f.capturado?.motivo ?? null;
                        if (m && !esBase(m)) {
                          return (
                            <span className="block text-[10px] text-gray-400" data-testid="nota-pedido">
                              {MOTIVOS.find((x) => x.valor === m)?.etiqueta ?? m}
                            </span>
                          );
                        }
                        const sug = sugerenciaDe(f);
                        if (sug && sug !== valor.trim()) {
                          return (
                            <span className="block text-[10px] text-gray-400" data-testid="nota-pedido"
                                  title="Lo que sugería la app; vos vas a pedir otra cosa">
                              sugerido {n(Number(sug))}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Se muestran {TOP_N} códigos como máximo; buscá arriba para llegar a cualquier otro de tu canal. Dejá la caja vacía (o 0) para no pedir un código.
      </p>
    </section>
  );
}

/**
 * The formula and its honest accuracy, in the leader's words. Numbers from
 * the spec §3.4 (backtest 2025-10 .. 2026-08, top-80 % SKUs per channel).
 */
function ComoSeCalcula({ area }: { area: Historial['area'] }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 space-y-2">
      <p>
        <strong>Recomendación</strong> = promedio entre el promedio de los últimos 3 meses y el de los últimos 6,
        de lo que <em>pidió</em> tu canal (no de lo entregado: lo entregado ya trae los faltantes).
        {area.aplicaEstacional
          ? ' Después se multiplica por el factor del mes de tu categoría, sacado de cuatro años de historia (2022–2025): así diciembre no se calcula como un mes normal.'
          : ' En este canal el factor del mes se muestra pero no se aplica: al probarlo contra la historia empeoraba el resultado.'}
      </p>
      <p>
        <strong>Qué tan buena es.</strong> Probada contra lo que realmente se pidió cada mes entre octubre 2025 y
        agosto 2026: para los códigos que hacen el 80 % del volumen, la recomendación cae dentro de ±25 % del
        real en unos <strong>65 %</strong> de los códigos en Mayoreo y Petén, <strong>48 %</strong> en Zacapa y
        <strong> 45 %</strong> en Institucional, Tiendas y Supermercados. La etiqueta (estable · medio · variable ·
        errático) dice en cuáles confiar más: un código <em>estable</em> acierta 61 % de las veces; uno <em>errático</em>, 19 %.
      </p>
      <p>
        <strong>Lo que la app no sabe y vos sí:</strong> un cliente que entra o se va, una promoción, una
        licitación. Por eso está la columna de clientes y por eso el número se puede corregir.
      </p>
    </div>
  );
}
