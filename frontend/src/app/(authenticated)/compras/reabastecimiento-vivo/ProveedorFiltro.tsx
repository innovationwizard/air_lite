'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { grupoFiltroValor } from '@/lib/compras/tabla';

export interface ProveedorGrupo {
  id: string;
  displayName: string;
}

/**
 * Filtro de proveedores — reemplaza el `<select>` nativo (2026-09-04).
 *
 * Por qué no es un `<select>`: con ~70 nombres alfabéticos escanear la lista
 * es exactamente la queja original (ver PROVEEDORES_GROUPING_UX_DESIGN.md
 * §3.3). Por qué no `@radix-ui/react-select` (ya es dependencia del repo):
 * su primitiva no trae filtro de texto integrado, que es lo único que el
 * `<select>` nativo no podía hacer — no vale la pena adoptarla para perder
 * esa única cosa. Sin dependencia nueva: con este tamaño de lista un listbox
 * a mano son unas pocas líneas.
 *
 * El valor de un grupo es su id (via `grupoFiltroValor`), NUNCA su nombre —
 * así renombrar un grupo no le mueve el piso a un filtro activo (resuelto en
 * PROVEEDORES_GROUPING_BUILD_PLAN.md §7): la etiqueta mostrada se busca cada
 * vez en `grupos`/`nombresSueltos`, nunca se guarda en el estado local.
 */
export function ProveedorFiltro({
  value, onChange, grupos, nombresSueltos, onGestionar,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Grupos con al menos una fila visible en esta bodega. */
  grupos: ProveedorGrupo[];
  /** Nombres crudos de proveedores sin grupo, con filas visibles en esta bodega. */
  nombresSueltos: string[];
  /** Abre el panel de gestión de grupos (Wilmer-only — gateado por el caller). */
  onGestionar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierto]);

  const etiquetaActual = useMemo(() => {
    if (!value) return 'Todos los proveedores';
    if (value.startsWith('group:')) {
      const id = value.slice('group:'.length);
      return grupos.find((g) => g.id === id)?.displayName ?? 'Grupo eliminado';
    }
    return value;
  }, [value, grupos]);

  const q = busqueda.trim().toLowerCase();
  const gruposFiltrados = q ? grupos.filter((g) => g.displayName.toLowerCase().includes(q)) : grupos;
  const sueltosFiltrados = q ? nombresSueltos.filter((n) => n.toLowerCase().includes(q)) : nombresSueltos;

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
    setBusqueda('');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`flex items-center gap-1.5 text-sm border rounded-lg px-2 py-2 max-w-[200px] ${
          value ? 'border-teal-400 text-teal-800 bg-teal-50/50' : 'border-gray-200 text-gray-700'
        }`}
      >
        <span className="truncate">{etiquetaActual}</span>
        <ChevronDown size={13} className="shrink-0 text-gray-400" />
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Quitar filtro de proveedor"
          aria-label="Quitar filtro de proveedor"
          className="absolute -right-1 -top-1 rounded-full bg-white border border-gray-300 text-gray-400 hover:text-red-600"
        >
          <X size={12} />
        </button>
      )}
      {abierto && (
        <div className="absolute z-30 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative p-2 border-b border-gray-100">
            <Search size={13} className="absolute left-4 top-4.5 text-gray-400" />
            <input
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar proveedor o grupo…"
              className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            <Opcion label="Todos los proveedores" selected={value === ''} onClick={() => elegir('')} />
            {gruposFiltrados.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Grupos
              </div>
            )}
            {gruposFiltrados.map((g) => (
              <Opcion
                key={g.id}
                label={g.displayName}
                selected={value === grupoFiltroValor(g.id)}
                onClick={() => elegir(grupoFiltroValor(g.id))}
              />
            ))}
            {sueltosFiltrados.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Sin agrupar
              </div>
            )}
            {sueltosFiltrados.map((n) => (
              <Opcion key={n} label={n} selected={value === n} onClick={() => elegir(n)} />
            ))}
            {gruposFiltrados.length === 0 && sueltosFiltrados.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-400">Sin resultados.</div>
            )}
          </div>
          {onGestionar && (
            <button
              type="button"
              onClick={() => { setAbierto(false); onGestionar(); }}
              className="w-full text-left text-xs text-teal-700 font-semibold px-3 py-2 border-t border-gray-100 hover:bg-teal-50"
            >
              Gestionar grupos de proveedores…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Opcion({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-teal-50 ${
        selected ? 'text-teal-800 font-semibold' : 'text-gray-700'
      }`}
    >
      <Check size={12} className={selected ? 'opacity-100' : 'opacity-0'} />
      <span className="truncate">{label}</span>
    </button>
  );
}
