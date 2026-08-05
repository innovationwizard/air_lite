"""Odoo -> Supabase sync for the live Reyma model (INVENTARIOS / Alexis).

Phase-2 batch L1 of docs/inventarios/ALEXIS_REYMA_LIVE_PLAN.md. Populates the
reyma_* tables (schema 20260805000001) that feed the phase-1 engine
(frontend .../inventarios/reyma/engine.ts, 2,752/2,752 xlsx parity) on live data.

Design decisions (all grounded in docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md
and the 2026-08-05 prod probes; nothing here is guessed):
  - Scope = reyma_products rows (en_alcance). First run seeds them from the
    phase-1 extraction (data.json, 55 codes) — clave/descripcion/categoria/
    precio_factura come verbatim from Alexis' workbook; Odoo refreshes
    nombre/cubicaje(volume)/uom/activo each run. 77201028 is EXCLUDED by
    design: in Odoo it is a real TENEDOR, not a Mariel alias (probe 2026-08-05).
  - Bodegas (probe-verified): SJ=1CET/Existencias, PAT=1CET/Entrada (same
    patio rule Wilmer confirmed), Z11=2Z11/Existencias, PET=3PET/Existencias,
    ZAC=4ZAC/Existencias. Stock found in OTHER internal locations (tiendas,
    subcontract, MERMA...) is reported as an info issue, never silently dropped.
  - Pendientes por surtir = sale.order.line with qty_delivered < product_uom_qty
    (states sale/done). stock.move is NOT readable by this user (verified
    2026-08-05: Fault 4) and requesting more permissions is unnecessary: the
    SO-line definition matches Alexis' own words ("despachos de ventas
    pendientes de despacho") and its date_order drives the edad. Stored as
    DETAIL with edad_dias; Alexis' rule "solo cuentan <= 8 dias" (RESPUESTAS
    rule 3) is applied by the API, not baked into the data. Flagged as an
    assumption to validate against Alexis' PENDIENTES X SURTIR report during
    the parallel-run.
  - Transito = purchase.order.line of partner 23188 (PLASTICOS ADHERIBLES DEL
    BAJIO — probe: the only Reyma partner with POs), state 'purchase',
    qty_invoiced - qty_received > 0. MEASURED 2026-08-05: in Alexis' model a
    furgon en transito IS an invoice not yet received (furgon = factura, his
    SALDOS sheet); ordered-received on Reyma POs is a 242k-caja never-cleaned
    backlog while invoiced-received = 2,936 cajas (plausible en-camino, July
    SALDOS had 3,587). Wilmer's future-date rule does NOT apply here:
    date_planned is unmaintained on Reyma POs (all 529 lines past-dated);
    es_fecha_pasada is stored as information only. destino from the PO picking
    type warehouse; destino Z11 => es_entrega_directa (RESPUESTAS rule 6).
    The un-invoiced OC balance (ordered - invoiced = saldo por despachar) is
    reported as an info issue; it feeds the L3 saldos view, not transit.
  - Ventas mensuales, dual source for cross-validation (probe: sale.order.line
    starts 2024-10; sales.history carries SAE 2023-25 per code x month x canal):
      fuente='sale_order'    : qty_delivered (NOT ordered qty — measured
                               2026-08-05: delivered tracks Alexis' own VENTAS
                               sheet closely, e.g. VT10 dic-25 7,754 vs his
                               7,377, while ordered says 11,487), states
                               sale/done, by create_date month, 2024-10 onward
                               (base UoM = caja/fardo). Residual deviation vs
                               his sheet (delivery-month attribution) is
                               reported by the cross-validation issue.
      fuente='sales_history' : quantity_24/quantity_25 summed across canal rows.
    Overlap months (2024-10..2025-12) exist in BOTH sources on purpose; the
    API's source-resolution rule is documented there. Mean overlap deviation
    is reported as an info issue each run.

The sync fails neither loudly-nor-uselessly nor silently: anomalies land in
sync_issues with severity + odoo_id (SOP §12); an empty issue list is evidence.

Usage:
    set -a; source .env.prod; set +a
    python3 ml/odoo_sync_reyma.py [--dry-run]
"""

import argparse
import json
import logging
import os
import sys
import urllib.parse
import urllib.request
import xmlrpc.client
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', os.environ.get('NEXT_PUBLIC_SUPABASE_URL', ''))
SUPABASE_KEY = os.environ.get('SUPABASE_SECRET_KEY', '')

REYMA_PARTNER_ID = 23188          # PLASTICOS ADHERIBLES DEL BAJIO, S.A. DE C.V. (probe 2026-08-05)
EXCLUDED_CODES = {'77201028'}     # tenedor real en Odoo, no alias de Mariel (RESPUESTAS rule 7)
ORDERED_STATES = ['sale', 'done']  # same flagged assumption as the Wilmer sync
SALE_ORDER_FROM = '2024-10-01'    # probe: sale.order.line has no data before 2024-10

# bodega <- location complete_name (content-bound; probe-verified 2026-08-05)
LOCATION_TO_BODEGA = {
    '1CET/Existencias': 'SJ',
    '1CET/Entrada': 'PAT',
    '2Z11/Existencias': 'Z11',
    '3PET/Existencias': 'PET',
    '4ZAC/Existencias': 'ZAC',
}
# destino de PO <- picking type warehouse code prefix
PICKING_WH_TO_DESTINO = {'1': 'SJ', '2': 'Z11', '3': 'PET', '4': 'ZAC'}

SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
HISTORY_YEAR_FIELDS = {'quantity_24': 2024, 'quantity_25': 2025}

REPO = Path(__file__).resolve().parents[1]
SEED_JSON = REPO / 'frontend/src/app/(authenticated)/inventarios/reyma/data.json'

SUPABASE_BATCH = 500


# ─── Odoo client (same shape as odoo_sync_reabastecimiento) ──────────────────

def connect_odoo():
    if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
        logger.error('Missing Odoo env vars: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY')
        sys.exit(1)
    common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
    if not uid:
        logger.error('Odoo authentication failed')
        sys.exit(1)
    models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)
    logger.info('Odoo connected: uid=%s db=%s', uid, ODOO_DB)

    def execute(model, method, *args, **kwargs):
        return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)

    return execute


def odoo_read_all(execute, model, domain, fields, page=1000):
    out = []
    offset = 0
    while True:
        batch = execute(model, 'search_read', domain, fields=fields, limit=page, offset=offset)
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


# ─── Supabase REST ───────────────────────────────────────────────────────────

def sb_request(method, path, data=None, prefer='return=minimal'):
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', prefer)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def sb_get_all(path_base, page=1000):
    out = []
    offset = 0
    sep = '&' if '?' in path_base else '?'
    while True:
        batch = sb_request('GET', f'{path_base}{sep}limit={page}&offset={offset}')
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


def sb_insert_batched(table, rows, on_conflict=None):
    if not rows:
        return
    prefer = 'return=minimal'
    path = table
    if on_conflict:
        prefer += ',resolution=merge-duplicates'
        path = f'{table}?on_conflict={on_conflict}'
    for i in range(0, len(rows), SUPABASE_BATCH):
        sb_request('POST', path, rows[i:i + SUPABASE_BATCH], prefer=prefer)


class Issues:
    def __init__(self):
        self.rows = []

    def add(self, severity, entity, message, odoo_id=None):
        self.rows.append({'severity': severity, 'entity': entity, 'message': message,
                          'odoo_id': str(odoo_id) if odoo_id is not None else None})
        log = logger.warning if severity in ('warning', 'error') else logger.info
        log('[issue:%s] %s: %s', severity, entity, message)

    def has_errors(self):
        return any(r['severity'] == 'error' for r in self.rows)


# ─── Steps ───────────────────────────────────────────────────────────────────

def load_or_seed_products(issues, dry_run):
    """Scope = reyma_products. Empty table -> seed from the phase-1 extraction."""
    rows = sb_get_all('reyma_products?select=codigo,clave,descripcion,categoria,precio_factura,en_alcance')
    if rows:
        return {r['codigo']: r for r in rows if r['en_alcance']}
    logger.info('reyma_products empty — seeding from phase-1 data.json (55 códigos del xlsx)')
    data = json.loads(SEED_JSON.read_text())
    seed = []
    for r in data['modelo']['rows']:
        if r['cod'] in EXCLUDED_CODES:
            continue
        seed.append({
            'codigo': r['cod'], 'clave': r['clave'], 'descripcion': r['desc'],
            'categoria': r['cat'], 'categoria_fuente': 'xlsx',
            'cubicaje': r['cub'], 'precio_factura': r['precio'] if r['precio'] else None,
        })
    issues.add('info', 'product',
               f'Seed inicial: {len(seed)} códigos desde el xlsx de julio (fase 1, SHA '
               f"{data['provenance']['sourceSha256'][:8]}…); categoría fuente=xlsx hasta P7.")
    if not dry_run:
        sb_insert_batched('reyma_products', seed, on_conflict='codigo')
    return {r['codigo']: r for r in seed}


def sync_products(execute, scope, issues, dry_run, sync_id):
    prods = odoo_read_all(execute, 'product.product',
                          [['default_code', 'in', list(scope)]],
                          ['default_code', 'name', 'categ_id', 'uom_id', 'volume', 'active'])
    by_code = {p['default_code']: p for p in prods}
    updates = []
    for cod, srow in scope.items():
        p = by_code.get(cod)
        if not p:
            issues.add('warning', 'product', f'{cod} no existe en Odoo — se mantiene con datos del xlsx', cod)
            continue
        if not p['active']:
            issues.add('warning', 'product', f'{cod} está INACTIVO en Odoo', p['id'])
        vol = float(p['volume'] or 0)
        seed_cub = float(srow.get('cubicaje') or 0)
        if vol == 0:
            issues.add('warning', 'product',
                       f'{cod} volume=0 en Odoo (xlsx cubicaje={seed_cub}) — '
                       'sin cubicaje no entra al cálculo de furgones', p['id'])
        elif seed_cub and abs(vol - seed_cub) > 1e-6:
            issues.add('info', 'product',
                       f'{cod} cubicaje difiere: Odoo {vol} vs xlsx {seed_cub} — se usa Odoo', p['id'])
        updates.append({
            'codigo': cod,
            'odoo_product_id': p['id'],
            'nombre_odoo': p['name'],
            'cubicaje': vol if vol else seed_cub,
            'uom': p['uom_id'][1] if p['uom_id'] else None,
            'activo': bool(p['active']),
            'source_sync_id': sync_id,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        })
    if not dry_run:
        # PATCH per row: partial update must not clobber seeded xlsx fields
        for u in updates:
            cod = u.pop('codigo')
            sb_request('PATCH', f'reyma_products?codigo=eq.{urllib.parse.quote(cod)}', u)
    logger.info('products: %d matched in Odoo / %d in scope', len(updates), len(scope))
    return {p['default_code']: p['id'] for p in prods if p['default_code'] in scope}


def sync_stock(execute, code_to_opid, issues, dry_run, sync_id):
    opid_to_code = {v: k for k, v in code_to_opid.items()}
    locs = odoo_read_all(execute, 'stock.location', [['usage', '=', 'internal']],
                         ['id', 'complete_name'])
    loc_to_bodega, known_ids = {}, set()
    for loc in locs:
        b = LOCATION_TO_BODEGA.get(loc['complete_name'])
        if b:
            loc_to_bodega[loc['id']] = b
            known_ids.add(loc['id'])
    missing = set(LOCATION_TO_BODEGA) - {l['complete_name'] for l in locs}
    if missing:
        issues.add('error', 'stock', f'Ubicaciones mapeadas no encontradas en Odoo: {sorted(missing)}')
    quants = odoo_read_all(execute, 'stock.quant',
                           [['product_id', 'in', list(opid_to_code)],
                            ['location_id.usage', '=', 'internal']],
                           ['product_id', 'location_id', 'quantity', 'reserved_quantity'])
    agg = defaultdict(lambda: {'cantidad': 0.0, 'reservada': 0.0})
    unmapped = defaultdict(float)
    for q in quants:
        cod = opid_to_code[q['product_id'][0]]
        b = loc_to_bodega.get(q['location_id'][0])
        if b is None:
            unmapped[q['location_id'][1]] += float(q['quantity'] or 0)
            continue
        agg[(cod, b)]['cantidad'] += float(q['quantity'] or 0)
        agg[(cod, b)]['reservada'] += float(q['reserved_quantity'] or 0)
    for name, qty in sorted(unmapped.items(), key=lambda kv: -abs(kv[1]))[:20]:
        issues.add('info', 'stock',
                   f'Stock Reyma fuera de bodegas mapeadas: {name} = {qty:.1f} (tiendas/subcontrata/etc; no se cuenta)')
    rows = [{'sync_id': sync_id, 'codigo': cod, 'bodega': b,
             'cantidad': v['cantidad'], 'reservada': v['reservada']}
            for (cod, b), v in agg.items()]
    if not dry_run:
        sb_insert_batched('reyma_stock', rows)
    logger.info('stock: %d filas código×bodega (%d quants leídos, %d ubicaciones sin mapear)',
                len(rows), len(quants), len(unmapped))
    return len(rows)


def sync_pendientes(execute, code_to_opid, issues, dry_run, sync_id):
    """Pendiente = SO line qty ordered − delivered (stock.move unreadable for
    this user; SO-line definition matches Alexis' words — see module docstring)."""
    opid_to_code = {v: k for k, v in code_to_opid.items()}
    from datetime import timedelta
    desde = (datetime.now(timezone.utc) - timedelta(days=60)).strftime('%Y-%m-%d')
    lines = odoo_read_all(
        execute, 'sale.order.line',
        [['product_id', 'in', list(opid_to_code)],
         ['state', 'in', ORDERED_STATES],
         ['create_date', '>=', desde]],  # 60d window: Odoo auto-cancela ~2 meses; la regla de 8 días descarta lo viejo
        ['product_id', 'product_uom_qty', 'qty_delivered', 'order_id', 'create_date'])
    pend_lines = [l for l in lines
                  if float(l['product_uom_qty'] or 0) - float(l['qty_delivered'] or 0) > 1e-6]
    order_ids = sorted({l['order_id'][0] for l in pend_lines})
    orders = odoo_read_all(execute, 'sale.order', [['id', 'in', order_ids]],
                           ['name', 'date_order', 'warehouse_id']) if order_ids else []
    ometa = {o['id']: o for o in orders}
    now = datetime.now(timezone.utc)
    rows = []
    for l in pend_lines:
        o = ometa.get(l['order_id'][0], {})
        fecha = (o.get('date_order') or l['create_date'] or '').replace(' ', 'T')
        edad = None
        if fecha:
            edad = round((now - datetime.fromisoformat(fecha).replace(tzinfo=timezone.utc)).total_seconds() / 86400, 2)
        wh = o['warehouse_id'][1] if o.get('warehouse_id') else ''
        bodega = PICKING_WH_TO_DESTINO.get(wh.strip()[:1])
        rows.append({
            'sync_id': sync_id,
            'codigo': opid_to_code[l['product_id'][0]],
            'picking': o.get('name'),
            'bodega_origen': bodega,
            'fecha_programada': (fecha + 'Z') if fecha else None,
            'cantidad': round(float(l['product_uom_qty'] or 0) - float(l['qty_delivered'] or 0), 4),
            'edad_dias': edad,
        })
    viejos = sum(1 for r in rows if r['edad_dias'] is not None and r['edad_dias'] > 8)
    issues.add('info', 'pendientes',
               f'{len(rows)} líneas de venta pendientes de despacho (fuente sale.order.line: '
               f'stock.move no legible para este usuario); {viejos} con edad > 8 días '
               '(regla Alexis: el API las excluye del cálculo, aquí quedan visibles). '
               'Definición a validar vs el reporte PENDIENTES X SURTIR en el parallel-run.')
    if not dry_run:
        sb_insert_batched('reyma_pendientes', rows)
    logger.info('pendientes: %d líneas SO con cantidad pendiente', len(rows))
    return len(rows)


def sync_transito(execute, code_to_opid, issues, dry_run, sync_id):
    opid_to_code = {v: k for k, v in code_to_opid.items()}
    lines = odoo_read_all(
        execute, 'purchase.order.line',
        [['order_id.partner_id', '=', REYMA_PARTNER_ID],
         ['order_id.state', '=', 'purchase'],
         ['product_id', 'in', list(opid_to_code)]],
        ['order_id', 'product_id', 'product_qty', 'qty_received', 'qty_invoiced', 'date_planned'])
    order_ids = sorted({l['order_id'][0] for l in lines})
    orders = odoo_read_all(execute, 'purchase.order', [['id', 'in', order_ids]],
                           ['name', 'picking_type_id']) if order_ids else []
    order_meta = {}
    for o in orders:
        pt_name = o['picking_type_id'][1] if o.get('picking_type_id') else ''
        destino = PICKING_WH_TO_DESTINO.get(pt_name.strip()[:1])
        if destino is None:
            destino = 'SJ'
            # never silent: unknown destination reported and defaulted conservatively
        order_meta[o['id']] = (o['name'], destino, pt_name)
    today = date.today().isoformat()
    rows, pasadas = [], 0
    saldo_oc = 0.0  # ordered − invoiced: aún no despachado por el proveedor (NO es tránsito)
    for l in lines:
        inv = float(l['qty_invoiced'] or 0)
        rec = float(l['qty_received'] or 0)
        saldo_oc += max(0.0, float(l['product_qty'] or 0) - inv)
        pend = inv - rec  # tránsito Alexis: facturado (furgón despachado) no recibido
        if pend <= 1e-6:
            continue
        name, destino, pt_name = order_meta.get(l['order_id'][0], (l['order_id'][1], 'SJ', '?'))
        if destino == 'SJ' and not pt_name.startswith('1'):
            issues.add('warning', 'transit',
                       f'PO {name}: picking type {pt_name!r} sin destino conocido — asumido SJ', l['order_id'][0])
        fecha = (l['date_planned'] or '')[:10] or None
        pasada = bool(fecha and fecha < today)
        pasadas += 1 if pasada else 0
        rows.append({
            'sync_id': sync_id,
            'codigo': opid_to_code[l['product_id'][0]],
            'po_name': name,
            'fecha_planeada': fecha,
            'cantidad_pendiente': round(pend, 4),
            'destino': destino,
            'es_entrega_directa': destino == 'Z11',
            'es_fecha_pasada': pasada,
        })
    issues.add('info', 'transit',
               f'Saldo OC sin facturar (pedido − facturado, no es tránsito): {saldo_oc:,.0f} cajas '
               'en POs Adheribles abiertas — insumo de la vista de saldos (L3)')
    # products the supplier ships that are NOT in scope — visibility, not silence
    all_lines = execute('purchase.order.line', 'search_count',
                        [['order_id.partner_id', '=', REYMA_PARTNER_ID],
                         ['order_id.state', '=', 'purchase'],
                         ['product_id', 'not in', list(opid_to_code)]])
    if all_lines:
        issues.add('info', 'transit',
                   f'{all_lines} líneas de PO Adheribles con productos FUERA del alcance Reyma actual '
                   '(revisar si Alexis agregó productos nuevos)')
    if pasadas:
        issues.add('info', 'transit',
                   f'{pasadas} líneas de tránsito (facturado-no-recibido) con date_planned pasada — '
                   'informativo: en Reyma las fechas de PO no se mantienen; el tránsito facturado cuenta igual')
    directas = sum(1 for r in rows if r['es_entrega_directa'])
    logger.info('transito: %d líneas facturadas-no-recibidas (%d entrega directa, %d fecha pasada)',
                len(rows), directas, pasadas)
    if not dry_run:
        sb_insert_batched('reyma_transito', rows)
    return len(rows)


def sync_ventas(execute, code_to_opid, issues, dry_run, sync_id):
    opid_to_code = {v: k for k, v in code_to_opid.items()}
    # fuente 1: sale.order.line (2024-10 onward)
    lines = odoo_read_all(
        execute, 'sale.order.line',
        [['product_id', 'in', list(opid_to_code)],
         ['state', 'in', ORDERED_STATES],
         ['create_date', '>=', SALE_ORDER_FROM]],
        ['product_id', 'qty_delivered', 'create_date'])
    so_agg = defaultdict(float)
    for l in lines:
        cod = opid_to_code[l['product_id'][0]]
        d = l['create_date'][:7]  # YYYY-MM
        so_agg[(cod, int(d[:4]), int(d[5:7]))] += float(l['qty_delivered'] or 0)
    so_rows = [{'codigo': c, 'anio': a, 'mes': m, 'cajas': round(v, 4), 'fuente': 'sale_order',
                'source_sync_id': sync_id, 'updated_at': datetime.now(timezone.utc).isoformat()}
               for (c, a, m), v in so_agg.items()]

    # fuente 2: sales.history (SAE; per code x month(name) x canal, quantity_24/25)
    sh_rows = []
    try:
        hist = odoo_read_all(execute, 'sales.history',
                             [['code', 'in', list(code_to_opid)]],
                             ['code', 'month'] + list(HISTORY_YEAR_FIELDS))
        sh_agg = defaultdict(float)
        bad_months = set()
        for h in hist:
            mname = str(h.get('month') or '').strip().lower()
            if mname not in SPANISH_MONTHS:
                bad_months.add(mname)
                continue
            mes = SPANISH_MONTHS.index(mname) + 1
            for f, anio in HISTORY_YEAR_FIELDS.items():
                sh_agg[(h['code'], anio, mes)] += float(h.get(f) or 0)
        if bad_months:
            issues.add('warning', 'sales', f'sales.history con meses no interpretables: {sorted(bad_months)[:5]}')
        sh_rows = [{'codigo': c, 'anio': a, 'mes': m, 'cajas': round(v, 4), 'fuente': 'sales_history',
                    'source_sync_id': sync_id, 'updated_at': datetime.now(timezone.utc).isoformat()}
                   for (c, a, m), v in sh_agg.items()]
    except Exception as e:  # model unavailable -> flagged, sale_order still lands
        issues.add('warning', 'sales', f'sales.history no disponible ({type(e).__name__}) — solo fuente sale_order')

    # cross-validation on the overlap (2024-10..2025-12)
    overlap = [(k, so_agg[k]) for k in so_agg
               if (k[1] == 2024 and k[2] >= 10) or k[1] == 2025]
    if overlap and sh_rows:
        # compare only months where sales_history actually has data (SAE ends ~Mar-2025)
        sh_idx = {(r['codigo'], r['anio'], r['mes']): r['cajas'] for r in sh_rows if r['cajas'] > 0}
        diffs = [abs(v - sh_idx[k]) for k, v in overlap if k in sh_idx]
        if diffs:
            issues.add('info', 'sales',
                       f'Validación cruzada sale_order(delivered) vs sales_history en {len(diffs)} '
                       f'meses-código con datos en ambas fuentes: desviación media '
                       f'{sum(diffs) / len(diffs):.1f} cajas')
    if not dry_run:
        sb_insert_batched('reyma_ventas_mensuales', so_rows + sh_rows, on_conflict='codigo,anio,mes,fuente')
    logger.info('ventas: %d meses-código sale_order + %d sales_history (de %d líneas SO)',
                len(so_rows), len(sh_rows), len(lines))
    return len(so_rows) + len(sh_rows)


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    dry = args.dry_run
    if not dry and not all([SUPABASE_URL, SUPABASE_KEY]):
        logger.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY')
        sys.exit(1)

    execute = connect_odoo()
    issues = Issues()

    sync_id = None
    if not dry:
        run = sb_request('POST', 'sync_runs',
                         {'kind': 'reyma', 'status': 'running'}, prefer='return=representation')
        sync_id = run[0]['id']
        logger.info('sync_run %s started', sync_id)

    counts = {}
    try:
        scope = load_or_seed_products(issues, dry)
        code_to_opid = sync_products(execute, scope, issues, dry, sync_id)
        counts['products'] = len(code_to_opid)
        counts['stock'] = sync_stock(execute, code_to_opid, issues, dry, sync_id)
        counts['pendientes'] = sync_pendientes(execute, code_to_opid, issues, dry, sync_id)
        counts['transito'] = sync_transito(execute, code_to_opid, issues, dry, sync_id)
        counts['ventas'] = sync_ventas(execute, code_to_opid, issues, dry, sync_id)
        status = 'partial' if issues.has_errors() else 'success'
    except Exception:
        logger.exception('sync failed')
        status = 'failed'
        raise
    finally:
        if not dry and sync_id:
            sb_insert_batched('sync_issues', [{**r, 'sync_id': sync_id} for r in issues.rows])
            sb_request('PATCH', f'sync_runs?id=eq.{sync_id}',
                       {'finished_at': datetime.now(timezone.utc).isoformat(),
                        'status': status, 'counts': counts})
    logger.info('DONE status=%s counts=%s issues=%d%s', status, counts, len(issues.rows),
                ' (DRY RUN — nothing written)' if dry else '')


if __name__ == '__main__':
    main()
