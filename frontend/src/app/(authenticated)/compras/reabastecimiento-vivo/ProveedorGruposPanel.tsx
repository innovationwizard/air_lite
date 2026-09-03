'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2, X } from 'lucide-react';

/**
 * Panel de gestión de grupos de proveedores — master-detail, dentro de
 * reabastecimiento-vivo (Wilmer-only). Ver PROVEEDORES_GROUPING_BUILD_PLAN.md
 * §4.
 *
 * No usa el `Dialog` de components/ui ni `@radix-ui/react-dialog`: ninguno de
 * los dos tiene un solo consumidor real en el repo hoy (ambos son andamiaje
 * sin usar), así que este modal sigue el patrón que SÍ está en uso en este
 * mismo archivo — el overlay fijo con click-fuera-para-cerrar de
 * `RangoFiltro` en VivoClient.tsx — en vez de adoptar una convención muerta.
 */

interface Supplier { id: number; name: string }
interface Group { id: string; displayName: string; members: Supplier[] }
interface GruposPayload { groups: Group[]; ungrouped: Supplier[] }

export function ProveedorGruposPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<GruposPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [saving, setSaving] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/compras/proveedor-grupos');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando grupos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  // Todos los proveedores, con su grupo actual (o null) — para el checklist
  // y para la advertencia de "se moverá" al editar otro grupo.
  const todos = useMemo(() => {
    if (!data) return [] as { id: number; name: string; groupId: string | null }[];
    const out: { id: number; name: string; groupId: string | null }[] = [];
    for (const g of data.groups) for (const m of g.members) out.push({ ...m, groupId: g.id });
    for (const s of data.ungrouped) out.push({ ...s, groupId: null });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const grupoActual = selected && selected !== 'new'
    ? data?.groups.find((g) => g.id === selected) ?? null
    : null;

  const guardado = async () => {
    await cargar();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- overlay: cerrar al hacer click fuera, mismo patrón de RangoFiltro */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gestionar grupos de proveedores"
        className="relative z-10 w-full max-w-3xl h-[560px] bg-white rounded-xl shadow-xl border border-gray-200 flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Grupos de proveedores</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Cargando…</div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-56 border-r border-gray-100 overflow-auto">
              <button
                type="button"
                onClick={() => setSelected('new')}
                className="w-full flex items-center gap-1.5 text-left text-sm font-semibold text-teal-700 px-3 py-2.5 border-b border-gray-100 hover:bg-teal-50"
              >
                <Plus size={14} /> Nuevo grupo
              </button>
              {(data?.groups ?? []).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 text-sm ${
                    selected === g.id ? 'bg-teal-50 text-teal-900 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="truncate">{g.displayName}</div>
                  <div className="text-xs text-gray-400">{g.members.length} proveedor{g.members.length === 1 ? '' : 'es'}</div>
                </button>
              ))}
              <div className="px-3 py-2.5 text-xs text-gray-400">
                {(data?.ungrouped ?? []).length} sin agrupar
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {selected === null ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">
                  Elegí un grupo, o creá uno nuevo.
                </div>
              ) : (
                <GrupoEditor
                  key={selected}
                  modo={selected === 'new' ? 'nuevo' : 'editar'}
                  grupo={grupoActual}
                  todos={todos}
                  saving={saving}
                  setSaving={setSaving}
                  onGuardado={async () => {
                    await guardado();
                    setSelected(null);
                  }}
                  onEliminado={async () => {
                    await guardado();
                    setSelected(null);
                  }}
                  setError={setError}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GrupoEditor({
  modo, grupo, todos, saving, setSaving, onGuardado, onEliminado, setError,
}: {
  modo: 'nuevo' | 'editar';
  grupo: Group | null;
  todos: { id: number; name: string; groupId: string | null }[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  onGuardado: () => void | Promise<void>;
  onEliminado: () => void | Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [nombre, setNombre] = useState(grupo?.displayName ?? '');
  const [miembros, setMiembros] = useState<Set<number>>(
    new Set((grupo?.members ?? []).map((m) => m.id)),
  );
  const [busqueda, setBusqueda] = useState('');

  const q = busqueda.trim().toLowerCase();
  const visibles = q ? todos.filter((s) => s.name.toLowerCase().includes(q)) : todos;

  const toggle = (id: number) => {
    setMiembros((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const puedeGuardar = nombre.trim().length > 0 && miembros.size > 0;

  const guardar = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { displayName: nombre.trim(), supplierIds: [...miembros] };
      const res = await fetch(
        modo === 'nuevo' ? '/api/compras/proveedor-grupos' : `/api/compras/proveedor-grupos/${grupo!.id}`,
        {
          method: modo === 'nuevo' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      await onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando el grupo');
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async () => {
    if (!grupo) return;
    if (!confirm(
      `¿Eliminar el grupo «${grupo.displayName}»? Sus ${grupo.members.length} proveedores `
      + 'vuelven a aparecer sueltos en el filtro.',
    )) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compras/proveedor-grupos/${grupo.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      await onEliminado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error eliminando el grupo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del grupo (p. ej. «Carvajal»)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        {modo === 'editar' && (
          <button
            type="button"
            onClick={eliminar}
            disabled={saving}
            title="Eliminar grupo"
            className="text-gray-400 hover:text-red-600 disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proveedor…"
          className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
      </div>

      <div className="flex-1 overflow-auto border border-gray-100 rounded-lg">
        {visibles.map((s) => {
          const enOtroGrupo = s.groupId !== null && s.groupId !== grupo?.id;
          return (
            <label
              key={s.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={miembros.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              <span className="flex-1 truncate">{s.name}</span>
              {enOtroGrupo && miembros.has(s.id) && (
                <span
                  title="Este proveedor pertenece a otro grupo — guardar lo MUEVE aquí"
                  className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5"
                >
                  <AlertTriangle size={10} /> se moverá
                </span>
              )}
            </label>
          );
        })}
        {visibles.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-400">Sin resultados.</div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-gray-500">{miembros.size} seleccionado{miembros.size === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={guardar}
          disabled={!puedeGuardar || saving}
          className="text-sm font-semibold text-white bg-teal-700 rounded-lg px-4 py-1.5 hover:bg-teal-800 disabled:opacity-40"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
