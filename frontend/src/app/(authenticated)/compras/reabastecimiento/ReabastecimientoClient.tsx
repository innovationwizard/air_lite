'use client';

import { useMemo, useState } from 'react';
import { Search, AlertTriangle, PackageCheck, Boxes, Pencil, Info } from 'lucide-react';
import { type Dataset, type Sev, sugerido, doh, sev, fmt } from './engine';

const SEV_PILL: Record<Sev, string> = {
  crit: 'bg-red-100 text-red-700',
  low: 'bg-amber-100 text-amber-700',
  ok: 'bg-emerald-100 text-emerald-700',
  exc: 'bg-blue-100 text-blue-700',
};
export function ReabastecimientoClient({ data }: { data: Dataset }) {
  const bodegas = useMemo(() => Object.keys(data), [data]);
  const [cur, setCur] = useState(bodegas[0]);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState('');
  const [onlySug, setOnlySug] = useState(false);
  const [onlyCrit, setOnlyCrit] = useState(false);
  // per-(bodega|cod) tránsito override; undefined = use source value
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const provList = useMemo(
    () => [...new Set(data[cur].rows.map((r) => r.prov).filter(Boolean))].sort(),
    [data, cur],
  );

  // computed + filtered list
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return data[cur].rows
      .map((r) => {
        const t = overrides[`${cur}|${r.cod}`] ?? r.trans;
        const s = sugerido(r, t);
        const d = doh(r);
        return { r, t, s, d, edited: overrides[`${cur}|${r.cod}`] !== undefined };
      })
      .filter(({ r, s, d }) => {
        if (prov && r.prov !== prov) return false;
        if (query && !(`${r.cod}`.toLowerCase().includes(query) || (r.desc || '').toLowerCase().includes(query)))
          return false;
        if (onlySug && s <= 0) return false;
        if (onlyCrit && d >= 3) return false;
        return true;
      })
      .sort((a, b) => a.d - b.d);
  }, [data, cur, q, prov, onlySug, onlyCrit, overrides]);

  const kpis = useMemo(() => {
    const need = list.filter((x) => x.s > 0);
    const crit = list.filter((x) => x.d < 3);
    const totSug = need.reduce((a, x) => a + x.s, 0);
    return { total: list.length, need: need.length, totSug, crit: crit.length };
  }, [list]);

  const topProv = useMemo(() => {
    const by: Record<string, { sug: number; crit: number }> = {};
    for (const r of data[cur].rows) {
      if (!r.prov) continue;
      const s = sugerido(r, overrides[`${cur}|${r.cod}`] ?? r.trans);
      const d = doh(r);
      by[r.prov] = by[r.prov] || { sug: 0, crit: 0 };
      by[r.prov].sug += s;
      if (d < 3 && s > 0) by[r.prov].crit += 1;
    }
    const arr = Object.entries(by)
      .map(([p, v]) => ({ p, ...v }))
      .sort((a, b) => b.sug - a.sug)
      .slice(0, 8);
    const max = Math.max(1, ...arr.map((a) => a.sug));
    return { arr, max };
  }, [data, cur, overrides]);

  const parity = data[cur].parity;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reabastecimiento</h1>
          <p className="text-sm text-gray-500">Sugerido de compra por bodega y proveedor — reemplazo de MAYO2026.xlsx</p>
        </div>
        <div className="flex-1" />
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {bodegas.map((b) => (
            <button
              key={b}
              onClick={() => setCur(b)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                cur === b ? 'bg-teal-700 text-white font-semibold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Parity + source notice */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 border border-emerald-200">
          <PackageCheck size={13} />
          {parity
            ? `Motor verificado: ${((parity.match / parity.total) * 100).toFixed(1)}% igual al Excel (${parity.match}/${parity.total})`
            : 'Motor: valores del libro'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 px-2.5 py-1 border border-gray-200">
          <Info size={13} /> Datos: MAYO2026.xlsx (interino — pendiente sincronización Odoo en vivo)
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Productos" value={fmt(kpis.total)} sub={`bodega ${cur}`} icon={<Boxes size={16} />} />
        <Kpi label="Requieren compra" value={fmt(kpis.need)} sub="sugerido > 0" accent />
        <Kpi label="Unidades sugeridas" value={fmt(kpis.totSug)} sub="total a comprar" accent />
        <Kpi label="Quiebre inminente" value={fmt(kpis.crit)} sub="DOH < 3 días" danger />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap gap-2 items-center p-3 border-b border-gray-100">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar código o descripción…"
                className="w-full pl-8 pr-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <select
              value={prov}
              onChange={(e) => setProv(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 max-w-[180px]"
            >
              <option value="">Todos los proveedores</option>
              {provList.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlySug} onChange={(e) => setOnlySug(e.target.checked)} /> Solo con sugerido
            </label>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlyCrit} onChange={(e) => setOnlyCrit(e.target.checked)} /> Solo quiebre
            </label>
          </div>

          <div className="overflow-auto max-h-[62vh]">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Código</th>
                  <th className="text-left font-semibold px-3 py-2.5 border-b border-gray-200">Descripción / Proveedor</th>
                  <th className="text-right font-semibold px-3 py-2.5 border-b border-gray-200">Existencias</th>
                  <th className="text-right font-semibold px-3 py-2.5 border-b border-gray-200">DOH</th>
                  <th className="text-right font-semibold px-3 py-2.5 border-b border-gray-200">
                    <span className="inline-flex items-center gap-1">
                      Tránsito <Pencil size={11} />
                    </span>
                  </th>
                  <th className="text-right font-semibold px-3 py-2.5 border-b border-gray-200">Sugerido</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {list.slice(0, 400).map(({ r, t, s, d, edited }) => {
                  const band = sev(d);
                  return (
                    <tr key={r.cod} className="hover:bg-teal-50/50">
                      <td className="px-3 py-2 border-b border-gray-100 text-left">{r.cod}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-left">
                        <div className="truncate max-w-[260px] text-gray-800">{r.desc}</div>
                        <div className="text-gray-400 text-xs">{r.prov}</div>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{fmt(r.exist)}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">
                        <span className={`inline-block min-w-[44px] text-center px-2 py-0.5 rounded-full font-semibold text-xs ${SEV_PILL[band]}`}>
                          {d.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">
                        <input
                          type="number"
                          value={Math.round(t)}
                          onChange={(e) =>
                            setOverrides((o) => ({ ...o, [`${cur}|${r.cod}`]: parseFloat(e.target.value) || 0 }))
                          }
                          className={`w-[70px] text-right tabular-nums px-1.5 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 ${
                            edited ? 'border-teal-500 ring-1 ring-teal-500' : 'border-gray-200'
                          }`}
                        />
                      </td>
                      <td className={`px-3 py-2 border-b border-gray-100 text-right font-bold ${s > 0 ? 'text-teal-700' : 'text-gray-400'}`}>
                        {fmt(s)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 px-3 py-2.5 border-t border-gray-100">
            Mostrando <b>{Math.min(400, list.length)}</b> de <b>{list.length}</b> productos
            {list.length > 400 ? ' (primeros 400 — refiná con filtros)' : ''} · bodega <b>{cur}</b>
          </div>
        </div>

        {/* Sidebar panels */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold px-4 py-3 border-b border-gray-100">
              Top afectaciones por proveedor
            </h2>
            <ul>
              {topProv.arr.map((a) => (
                <li key={a.p} className="px-4 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate text-gray-800">{a.p}</span>
                    <b className="tabular-nums">{fmt(a.sug)}</b>
                  </div>
                  <div
                    className="h-1.5 rounded mt-1.5"
                    style={{
                      width: `${((a.sug / topProv.max) * 100).toFixed(0)}%`,
                      background: a.crit > 0 ? '#c0392b' : '#0e7c86',
                    }}
                  />
                  <div className="text-xs text-gray-400 mt-0.5">{a.crit} en quiebre</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle size={13} /> Umbrales DOH (ilustrativos)
            </h2>
            <div className="flex flex-wrap gap-3 text-xs text-gray-600">
              <Legend color="#c0392b" text="Quiebre <3" />
              <Legend color="#c9820a" text="Bajo 3–7" />
              <Legend color="#2f7d4f" text="Sano 7–30" />
              <Legend color="#2b6cb0" text="Exceso >30" />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Umbrales configurables (por confirmar con Wilmer). DOH = existencias ÷ (promedio 3 meses ÷ 26).
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-5 leading-relaxed">
        Editá la columna <b>Tránsito</b> de cualquier fila (ej. lo pendiente de Carvajal que aún no está en Odoo) y el{' '}
        <b>Sugerido</b> se recalcula al instante con el mismo motor del Excel — sin abrir la hoja. Los cambios son
        locales a esta sesión; la escritura persistente y la sincronización en vivo con Odoo son los siguientes pasos.
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  accent,
  danger,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
        {icon} {label}
      </div>
      <div
        className={`text-2xl font-bold tabular-nums mt-1 ${
          danger ? 'text-red-600' : accent ? 'text-teal-700' : 'text-gray-900'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} /> {text}
    </span>
  );
}
