'use client';

import { useCallback, useEffect, useState } from 'react';
import { etiquetaMes, estadoCiclo, mesPorDefecto } from '@/lib/comercial/forecast';
import { Captura } from './Captura';
import { Consolidado } from './Consolidado';
import { TablaRecomendacion } from './TablaRecomendacion';
import type { Datos } from './types';

/**
 * Captura y consolidado del forecast comercial.
 *
 * EL REQUISITO PRINCIPAL ES QUE SE USE. La hoja actual la llenaron cuatro de
 * seis áreas y una de las que faltó fue porque no entendió el archivo, así que
 * toda decisión de esta pantalla se resuelve a favor de quitar fricción.
 *
 * NIVEL 2 (2026-09-10): el jefe de canal ya no arranca con un formulario en
 * blanco. Arranca con la tabla de los 50 códigos de mayor riesgo de su canal,
 * cada uno con lo que pidió y recibió, quién lo compra y la recomendación ya
 * calculada; aprobar es el camino normal, y el formulario de cuatro campos
 * queda para agregar cualquier otro código. Quien sólo lee (compras,
 * gerencia) elige un canal y ve la misma tabla sin editar, además del
 * consolidado.
 */

export function ForecastClient() {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState<string>('');
  // For readers: which channel's table to look at. '' = none (just the consolidado).
  const [areaVista, setAreaVista] = useState<string>('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/comercial/forecast');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar');
      setD(j);
      // `mesesAbiertos[0]` es el mes EN CURSO, cuya captura cerró el mes
      // pasado: abrir ahí mandaba a los seis canales a cargar un mes ya
      // comprado. Se abre en el primero cuya captura sigue viva.
      setMes((m) => m || mesPorDefecto(new Date()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>;
  if (!d) return <div className="p-8 text-sm text-gray-500">Cargando…</div>;

  const esPadre = !!d.esPadre;
  const capturando = d.puedeCapturar && !!d.miArea && !esPadre;
  const bloqueoMio = capturando ? (d.bloqueos?.[`${d.miArea}|${mes}`] ?? null) : null;
  // A parent login (institucional@) reads its sellers; the selector offers only them.
  const areasElegibles = esPadre ? d.areas.filter((a) => a.padre === d.miArea) : d.areas.filter((a) => !d.areas.some((h) => h.padre === a.slug));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Forecast comercial</h1>
        <p className="text-sm text-gray-500 mt-1">
          {capturando
            ? `Revisá la recomendación de cada código y aprobá. Canal: ${
                d.areas.find((a) => a.slug === d.miArea)?.nombre ?? d.miArea}`
            : esPadre
              ? `Lo que cargó cada vendedor de ${d.areas.find((a) => a.slug === d.miArea)?.nombre ?? d.miArea}, y el total que ve Compras. Sólo lectura: cada vendedor carga y bloquea lo suyo.`
              : 'Lo que cargó cada canal, junto, sin descargar ni pegar nada.'}
        </p>
      </header>

      {/* El ciclo lo pone el cliente, no este documento. */}
      {mes && <BannerCiclo mes={mes} />}

      <div className="flex flex-wrap gap-2">
        {/* Readers also get the month that just closed: that is where
            «qué pidió cada canal contra qué vendió» gets answered. */}
        {(capturando ? d.mesesAbiertos : (d.mesesVista ?? d.mesesAbiertos)).map((m) => (
          <button
            key={m}
            onClick={() => setMes(m)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              mes === m ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {etiquetaMes(m)}{m === d.mesCerrado ? ' · cerrado' : ''}
          </button>
        ))}
      </div>

      {capturando ? (
        <>
          <TablaRecomendacion area={d.miArea!} mes={mes} soloLectura={false} onCambio={cargar}
                              bloqueo={bloqueoMio} puedeDesbloquear={!!d.puedeDesbloquear} />
          <Captura datos={d} mes={mes} onCambio={cargar} bloqueado={!!bloqueoMio} />
        </>
      ) : (
        <>
          <Consolidado datos={d} mes={mes} onCambio={cargar} modo={esPadre ? 'hijos' : 'rollup'} />
          <section className="space-y-3">
            <label className="text-sm text-gray-700">
              {esPadre ? 'Ver la tabla de un vendedor:' : 'Ver la tabla de un canal:'}{' '}
              <select
                value={areaVista}
                onChange={(e) => setAreaVista(e.target.value)}
                className="ml-1 px-2 py-1 text-sm border border-gray-300 rounded-md bg-white"
              >
                <option value="">—</option>
                {areasElegibles.map((a) => <option key={a.slug} value={a.slug}>{a.nombre}</option>)}
              </select>
            </label>
            {areaVista && d.mesesAbiertos.includes(mes) && (
              <TablaRecomendacion area={areaVista} mes={mes} soloLectura onCambio={cargar}
                                  bloqueo={d.bloqueos?.[`${areaVista}|${mes}`] ?? null}
                                  puedeDesbloquear={!!d.puedeDesbloquear} />
            )}
            {areaVista && !d.mesesAbiertos.includes(mes) && (
              <p className="text-xs text-gray-500">La tabla por canal es para los meses abiertos; para un mes cerrado, el consolidado de arriba muestra lo capturado contra lo real.</p>
            )}
          </section>
        </>
      )}

      {d.puedeCapturar && !d.miArea && !esPadre && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
          Tu usuario todavía no tiene un canal comercial asignado, así que no podés cargar
          todavía. Un administrador lo configura en un minuto.
        </p>
      )}
    </div>
  );
}

/* ── El plazo del ciclo ─────────────────────────────────────────────────── */

const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Las dos fechas del ciclo, y cuánto queda.
 *
 * Redacta en pasado cuando el plazo venció, en vez de anunciar un plazo
 * negativo: el mes en curso sigue siendo cargable —una corrección tardía es
 * legítima— pero decirle «quedan −27 días» a quien vino a cargar contra reloj
 * es la clase de fricción que dejó la hoja anterior a medio llenar.
 */
function BannerCiclo({ mes }: { mes: string }) {
  const { cierre, reunion, cerrada, diasRestantes } = estadoCiclo(mes, new Date());
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
      <span className="text-gray-800">
        Para <strong>{etiquetaMes(mes)}</strong>: la captura {cerrada ? 'cerró' : 'cierra'} el{' '}
        <strong>{fechaLarga(cierre)}</strong>
        {' '}y la reunión de forecast {cerrada ? 'fue' : 'es'} el{' '}
        <strong>{fechaLarga(reunion)}</strong>.
      </span>
      {!cerrada && (
        <span className="text-amber-800 ml-1 font-medium">
          {diasRestantes === 0 ? 'Cierra hoy.'
            : diasRestantes === 1 ? 'Queda 1 día.'
            : `Quedan ${diasRestantes} días.`}
        </span>
      )}
    </div>
  );
}

