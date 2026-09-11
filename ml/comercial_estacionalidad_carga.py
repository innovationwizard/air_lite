"""Seasonal index loader for the forecast comercial (Level 2).

Builds `comercial_estacionalidad` — a multiplicative monthly index per
(SAI channel group x product category) — and `comercial_categoria_sai`
(SAI code -> category), from:

  * `sales.history` in Odoo (the SAI load, 2021-2025; static, last written
    2025-05-27) for the years in SAI_ANIOS, and
  * Odoo `sale.order.line` for every COMPLETE calendar year since Odoo went
    live (2025 today; 2026 from January 2027), per group, via the team ids
    of `comercial_area_reglas`.

Spec: docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md §3.3.
Plan: docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md Phase 1.2.

WHY SAI IS USABLE HERE AND NOT FOR THE ENGINE'S `h`. On the six months where
SAI and Odoo overlap (2024-10 .. 2025-02), SAI / Odoo is 0.90-0.95 every month
for Institucional, Supermercados and Oficina (SAI is on a delivered basis;
0.9 is the fill rate) and 73% of SKUs agree within +-20%. That is enough for
SHAPE (the ratio of a month to the year's mean), which is all an index is;
it is not enough for LEVELS, which is why N12 stands for `h`.

WHY CATEGORY, NOT SKU, NOT CHANNEL. Backtested at the real horizon (data
through T-2): per-SKU indices are noise (+8 to +13 points worse than flat);
channel-only is marginally better in the CDs and worse in Supermercados;
category is where 3-4 years are enough and the shape is real. December's
under-forecast goes from -20% to -5%, Supermercados from 42% to 32% WAPE.

WHY 2022 IS INCLUDED although the 2026-07-29 decision excludes 2021-22 from
`h` as pandemic-distorted: that rule is about levels; this is shape, and the
backtest with 2022 is neutral on the year while without it Mayoreo, Zacapa
and Peten lose 0.5-0.8 points. One constant (SAI_ANIOS) reverts it.

Yearly job, not hourly: re-run each January once December closes.

Usage:
    set -a; source .env.prod; set +a
    python3 ml/comercial_estacionalidad_carga.py --dry-run   # prints, writes nothing
    python3 ml/comercial_estacionalidad_carga.py             # replaces both tables

READ-ONLY against Odoo (hard rule). Writes only the two Supabase tables.
"""

import json
import logging
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from odoo_sync_reabastecimiento import (  # noqa: E402
    ORDERED_STATES, connect_odoo, fold_uom_groups, load_uom_context, odoo_read_all,
    sb_get_all, sb_insert_batched, sb_request,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

SAI_ANIOS = [2022, 2023, 2024]
# SAI channel codes that make up each group in comercial_areas.grupo_sai.
# A group not listed here is one SAI channel with the same code.
GRUPO_SAI_CANALES = {'MY': ['MYCAP', 'MYINT', 'OFICI']}
SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
MES_POR_NOMBRE = {n: i + 1 for i, n in enumerate(SPANISH_MONTHS)}
# Odoo went live 2024-10; the first complete calendar year is 2025.
PRIMER_ANIO_ODOO_COMPLETO = 2025
MIN_ANIOS = 2          # years needed for an index at any level
MIN_MESES_CON_DATO = 9  # a year with fewer non-zero months is not a year
CLAMP = (0.6, 1.8)
GRUPO_FALLBACK = '*'


# ── pure functions (tested offline) ──────────────────────────────────────────

def index_from_years(perfil, min_anios=MIN_ANIOS, min_meses=MIN_MESES_CON_DATO, clamp=CLAMP):
    """perfil: {year: [12 monthly sums]} -> ([12 indices], [years used]) or
    (None, []) when fewer than `min_anios` usable years exist.

    A year counts only if it has >= `min_meses` months with data — a partial
    year (SAI's 2025 has Jan-Mar) would otherwise make nine months look like
    zero-demand months. Index = mean over usable years of month / year mean,
    clamped so one freak year cannot turn a month into 3x or 0.1x.
    """
    idxs, anios = [], []
    for year in sorted(perfil):
        v = perfil[year]
        total = sum(v)
        if total <= 0 or sum(1 for x in v if x > 0) < min_meses:
            continue
        media = total / 12.0
        idxs.append([x / media for x in v])
        anios.append(year)
    if len(idxs) < min_anios:
        return None, []
    lo, hi = clamp
    return [min(hi, max(lo, statistics.mean(col))) for col in zip(*idxs)], anios


def build_indices(perfiles_categoria, perfil_grupo):
    """perfiles_categoria: {categoria: {year: [12]}}, perfil_grupo: {year: [12]}
    -> list of {categoria, mes, indice, anios} incl. the '*' fallback row set.
    Categories without enough years are omitted (they fall back to '*')."""
    out = []
    for categoria, perfil in sorted(perfiles_categoria.items()):
        if not categoria:
            continue
        idx, anios = index_from_years(perfil)
        if idx:
            out += [{'categoria': categoria, 'mes': m + 1, 'indice': round(idx[m], 4), 'anios': anios}
                    for m in range(12)]
    idx, anios = index_from_years(perfil_grupo)
    if idx:
        out += [{'categoria': GRUPO_FALLBACK, 'mes': m + 1, 'indice': round(idx[m], 4), 'anios': anios}
                for m in range(12)]
    return out


def acumular_sai(rows, canales, anios):
    """SAI rows -> (perfiles por categoria, perfil del grupo, code->categoria).
    Rows outside `canales` are ignored; a row without a parseable month is
    counted and skipped by the caller."""
    cat = defaultdict(lambda: defaultdict(lambda: [0.0] * 12))
    grupo = defaultdict(lambda: [0.0] * 12)
    code_cat = {}
    saltadas = 0
    for r in rows:
        m = MES_POR_NOMBRE.get((r.get('month') or '').strip().lower())
        if not m:
            saltadas += 1
            continue
        code = (r.get('code') or '').strip()
        categoria = (r.get('category') or '').strip()
        if code and categoria and code not in code_cat:
            code_cat[code] = categoria
        if r.get('channel') not in canales:
            continue
        for y in anios:
            q = r.get(f'quantity_{str(y)[2:]}') or 0.0
            if q:
                cat[categoria][y][m - 1] += q
                grupo[y][m - 1] += q
    return cat, grupo, code_cat, saltadas


# ── Odoo reads ───────────────────────────────────────────────────────────────

def anios_odoo_completos(today):
    """Complete calendar years Odoo can contribute: PRIMER_ANIO_ODOO_COMPLETO .. last year."""
    return list(range(PRIMER_ANIO_ODOO_COMPLETO, today.year))


def odoo_year_by_category(execute, team_ids, year, uom_ctx, code_cat, sku_by_opid):
    """Ordered qty per (category, month) for one Odoo year and one set of
    teams, folded to stock UoM. Products absent from SAI go to category ''
    (group total only)."""
    factors, stock_uom = uom_ctx
    cat = defaultdict(lambda: [0.0] * 12)
    grupo = [0.0] * 12
    for m in range(1, 13):
        s = f'{year:04d}-{m:02d}-01'
        e = f'{year + 1:04d}-01-01' if m == 12 else f'{year:04d}-{m + 1:02d}-01'
        dom = [['state', 'in', ORDERED_STATES], ['display_type', '=', False],
               ['order_id.team_id', 'in', team_ids],
               ['order_id.date_order', '>=', s], ['order_id.date_order', '<', e]]
        groups = execute('sale.order.line', 'read_group', dom, ['product_uom_qty'],
                         ['product_id', 'product_uom'], lazy=False, limit=200000)
        totals, _unconv = fold_uom_groups(groups, factors, stock_uom, 'product_uom_qty', 'product_uom')
        for opid, q in totals.items():
            cat[code_cat.get(sku_by_opid.get(opid, ''), '')][m - 1] += q
            grupo[m - 1] += q
    return cat, grupo


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    execute = connect_odoo(kind='estacionalidad')
    today = datetime.now(timezone.utc).date()

    areas = sb_get_all('comercial_areas?select=slug,grupo_sai,activa&activa=eq.true')
    reglas = sb_get_all('comercial_area_reglas?select=area,odoo_team_id')
    grupos = sorted({a['grupo_sai'] for a in areas if a['grupo_sai']})
    teams_por_grupo = {g: sorted({r['odoo_team_id'] for r in reglas
                                  if any(a['slug'] == r['area'] and a['grupo_sai'] == g for a in areas)})
                       for g in grupos}
    logger.info('groups: %s', teams_por_grupo)

    sai_rows = odoo_read_all(execute, 'sales.history', [],
                             ['code', 'category', 'month', 'channel']
                             + [f'quantity_{str(y)[2:]}' for y in SAI_ANIOS], page=5000)
    logger.info('sales.history: %d rows', len(sai_rows))

    uom_ctx = load_uom_context(execute)
    prods = execute('product.product', 'search_read', [], fields=['id', 'default_code'],
                    context={'active_test': False})
    sku_by_opid = {p['id']: (p['default_code'] or '').strip() for p in prods}
    odoo_years = anios_odoo_completos(today)

    filas, code_cat_all = [], {}
    for g in grupos:
        canales = GRUPO_SAI_CANALES.get(g, [g])
        cat, grupo, code_cat, saltadas = acumular_sai(sai_rows, canales, SAI_ANIOS)
        code_cat_all.update(code_cat)
        for y in odoo_years:
            ocat, ogrupo = odoo_year_by_category(execute, teams_por_grupo[g], y, uom_ctx,
                                                 code_cat, sku_by_opid)
            for c, v in ocat.items():
                for m in range(12):
                    cat[c][y][m] += v[m]
            for m in range(12):
                grupo[y][m] += ogrupo[m]
        rows_g = build_indices(cat, grupo)
        for r in rows_g:
            r['grupo_sai'] = g
        filas += rows_g
        fb = {r['mes']: r['indice'] for r in rows_g if r['categoria'] == GRUPO_FALLBACK}
        n_cat = len({r['categoria'] for r in rows_g}) - (1 if fb else 0)
        logger.info('%s: %d categories with an index, group Oct/Nov/Dec/Mar = %s/%s/%s/%s '
                    '(SAI rows skipped for month: %d)',
                    g, n_cat, fb.get(10), fb.get(11), fb.get(12), fb.get(3), saltadas)

    logger.info('total index rows: %d; code->category map: %d', len(filas), len(code_cat_all))
    if dry_run:
        print(json.dumps([r for r in filas if r['categoria'] == GRUPO_FALLBACK], indent=1)[:4000])
        return

    now = datetime.now(timezone.utc).isoformat()
    # Static tables: replaced whole. A stale category row from last year would
    # be an index nobody recomputed presented as current.
    sb_request('DELETE', 'comercial_estacionalidad?id=not.is.null')
    sb_insert_batched('comercial_estacionalidad',
                      [{**r, 'cargado_at': now} for r in filas])
    sb_request('DELETE', 'comercial_categoria_sai?sku=not.is.null')
    sb_insert_batched('comercial_categoria_sai',
                      [{'sku': k, 'categoria': v, 'cargado_at': now} for k, v in code_cat_all.items()])
    logger.info('written: %d index rows, %d code->category rows', len(filas), len(code_cat_all))


if __name__ == '__main__':
    main()
