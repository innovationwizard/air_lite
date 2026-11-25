'use client';

import { useContext, useEffect, createContext, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { explicacionColumna, type ColumnaId } from './explicacionColumnas';

const AbrirColumna = createContext<(id: ColumnaId) => void>(() => {});

export function useAbrirColumna(): (id: ColumnaId) => void {
  return useContext(AbrirColumna);
}

/**
 * Un clic en el encabezado abre la cuenta de esa columna. El botón conserva
 * la alineación del encabezado y no ordena la tabla.
 */
export function ThCol({
  id,
  align = 'left',
  colSpan,
  className,
  children,
}: {
  id: ColumnaId;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
  children: ReactNode;
}) {
  const abrir = useAbrirColumna();
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      colSpan={colSpan}
      className={['px-2 py-1.5 font-semibold whitespace-nowrap', alignClass, className ?? 'text-slate-600'].join(' ')}
    >
      <button
        type="button"
        onClick={() => abrir(id)}
        title="Ver la cuenta de esta columna"
        className={['block w-full cursor-pointer hover:underline decoration-dotted underline-offset-2', alignClass].join(' ')}
      >
        {children}
      </button>
    </th>
  );
}

export function ColumnaProvider({
  abierta,
  onAbrir,
  onCerrar,
  children,
}: {
  abierta: ColumnaId | null;
  onAbrir: (id: ColumnaId) => void;
  onCerrar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierta, onCerrar]);

  const exp = abierta ? explicacionColumna(abierta) : null;

  return (
    <AbrirColumna.Provider value={onAbrir}>
      {children}
      <Dialog open={exp !== null} onOpenChange={(open) => { if (!open) onCerrar(); }}>
        {exp && (
          <DialogContent className="max-w-lg p-0" aria-labelledby="columna-cuenta-titulo">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 id="columna-cuenta-titulo" className="text-base font-semibold text-slate-800">
                {exp.titulo}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {exp.formula ? 'La misma cuenta para todos los productos.' : 'No es un cálculo.'}
              </p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm text-slate-700">
              {exp.formula && (
                <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-800">
                  {exp.formula}
                </p>
              )}
              {exp.terminos.length > 0 && (
                <dl className={exp.formula ? 'mt-4 space-y-3' : 'space-y-3'}>
                  {exp.terminos.map((t) => (
                    <div key={t.nombre}>
                      <dt className="font-medium text-slate-800">{t.nombre}</dt>
                      <dd className="mt-0.5 text-slate-600">{t.cuenta}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {exp.origen && <p className="leading-relaxed">{exp.origen}</p>}
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={onCerrar}
                autoFocus
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AbrirColumna.Provider>
  );
}
