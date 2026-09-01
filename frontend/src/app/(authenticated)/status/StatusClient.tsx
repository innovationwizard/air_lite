'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  titular, brechaConfirmacion, esperandoQue, ordenarPlan, prontitud,
  enAlcance, ETIQUETA_BLOQUEO, ETIQUETA_AREA, AREAS_PRONTITUD,
  type StatusItem, type PlanRow, type Alcance, type Estado, type Luz,
} from '@/lib/status/metricas';

/**
 * La página del gap analysis.
 *
 * Estructura en tres niveles (overview → filtrar → detalle):
 *   1. el titular, conmutable entre avance y prontitud;
 *   2. la composición: por categoría, qué se está esperando, y la brecha de
 *      confirmación;
 *   3. las filas, con filtros.
 *
 * DOS REGLAS DE PRODUCTO QUE EL CÓDIGO TIENE QUE SOSTENER, no sólo respetar:
 *
 *   · Regla de conteo 0/100. El titular cuenta SOLO lo confirmado. Lo
 *     construido-sin-confirmar va al lado, con su propia etiqueta, y toda
 *     proyección que lo incluya se rotula como escenario. El número grande
 *     nunca se mueve por una simulación.
 *   · Nada señala personas. Los bloqueos se dicen por función y el detalle es
 *     el INSUMO que falta, no quién lo debe. El único lugar con nombres es a
 *     quién hay que convocar para confirmar — ahí el nombre es una invitación,
 *     no una imputación.
 */

const ETIQUETA_ESTADO: Record<Estado, string> = {
  funcionando: 'Funcionando y confirmado',
  construido: 'Construido, sin confirmar',
  parcial: 'Parcial o en construcción',
  no_construido: 'No construido',
  fuera_alcance: 'Fuera de alcance',
  no_software: 'No es software',
  sin_determinar: 'Sin determinar',
};

const COLOR_ESTADO: Record<Estado, string> = {
  funcionando: 'bg-emerald-500',
  construido: 'bg-sky-400',
  parcial: 'bg-amber-400',
  no_construido: 'bg-gray-300',
  fuera_alcance: 'bg-gray-200',
  no_software: 'bg-gray-200',
  sin_determinar: 'bg-purple-300',
};

const PILL_ESTADO: Record<Estado, string> = {
  funcionando: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  construido: 'bg-sky-50 text-sky-800 border-sky-200',
  parcial: 'bg-amber-50 text-amber-800 border-amber-200',
  no_construido: 'bg-gray-50 text-gray-600 border-gray-200',
  fuera_alcance: 'bg-gray-50 text-gray-500 border-gray-200',
  no_software: 'bg-gray-50 text-gray-500 border-gray-200',
  sin_determinar: 'bg-purple-50 text-purple-800 border-purple-200',
};

/** La evidencia que exige cada estado. Va en la página, no en un anexo: un
 *  semáforo cuyo criterio no se publica tranquiliza en vez de informar. */
const EVIDENCIA_EXIGIDA: Record<string, string> = {
  funcionando: 'Construido, en producción, y confirmado por ustedes en sesión, por una medición fechada o por una prueba automatizada.',
  construido: 'Código en la rama principal y migración aplicada. Nadie del cliente lo ha validado todavía.',
  parcial: 'Ambas mitades identificadas: qué funciona y qué falta, nombrados en la fila.',
  no_construido: 'No existe el código.',
};

const LUZ_COLOR: Record<Luz, string> = {
  verde: 'bg-emerald-500',
  ambar: 'bg-amber-400',
  rojo: 'bg-red-500',
};

const ETIQUETA_ORIGEN: Record<string, string> = {
  contrato: 'Propuesta firmada',
  verbal: 'Acordado al cierre',
  prerrequisito: 'Insumo del cliente',
  anadido: 'Añadido después',
  contexto: 'Contexto',
};

const ETIQUETA_TEMPORADA: Record<string, string> = {
  critico: 'Crítico para la temporada',
  mejora: 'Mejora la temporada',
  puede_esperar: 'Puede esperar',
  na: '—',
};

const ETIQUETA_ESFUERZO: Record<string, string> = {
  horas: 'Horas', dias: 'Días', semanas: 'Semanas',
  no_estimable: 'No estimable', na: '—',
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Inicio de la temporada alta: la razón por la que la fecha era el 31-ago. */
const INICIO_TEMPORADA = new Date('2026-08-31T00:00:00');

interface Datos { items: StatusItem[]; plan: PlanRow[]; corte: string | null }

export function StatusClient({ puedeEditarPlan }: { puedeEditarPlan: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado de lectura en la URL, para que un link pegado en un chat abra
  // exactamente lo que veía quien lo mandó.
  const [vista, setVista] = useState<'avance' | 'prontitud'>('avance');
  const [alcance, setAlcance] = useState<Alcance>('contratado');
  const [fEstado, setFEstado] = useState<string>('');
  const [fTemporada, setFTemporada] = useState<string>('');
  const [fBloqueo, setFBloqueo] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('vista') === 'prontitud') setVista('prontitud');
    if (p.get('alcance') === 'todo') setAlcance('todo');
    if (p.get('estado')) setFEstado(p.get('estado')!);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (vista !== 'avance') p.set('vista', vista);
    if (alcance !== 'contratado') p.set('alcance', alcance);
    if (fEstado) p.set('estado', fEstado);
    const q = p.toString();
    window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
  }, [vista, alcance, fEstado]);

  useEffect(() => {
    fetch('/api/status')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Error');
        return r.json();
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, []);

  // Estable entre renders: `datos?.items ?? []` crea un arreglo nuevo cada vez
  // y haría recalcular todos los useMemo de abajo en cada render.
  const items = useMemo(() => datos?.items ?? [], [datos]);
  const planMap = useMemo(
    () => new Map((datos?.plan ?? []).map((p) => [p.item_id, p])),
    [datos],
  );

  const t = useMemo(() => titular(items, alcance), [items, alcance]);
  const grupos = useMemo(() => brechaConfirmacion(items, alcance), [items, alcance]);
  const esperas = useMemo(() => esperandoQue(items, alcance), [items, alcance]);
  const planItems = useMemo(
    () => ordenarPlan(items, planMap, alcance), [items, planMap, alcance],
  );

  const filtradas = useMemo(() => items.filter((i) => {
    if (!enAlcance(i, alcance)) return false;
    if (fEstado && i.estado !== fEstado) return false;
    if (fTemporada && i.temporada !== fTemporada) return false;
    if (fBloqueo && i.bloqueo !== fBloqueo) return false;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      if (!`${i.id} ${i.item} ${i.evidencia ?? ''} ${i.espera_que ?? ''}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  }), [items, alcance, fEstado, fTemporada, fBloqueo, busqueda]);

  const diasTemporada = Math.floor(
    (Date.now() - INICIO_TEMPORADA.getTime()) / 86_400_000,
  );

  if (error) {
    return <div className="p-8 text-sm text-red-700">No se pudo cargar el estado: {error}</div>;
  }
  if (!datos) {
    return <div className="p-8 text-sm text-gray-500">Cargando el estado del proyecto…</div>;
  }

  const fueraDelConteo = items.filter(
    (i) => enAlcance(i, alcance) && (i.estado === 'fuera_alcance' || i.estado === 'no_software'),
  ).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">

      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Estado del proyecto</h1>
          <p className="text-sm text-gray-500 mt-1">
            AI Refill · análisis de brechas sobre 185 peticiones registradas en 28 reuniones,
            del 16 de junio al 26 de agosto de 2026
            {datos.corte && ` · juicio al ${new Date(datos.corte).toLocaleDateString('es-GT')}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-6">
          <Conmutador
            etiqueta="Mostrar"
            valor={vista}
            opciones={[['avance', 'Avance'], ['prontitud', 'Prontitud para la temporada']]}
            onChange={(v) => setVista(v as 'avance' | 'prontitud')}
          />
          <Conmutador
            etiqueta="Alcance"
            valor={alcance}
            opciones={[['contratado', 'Solo alcance contratado'], ['todo', 'Todo lo pedido']]}
            onChange={(v) => setAlcance(v as Alcance)}
          />
        </div>

        <Franqueza />
      </header>

      {vista === 'avance' ? (
        <>
          {/* ── El titular ───────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex flex-wrap items-end gap-8">
              <div>
                <div className="text-5xl font-semibold text-gray-900 tabular-nums">
                  {pct(t.pctTerminado)}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  terminado, de {t.denominador} funciones{' '}
                  {alcance === 'contratado' ? 'del alcance contratado' : 'pedidas en total'}
                </div>
              </div>
              <p className="text-xs text-gray-500 max-w-md leading-relaxed">
                <strong className="text-gray-700">Cómo se cuenta:</strong> terminado = construido{' '}
                <em>y</em> confirmado por ustedes. Lo construido que nadie ha validado todavía
                no suma acá — se cuenta aparte, más abajo. Una función se cuenta entera o no se
                cuenta; no hay porcentajes de avance por función.
              </p>
            </div>

            <BarraApilada t={t} />

            {fueraDelConteo > 0 && (
              <p className="text-xs text-gray-500 mt-4">
                Fuera del conteo: {fueraDelConteo} filas que no son funciones a construir
                (decisiones de exclusión, contexto, cronología e insumos que ejecuta el cliente).
                Se muestran en el detalle, no en el porcentaje.
              </p>
            )}
          </section>

          {/* ── A una reunión de confirmar ───────────────────────────────── */}
          {grupos.length > 0 && (
            <section className="bg-sky-50 border border-sky-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900">
                A una reunión de confirmar
              </h2>
              <p className="text-sm text-gray-700 mt-1 max-w-3xl">
                {t.construido} funciones están construidas y corriendo en producción, y lo único
                que les falta es que alguien de ustedes las mire y las dé por buenas. No es una
                salvedad del reporte: es trabajo pendiente, con dueño y con criterio.
              </p>

              <div className="grid gap-3 sm:grid-cols-2 mt-4">
                {grupos.map((g) => (
                  <div key={g.persona} className="bg-white border border-sky-200 rounded-lg p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-medium text-gray-900">Sesión con {g.persona}</h3>
                      <span className="text-xs text-gray-500">
                        {g.items.length} {g.items.length === 1 ? 'función' : 'funciones'}
                      </span>
                    </div>
                    <p className="text-xs text-sky-800 mt-1">
                      Si se confirman en una sesión, el avance pasaría de {pct(t.pctTerminado)} a{' '}
                      <strong>{pct(g.pctSiSeConfirmaEste)}</strong>
                      <span className="text-gray-500"> — escenario, no avance actual.</span>
                    </p>
                    <ul className="mt-3 space-y-2">
                      {g.items.map((i) => (
                        <li key={i.id} className="text-xs text-gray-700">
                          <span className="font-mono text-gray-400">{i.id}</span> {i.item.slice(0, 90)}
                          {i.criterio_aceptacion && (
                            <span className="block text-gray-500 mt-0.5 pl-1 border-l-2 border-gray-200">
                              {i.criterio_aceptacion}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-600 mt-4">
                Confirmando las {t.construido}, el avance quedaría en{' '}
                <strong>{pct(t.pctSiSeConfirma)}</strong>. Ninguna función entra a esta lista sin
                un criterio de aceptación escrito: si no se puede decir qué habría que ver para
                darla por buena, no está a una reunión de distancia y aparece como
                «parcial o en construcción».
              </p>
            </section>
          )}

          {/* ── Qué se está esperando ────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900">Qué se está esperando</h2>
            <p className="text-sm text-gray-600 mt-1">
              De lo que falta, esto es lo que cada frente tiene detenido y el insumo concreto
              que lo destraba.
            </p>
            <div className="space-y-4 mt-4">
              {esperas.map((g) => {
                const insumos = [...new Set(
                  g.items.map((i) => i.espera_que).filter((x): x is string => !!x?.trim()),
                )];
                return (
                  <div key={g.bloqueo}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-800 w-52">{g.etiqueta}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-gray-700"
                          style={{ width: `${(g.items.length / esperas[0].items.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm tabular-nums text-gray-600 w-8 text-right">
                        {g.items.length}
                      </span>
                    </div>
                    {insumos.length > 0 && (
                      <ul className="mt-1.5 ml-52 pl-3 text-xs text-gray-500 space-y-0.5">
                        {insumos.slice(0, 6).map((x) => <li key={x}>· {x}</li>)}
                        {insumos.length > 6 && <li>· y {insumos.length - 6} más</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        /* ── Prontitud ──────────────────────────────────────────────────── */
        <section className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900">La temporada ya empezó</h2>
            <p className="text-sm text-gray-600 mt-1 max-w-3xl">
              Lleva {diasTemporada} {diasTemporada === 1 ? 'día' : 'días'} corriendo. La fecha del
              31 de agosto se eligió para llegar antes que ella. La siguiente fecha con
              consecuencia real es la reunión de forecast del tercer miércoles de septiembre,
              y el módulo de captura tiene que estar semanas antes para que dé tiempo de usarlo.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {AREAS_PRONTITUD.map((a) => {
              const p = prontitud(items.filter((i) => enAlcance(i, alcance)), a);
              return (
                <div key={a} className="bg-white border border-gray-200 rounded-lg p-5">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-3 h-3 rounded-full ${LUZ_COLOR[p.luz]}`} />
                    <h3 className="font-medium text-gray-900">{ETIQUETA_AREA[a]}</h3>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{p.criterio}</p>

                  {p.rodeos.length > 0 && (
                    <div className="mt-3 text-xs">
                      <span className="text-gray-500">Mientras tanto:</span>
                      <ul className="mt-1 space-y-0.5 text-gray-700">
                        {p.rodeos.map((r) => <li key={r}>· {r}</li>)}
                      </ul>
                    </div>
                  )}

                  {p.criticosAbiertos.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {p.criticosAbiertos.slice(0, 5).map((i) => (
                        <li key={i.id} className="text-xs text-gray-600">
                          <span className="font-mono text-gray-400">{i.id}</span>{' '}
                          {i.espera_que ? `espera ${i.espera_que}` : i.item.slice(0, 70)}
                        </li>
                      ))}
                      {p.criticosAbiertos.length > 5 && (
                        <li className="text-xs text-gray-400">
                          y {p.criticosAbiertos.length - 5} más
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-500">
            Criterio de los colores: <strong>verde</strong> = sin pendientes críticos.{' '}
            <strong>Ámbar</strong> = hay pendientes críticos pero todos tienen una forma de
            trabajar alrededor, y esa forma está nombrada arriba. <strong>Rojo</strong> = hay al
            menos un pendiente crítico sin manera de trabajar alrededor.
          </p>
        </section>
      )}

      {/* ── Plan ───────────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Plan — qué sigue</h2>
          <span className="text-xs text-gray-500">{planItems.length} pendientes</span>
        </div>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Ordenado por prioridad calculada: peso de temporada, más si está desbloqueado, más si
          es corto, más si ya está empezado. El orden lo propone el sistema; las fechas las pone
          la gerencia de proyecto.
        </p>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-medium w-8">#</th>
                <th className="py-2 pr-3 font-medium">Pendiente</th>
                <th className="py-2 pr-3 font-medium">Espera</th>
                <th className="py-2 pr-3 font-medium">Esfuerzo</th>
                <th className="py-2 pr-3 font-medium">Fecha objetivo</th>
              </tr>
            </thead>
            <tbody>
              {planItems.slice(0, 25).map((i, n) => (
                <tr key={i.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 text-gray-400 tabular-nums">{n + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs text-gray-400">{i.id}</span>{' '}
                    <span className="text-gray-800">{i.item.slice(0, 110)}</span>
                    {i.temporada === 'critico' && (
                      <span className="ml-2 text-xs text-red-700">crítico</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600">
                    {i.espera_que ?? ETIQUETA_BLOQUEO[i.bloqueo]}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600">
                    {ETIQUETA_ESFUERZO[i.esfuerzo]}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600">
                    {planMap.get(i.id)?.fecha_objetivo ?? (
                      <span className="text-gray-300">
                        {puedeEditarPlan ? 'sin fecha' : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {planItems.length > 25 && (
          <p className="text-xs text-gray-400 mt-2">
            Se muestran los 25 primeros de {planItems.length}. El resto está en el detalle.
          </p>
        )}
      </section>

      {/* ── Detalle ────────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900">Detalle</h2>
        <p className="text-sm text-gray-600 mt-1">
          Cada fila es una petición registrada, con la reunión de la que salió. {filtradas.length}{' '}
          de {items.filter((i) => enAlcance(i, alcance)).length} visibles.
        </p>

        <div className="flex flex-wrap gap-2 mt-4">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md w-56"
          />
          <Select valor={fEstado} onChange={setFEstado} vacio="Todos los estados"
            opciones={Object.entries(ETIQUETA_ESTADO)} />
          <Select valor={fTemporada} onChange={setFTemporada} vacio="Toda la temporada"
            opciones={Object.entries(ETIQUETA_TEMPORADA).filter(([k]) => k !== 'na')} />
          <Select valor={fBloqueo} onChange={setFBloqueo} vacio="Todo lo que se espera"
            opciones={Object.entries(ETIQUETA_BLOQUEO).filter(([k]) => k !== 'na')} />
        </div>

        <div className="mt-4 divide-y divide-gray-100">
          {filtradas.map((i) => (
            <div key={i.id} className="py-3">
              <button
                onClick={() => setAbierta(abierta === i.id ? null : i.id)}
                className="w-full text-left flex items-start gap-3 group"
              >
                <span className="font-mono text-xs text-gray-400 w-14 shrink-0 pt-0.5">{i.id}</span>
                <span className="flex-1 text-sm text-gray-800 group-hover:text-gray-950">
                  {i.item}
                </span>
                <Pildora estado={i.estado} sugerido={i.estado_sugerido} />
              </button>

              {abierta === i.id && (
                <div className="mt-3 ml-14 space-y-2 text-xs">
                  {i.evidencia && (
                    <p className="text-gray-700">
                      <span className="text-gray-500">Por qué ese estado: </span>{i.evidencia}
                    </p>
                  )}
                  {i.rodeo && (
                    <p className="text-gray-700">
                      <span className="text-gray-500">Mientras tanto: </span>{i.rodeo}
                    </p>
                  )}
                  {i.espera_que && (
                    <p className="text-gray-700">
                      <span className="text-gray-500">Espera: </span>{i.espera_que}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-500 pt-1">
                    <span>Origen: {ETIQUETA_ORIGEN[i.origen]}</span>
                    <span>Temporada: {ETIQUETA_TEMPORADA[i.temporada]}</span>
                    <span>Esfuerzo: {ETIQUETA_ESFUERZO[i.esfuerzo]}</span>
                    <span>Área: {ETIQUETA_AREA[i.area]}</span>
                    {i.flag === 'CONTRA' && <span>La definición cambió en el tiempo</span>}
                    {i.flag?.startsWith('CREEP') && <span>Añadido después del acuerdo</span>}
                  </div>
                  <p className="text-gray-400 pt-1">
                    Fuente: {i.src} · categoría {i.cat}
                    {EVIDENCIA_EXIGIDA[i.estado] && (
                      <span className="block mt-1">
                        «{ETIQUETA_ESTADO[i.estado]}» exige: {EVIDENCIA_EXIGIDA[i.estado]}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Conmutador({ etiqueta, valor, opciones, onChange }: {
  etiqueta: string; valor: string;
  opciones: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="block text-xs text-gray-500 mb-1.5">{etiqueta}</span>
      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
        {opciones.map(([v, label]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`px-3 py-1.5 text-sm transition-colors ${
              valor === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Select({ valor, onChange, vacio, opciones }: {
  valor: string; onChange: (v: string) => void; vacio: string; opciones: [string, string][];
}) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700"
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Pildora({ estado, sugerido }: { estado: Estado; sugerido: boolean }) {
  return (
    <span
      title={sugerido
        ? 'Estado sugerido por el análisis del código y las reuniones; pendiente de confirmación.'
        : undefined}
      className={`shrink-0 text-xs px-2 py-0.5 rounded border ${PILL_ESTADO[estado]} ${
        sugerido ? 'border-dashed' : ''
      }`}
    >
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

function BarraApilada({ t }: { t: ReturnType<typeof titular> }) {
  const partes: [Estado, number][] = [
    ['funcionando', t.funcionando],
    ['construido', t.construido],
    ['parcial', t.parcial],
    ['no_construido', t.noConstruido],
    ['sin_determinar', t.sinDeterminar],
  ];
  return (
    <div className="mt-6">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        {partes.map(([e, n]) => n > 0 && (
          <div
            key={e}
            className={COLOR_ESTADO[e]}
            style={{ width: `${(n / t.denominador) * 100}%` }}
            title={`${ETIQUETA_ESTADO[e]}: ${n}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
        {partes.map(([e, n]) => n > 0 && (
          <span key={e} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`w-2.5 h-2.5 rounded-sm ${COLOR_ESTADO[e]}`} />
            {ETIQUETA_ESTADO[e]} · {n}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Lo que no se puede afirmar desde acá. Va arriba y no en un pie de página:
 * un reporte de estado que no declara sus límites se lee como si no los tuviera.
 */
function Franqueza() {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg text-sm">
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full text-left px-4 py-2.5 text-gray-700 hover:text-gray-900"
      >
        {abierto ? '▾' : '▸'} Qué no puede afirmar este reporte
      </button>
      {abierto && (
        <div className="px-4 pb-4 text-xs text-gray-600 space-y-2">
          <p>
            <strong>El estado de los despliegues.</strong> Que el código esté en la rama principal
            no prueba que la última versión esté publicada. Hay dos publicaciones pendientes de
            confirmar, y hasta que se confirmen, algunas funciones marcadas como construidas
            podrían no estar todavía a la vista de quien tiene que validarlas.
          </p>
          <p>
            <strong>Si alguien abrió una pantalla.</strong> Como prueba de uso se toma lo que quedó
            escrito: capturas hechas por ustedes en producción, reportes que mandaron, y lo que
            se dijo en reunión.
          </p>
          <p>
            <strong>Cuatro filas no tienen respuesta en el material disponible</strong> y aparecen
            como «sin determinar» en vez de suponerse. No se infiere entrega desde el silencio.
          </p>
          <p>
            <strong>El estado de cada fila es una propuesta.</strong> Las píldoras con borde
            punteado son el juicio del análisis, no un acuerdo. Si alguna está mal, esa objeción
            es justamente lo que este documento viene a provocar.
          </p>
        </div>
      )}
    </div>
  );
}
