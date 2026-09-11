"""
AI Refill Lite — Backtest Engine API
Deployed on Railway. Exposes HTTP endpoints for the Next.js frontend to trigger
backtest cycles and check status.
"""

import hmac
from datetime import datetime, timezone
import logging
import os
import threading
import xmlrpc.client

from flask import Flask, request, jsonify
from supabase import create_client

from backtest_engine import run_backtest_cycle
from purchase_scheduler import run_purchase_schedule_cycle
from forecast_revenue import forecast_product as forecast_product_revenue
from forecast_purchases_derived import forecast_purchases_derived
from pendiente_reserva import SEQUENCE_CODES, agrupar, picking_types_por_bodega
from reyma_factura_extract import PdfIlegible, extraer_de_bytes
from reyma_factura_carga import (
    DESTINOS_VALIDOS, DatoInvalido, Mapas, destino_in_band, evaluar,
    guia_de, lineas_de_factura, prefijo_de,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

ML_SERVICE_API_KEY = os.environ.get('ML_SERVICE_API_KEY', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SECRET_KEY = os.environ.get('SUPABASE_SECRET_KEY', '')


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def verify_api_key():
    """Verify the shared API key from the request header.

    Compares the caller-supplied ``X-API-Key`` header against the configured
    ``ML_SERVICE_API_KEY`` using a constant-time comparison. Fails closed: if no
    key is configured on the service, every request is rejected rather than
    silently allowed through.
    """
    if not ML_SERVICE_API_KEY:
        logger.error('ML_SERVICE_API_KEY is not configured; rejecting request')
        return False
    provided = request.headers.get('X-API-Key', '')
    return hmac.compare_digest(provided, ML_SERVICE_API_KEY)


@app.before_request
def authenticate():
    if request.endpoint == 'health':
        return None
    if not verify_api_key():
        return jsonify({'error': 'Unauthorized'}), 401


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'air-lite-ml'})


@app.route('/backtest/run', methods=['POST'])
def run_backtest():
    """
    Trigger a new backtest cycle.

    Request body:
        training_months: int — number of months to use for training (min 3)
        max_products: int — max products to model (default 100)
        holding_cost_rate: float — annual holding cost rate (default 0.25)

    The backtest runs asynchronously. Returns the run_id immediately
    so the frontend can poll /backtest/status/<run_id> for progress.
    """
    data = request.get_json()
    if not data or 'training_months' not in data:
        return jsonify({'error': 'training_months is required'}), 400

    training_months = int(data['training_months'])
    if training_months < 3:
        return jsonify({'error': 'training_months must be >= 3'}), 400

    max_products = int(data.get('max_products', 100))
    holding_cost_rate = float(data.get('holding_cost_rate', 0.25))

    logger.info(
        'Backtest requested: training_months=%d, max_products=%d, holding_cost_rate=%.2f',
        training_months, max_products, holding_cost_rate,
    )

    # Run backtest in background thread (Railway has no timeout)
    # The engine creates its own run record and returns the run_id
    result_holder = {'run_id': None}

    def _run():
        try:
            sb = get_supabase()
            result = run_backtest_cycle(sb, training_months, max_products, holding_cost_rate)
            result_holder['run_id'] = result['run_id']
        except Exception as e:
            logger.error('Background backtest failed: %s', e)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    # Wait briefly for the run record to be created so we can return the run_id
    thread.join(timeout=5)

    return jsonify({
        'run_id': result_holder.get('run_id'),
        'status': 'running',
        'message': 'Backtest iniciado. Consulte /backtest/status/{run_id} para ver el progreso.',
    }), 202


@app.route('/backtest/run-all', methods=['POST'])
def run_all_backtests():
    """
    Pre-compute all available backtest cycles sequentially.
    Data spans Oct 2024 – Mar 2026 (18 months).
    With 3-month minimum training: 14 cycles (predict Jan 2025 through Feb 2026).

    Runs synchronously — Railway has no timeout limit.
    """
    data = request.get_json() or {}
    max_products = int(data.get('max_products', 100))
    holding_cost_rate = float(data.get('holding_cost_rate', 0.25))

    supabase = get_supabase()
    results = []
    errors = []

    # 14 cycles: training_months 3 through 16
    for training_months in range(3, 17):
        logger.info('=== Starting cycle: training_months=%d ===', training_months)
        try:
            result = run_backtest_cycle(
                supabase, training_months, max_products, holding_cost_rate,
            )
            results.append({
                'training_months': training_months,
                'run_id': result['run_id'],
                'status': 'completed',
                'products_modeled': result['products_modeled'],
                'duration_ms': result['duration_ms'],
            })
            logger.info(
                'Cycle %d completed: run_id=%d, %d products, %dms',
                training_months, result['run_id'],
                result['products_modeled'], result['duration_ms'],
            )
        except Exception as e:
            logger.error('Cycle %d failed: %s', training_months, e)
            errors.append({
                'training_months': training_months,
                'error': str(e),
            })

    return jsonify({
        'total_cycles': len(results) + len(errors),
        'completed': len(results),
        'failed': len(errors),
        'results': results,
        'errors': errors,
    })


@app.route('/backtest/purchase-schedule-all', methods=['POST'])
def run_all_purchase_schedules():
    """
    Pre-compute all weekly purchase schedule cycles for Carvajal + Reyma.

    Training starts at 3 months (Oct-Dec 2024), then adds 1 week at a time.
    Each cycle forecasts one week of purchase recommendations.
    Runs synchronously — Railway has no timeout limit.
    """
    data = request.get_json() or {}
    max_inventory_days = int(data.get('max_inventory_days', 14))

    supabase = get_supabase()
    results = []
    errors = []

    # Check how many cycles already completed to resume from where we left off
    existing = supabase.table('purchase_schedule_runs').select(
        'id', count='exact'
    ).eq('status', 'completed').execute()
    start_offset = existing.count if existing.count else 0

    training_months = 3
    week_offset = start_offset
    max_weeks = 70  # Safety limit

    logger.info('Resuming from week_offset=%d (%d already completed)', week_offset, start_offset)

    while week_offset < max_weeks:
        logger.info('=== Purchase schedule: week_offset=%d ===', week_offset)
        try:
            result = run_purchase_schedule_cycle(
                supabase, training_months, week_offset, max_inventory_days,
            )
            if result is None:
                logger.info('No more data available at week_offset=%d, stopping', week_offset)
                break

            results.append(result)
            logger.info(
                'Week %d completed: run_id=%d, %d products, %.0f units, %dms',
                week_offset, result['run_id'],
                result['products_scheduled'], result['total_units'],
                result['duration_ms'],
            )
        except Exception as e:
            logger.error('Week %d failed: %s', week_offset, e)
            errors.append({
                'week_offset': week_offset,
                'error': str(e),
            })

        week_offset += 1

    return jsonify({
        'total_cycles': len(results) + len(errors),
        'completed': len(results),
        'failed': len(errors),
        'results': results,
        'errors': errors,
    })


@app.route('/backtest/status/<int:run_id>', methods=['GET'])
def backtest_status(run_id: int):
    """Check the status of a backtest run."""
    supabase = get_supabase()
    result = supabase.table('backtest_runs').select('*').eq('id', run_id).execute()

    if not result.data:
        return jsonify({'error': 'Run not found'}), 404

    run = result.data[0]

    response = {
        'run_id': run_id,
        'status': run['status'],
        'training_start_date': run['training_start_date'],
        'training_end_date': run['training_end_date'],
        'prediction_month': run['prediction_month'],
        'products_modeled': run['products_modeled'],
        'training_duration_ms': run['training_duration_ms'],
    }

    # If completed, include savings summary
    if run['status'] == 'completed':
        savings_result = supabase.table('backtest_savings').select('*').eq('run_id', run_id).execute()
        if savings_result.data:
            response['savings'] = savings_result.data[0]

    if run['status'] == 'failed':
        response['error_message'] = run.get('error_message')

    return jsonify(response)


@app.route('/forecast/revenue-daily', methods=['POST'])
def forecast_revenue_daily():
    """
    Train Prophet on revenue_daily_for_ml and predict a custom window.

    Distinct from /backtest/run which trains on demand_daily (old SSOT).
    Reads revenue_daily_for_ml (October 2024 purchase anomaly smoothed out).
    revenue_daily is never read here — it holds acid-test data only.

    Body:
      {
        "product_id": int,          # Supabase products.id
        "ssot_label": str,          # e.g. "aml_income_posted_invoice_refund_neg_invoice_date_c40"
        "metric": str,              # "sales" | "purchases_ordered" | "purchases_received"
        "training_start": "YYYY-MM-DD",  # defaults to 2024-10-01
        "training_end":   "YYYY-MM-DD",  # e.g. "2026-01-31" for Feb+Mar prediction
        "prediction_end": "YYYY-MM-DD"   # e.g. "2026-03-31"
      }

    Synchronous (a single product trains in a few seconds). Returns daily +
    monthly predictions with yhat / yhat_lower / yhat_upper.
    """
    from datetime import date as date_cls
    data = request.get_json() or {}

    required = ('product_id', 'ssot_label', 'metric', 'training_end', 'prediction_end')
    missing = [k for k in required if k not in data]
    if missing:
        return jsonify({'error': f'missing required fields: {missing}'}), 400

    try:
        product_id = int(data['product_id'])
        ssot_label = str(data['ssot_label'])
        metric = str(data['metric'])
        training_start = date_cls.fromisoformat(data.get('training_start', '2024-10-01'))
        training_end = date_cls.fromisoformat(data['training_end'])
        prediction_end = date_cls.fromisoformat(data['prediction_end'])
    except (ValueError, TypeError) as e:
        return jsonify({'error': f'invalid input: {e}'}), 400

    if training_end < training_start:
        return jsonify({'error': 'training_end must be >= training_start'}), 400
    if prediction_end <= training_end:
        return jsonify({'error': 'prediction_end must be after training_end'}), 400

    supabase = get_supabase()
    result = forecast_product_revenue(
        supabase=supabase,
        product_id=product_id,
        ssot_label=ssot_label,
        metric=metric,
        training_start=training_start,
        training_end=training_end,
        prediction_end=prediction_end,
    )
    # Echo request for audit
    result['request'] = {
        'product_id': product_id,
        'ssot_label': ssot_label,
        'metric': metric,
        'training_start': training_start.isoformat(),
        'training_end': training_end.isoformat(),
        'prediction_end': prediction_end.isoformat(),
    }
    return jsonify(result)


@app.route('/forecast/purchases-derived', methods=['POST'])
def forecast_purchases_derived_endpoint():
    """
    Derive purchase forecast from persisted sales forecast × per-SKU ratio.

    Must be called AFTER /forecast/revenue-daily has persisted a sales forecast
    for the same product_id and training_end_date into forecast_results.
    The two-pass orchestration in route.ts guarantees this order.

    Body (same fields as /forecast/revenue-daily):
      {
        "product_id":     int,          # Supabase products.id
        "ssot_label":     str,          # purchase SSOT label
        "metric":         str,          # "purchases_ordered" | "purchases_received"
        "training_start": "YYYY-MM-DD", # defaults to 2024-10-01
        "training_end":   "YYYY-MM-DD",
        "prediction_end": "YYYY-MM-DD"
      }

    Returns:
      status        "ok_derived" | "insufficient_ratio_data" | "no_sales_forecast"
      monthly       [{month, yhat_sum, yhat_lower_sum, yhat_upper_sum}, ...]
      ratio_detail  Audit trail: R, months_used, months_excluded, ratios_used/excluded
    """
    from datetime import date as date_cls
    data = request.get_json() or {}

    required = ('product_id', 'ssot_label', 'metric', 'training_end', 'prediction_end')
    missing = [k for k in required if k not in data]
    if missing:
        return jsonify({'error': f'missing required fields: {missing}'}), 400

    try:
        product_id     = int(data['product_id'])
        ssot_label     = str(data['ssot_label'])
        metric         = str(data['metric'])
        training_start = date_cls.fromisoformat(data.get('training_start', '2024-10-01'))
        training_end   = date_cls.fromisoformat(data['training_end'])
        prediction_end = date_cls.fromisoformat(data['prediction_end'])
    except (ValueError, TypeError) as e:
        return jsonify({'error': f'invalid input: {e}'}), 400

    if training_end < training_start:
        return jsonify({'error': 'training_end must be >= training_start'}), 400
    if prediction_end <= training_end:
        return jsonify({'error': 'prediction_end must be after training_end'}), 400

    forecast_months = _enumerate_forecast_months(training_end, prediction_end)

    supabase = get_supabase()
    result = forecast_purchases_derived(
        supabase=supabase,
        product_id=product_id,
        metric=metric,
        ssot_label=ssot_label,
        training_start=training_start,
        training_end=training_end,
        forecast_months=forecast_months,
    )
    result['request'] = {
        'product_id':     product_id,
        'ssot_label':     ssot_label,
        'metric':         metric,
        'training_start': training_start.isoformat(),
        'training_end':   training_end.isoformat(),
        'prediction_end': prediction_end.isoformat(),
    }
    return jsonify(result)


# Tamaño máximo del PDF aceptado. Las facturas de REYMA pesan ~1.5 MB; 15 MB
# deja margen de sobra para una de muchas páginas sin abrir la puerta a que un
# archivo cualquiera consuma el worker.
REYMA_PDF_MAX_BYTES = 15 * 1024 * 1024


def _mapas_reyma():
    """Los dos catálogos que las reglas de carga necesitan leer. Solo lectura."""
    sb = get_supabase()

    por_clave = {}
    for p in sb.table('reyma_products').select('clave, codigo').execute().data or []:
        if p.get('clave'):
            por_clave.setdefault(p['clave'], set()).add(p['codigo'])

    # Cruce resuelto por Alexis en /inventarios/facturas/pendientes
    # (20260909000001): append-only, última fila por clave manda. Se aplica
    # DESPUÉS del seed de julio y GANA — es la decisión más reciente sobre esa
    # clave — sin tocar `reyma_products.clave`, que sigue sirviendo a las
    # claves ya buenas del xlsx original.
    resueltas = (sb.table('reyma_clave_map')
                   .select('clave, codigo, created_at')
                   .order('created_at', desc=True).execute().data or [])
    vistas = set()
    for c in resueltas:
        if c['clave'] in vistas:
            continue
        vistas.add(c['clave'])
        por_clave[c['clave']] = {c['codigo']}

    # Tablita de Alexis: append-only, la última fila por código manda.
    rollos = {}
    filas = (sb.table('reyma_conversion_bulto')
               .select('codigo, rollos_por_bulto')
               .order('created_at', desc=True).execute().data or [])
    for c in filas:
        rollos.setdefault(c['codigo'], float(c['rollos_por_bulto']))

    return Mapas(por_clave=por_clave, rollos_por_bulto=rollos)


@app.route('/reyma/factura/preview', methods=['POST'])
def reyma_factura_preview():
    """
    Lee UNA factura CFDI de REYMA y evalúa las reglas de carga, SIN escribir.

    Es el paso 1 de la carga en la app (A12): la página de Alexis manda el PDF,
    esto devuelve lo que el documento dice y qué pasaría al cargarlo; Next.js
    persiste el veredicto y hace el write cuando Alexis confirma destino y ETA.

    El write NO ocurre acá a propósito: quien tiene la sesión — y por tanto el
    `autor` del dato — es Next.js. Este servicio sólo lee.

    Entrada: multipart con el campo `pdf` (o `application/pdf` crudo en el body).
    Opcional: `destino` (form field) para evaluar contra un destino concreto;
    sin él se evalúa contra el destino in-band si la factura lo declara, y si no
    lo declara la evaluación de líneas se hace igual con un destino provisional
    que la página reemplaza al confirmar.
    """
    archivo = request.files.get('pdf')
    if archivo is not None:
        nombre = archivo.filename or 'sin-nombre.pdf'
        datos = archivo.read()
    else:
        nombre = request.headers.get('X-Nombre-Archivo', 'sin-nombre.pdf')
        datos = request.get_data() or b''

    if not datos:
        return jsonify({'error': 'No se recibió ningún archivo'}), 400
    if len(datos) > REYMA_PDF_MAX_BYTES:
        return jsonify({
            'error': f'El archivo pesa {len(datos) / 1024 / 1024:.1f} MB; el máximo es '
                     f'{REYMA_PDF_MAX_BYTES // 1024 // 1024} MB',
        }), 413
    if not datos.startswith(b'%PDF'):
        return jsonify({'error': 'El archivo no es un PDF'}), 415

    try:
        cab = extraer_de_bytes(nombre, datos)
    except PdfIlegible as e:
        logger.warning('reyma preview: PDF ilegible (%s): %s', nombre, e)
        return jsonify({'error': f'No se pudo leer el PDF: {e}'}), 422

    # Sin cabecera no hay factura que cargar — se responde 200 con el veredicto
    # (no es un fallo del servicio; es un documento que no sirve) para que la
    # página lo muestre en ámbar en vez de un error genérico.
    if not cab.get('factura') or not cab.get('folio_fiscal'):
        return jsonify({
            'ok': False,
            'archivo': nombre,
            'sha256': cab.get('sha256'),
            'cuadra': False,
            'flags': cab.get('flags', []),
            'errores': ['El documento no parece una factura de REYMA: no trae '
                        'FACTURA: Fnnnnnn ni Folio Fiscal.'],
            'cabecera': None, 'lineas': [], 'filas': [], 'retenidas': [],
        }), 200

    try:
        guia = guia_de(nombre)
        prefijo = prefijo_de(guia)
    except DatoInvalido:
        # El correlativo de furgón vive en el nombre del archivo. Alexis manda
        # los PDFs con el nombre que le da REYMA (G-236-2026 …), pero si el
        # nombre se perdió no se inventa: se dice y la página lo pide.
        guia, prefijo = None, None

    declarado = (request.form.get('destino') or '').strip() or None
    if declarado and declarado not in DESTINOS_VALIDOS:
        return jsonify({'error': f'destino inválido: {declarado}'}), 400

    in_band = destino_in_band(cab.get('observ_destino'))

    resultado = None
    if prefijo:
        # Para la evaluación de LÍNEAS el destino sólo importa por la
        # verificación contra Observaciones; se evalúa con el declarado, o con
        # el in-band, o con el primero válido como provisional — la página
        # reemplaza el valor real al confirmar.
        provisional = declarado or in_band or DESTINOS_VALIDOS[0]
        try:
            resultado = evaluar(
                lineas_de_factura(cab), {prefijo: provisional}, {},
                'preview (sin autor — el write lo hace la app)', _mapas_reyma(),
            )
        except DatoInvalido as e:
            return jsonify({'error': str(e)}), 422

    errores = list(resultado.errores) if resultado else [
        'No se pudo leer el correlativo de furgón (G-nnn) del nombre del archivo.'
    ]

    return jsonify({
        'ok': not errores and not cab['flags'],
        'archivo': nombre,
        'sha256': cab['sha256'],
        'guia': guia,
        'cabecera': {
            'factura': cab['factura'], 'pv': cab['pv'],
            'folio_fiscal': cab['folio_fiscal'],
            'fecha': cab['fecha'], 'hora': cab['hora'],
            't_cambio': cab['t_cambio'], 'total': cab['total'],
            'suma_importes': cab['suma_importes'],
            'paginas': cab['paginas'], 'op': cab['op'],
            'oc_in_band': cab['oc'], 'conf': cab['conf'],
            'observ_destino': cab['observ_destino'],
            'destino_in_band': in_band,
        },
        # `cuadra` es la única señal de confianza que hace falta: el parseo es
        # determinístico (N1), así que o la aritmética del documento cierra o no.
        'cuadra': not cab['flags'],
        'flags': cab['flags'],
        'lineas': cab['lineas'],
        'filas': resultado.filas if resultado else [],
        'retenidas': resultado.retenidas if resultado else [],
        'errores': errores,
    })


# PLASTICOS ADHERIBLES DEL BAJIO, S.A. DE C.V. — el único proveedor REYMA con
# OCs (probe 2026-08-05, ml/odoo_sync_reyma.py:85). Duplicado acá a propósito
# en vez de importar ese módulo: es un script de sync batch (argparse, writes
# por lotes) y este archivo es un proceso Flask siempre corriendo — más simple
# no acoplar los dos.
REYMA_PARTNER_ID = 23188

_ODOO_URL = os.environ.get('ODOO_URL', '')
_ODOO_DB = os.environ.get('ODOO_DB', '')
_ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
_ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')


def _odoo_execute(model, method, *args, **kwargs):
    """
    Una conexión Odoo de UNA sola vez, para una request HTTP en vivo — no la
    conexión con reintentos de los scripts de sync (esos usan `sys.exit(1)` si
    fallan, que mataría este worker). Si Odoo no responde, el llamador lo ve
    como una excepción y responde 502; nunca se cae el proceso.

    SOLO LECTURA — search/search_read/fields_get. Nunca create/write/unlink
    (regla del CEO, ver ODOO_VERSION / .env.prod: creds verificadas
    read-only). Esta función no impone eso por código: lo impone que ningún
    llamador de este archivo pida otra cosa.
    """
    return _odoo_conectar()(model, method, *args, **kwargs)


def _odoo_conectar():
    """Autentica UNA vez y devuelve `execute(model, method, *args, **kwargs)`
    — para un endpoint que hace varias lecturas seguidas y no quiere pagar
    el `authenticate` en cada una. Mismas reglas que `_odoo_execute`."""
    if not all([_ODOO_URL, _ODOO_DB, _ODOO_USERNAME, _ODOO_API_KEY]):
        raise RuntimeError('Odoo no está configurado (ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_API_KEY)')
    common = xmlrpc.client.ServerProxy(f'{_ODOO_URL}/xmlrpc/2/common', allow_none=True)
    uid = common.authenticate(_ODOO_DB, _ODOO_USERNAME, _ODOO_API_KEY, {})
    if not uid:
        raise RuntimeError('Odoo rechazó la autenticación')
    models = xmlrpc.client.ServerProxy(f'{_ODOO_URL}/xmlrpc/2/object', allow_none=True)

    def execute(model, method, *args, **kwargs):
        return models.execute_kw(_ODOO_DB, uid, _ODOO_API_KEY, model, method, list(args), kwargs)

    return execute


@app.route('/reyma/productos/buscar', methods=['GET'])
def reyma_productos_buscar():
    """
    Busca en vivo en Odoo el producto que corresponde a una clave REYMA sin
    mapa — paso de resolución de /inventarios/facturas/pendientes (A12b).

    A propósito NO se llama desde `/reyma/factura/preview`: ese camino tiene
    que seguir funcionando aunque Odoo esté caído (hoy no depende de Odoo en
    absoluto), así que la búsqueda en vivo vive en un endpoint aparte que sólo
    se usa cuando Alexis está resolviendo, no cuando está subiendo el furgón.

    Dos fuentes, en este orden de confianza:
      1. `product.supplierinfo` de REYMA (partner 23188) cuyo `product_name`
         — la propia palabra de REYMA para el producto — contiene `q`. Es
         evidencia (tier 1 del diseño): si REYMA ya le puso ese nombre al
         producto en Odoo, es la señal más fuerte que existe.
      2. `product.template` en general (nombre o código) — por si el producto
         es nuevo también para el lado REYMA de Odoo y todavía no tiene fila
         de supplierinfo.

    Query param: `q` (mínimo 2 caracteres). Devuelve como mucho 10 + 15.
    """
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify({'error': 'q debe tener al menos 2 caracteres'}), 400

    try:
        supplier_rows = _odoo_execute(
            'product.supplierinfo', 'search_read',
            [['partner_id', '=', REYMA_PARTNER_ID], ['product_name', 'ilike', q]],
            fields=['product_name', 'product_tmpl_id'], limit=10,
            context={'active_test': False},
        )
        tmpl_ids = sorted({r['product_tmpl_id'][0] for r in supplier_rows if r.get('product_tmpl_id')})
        tmpl_por_id = {}
        if tmpl_ids:
            for t in _odoo_execute(
                'product.template', 'search_read', [['id', 'in', tmpl_ids]],
                fields=['default_code', 'name', 'uom_id', 'volume', 'active'],
                context={'active_test': False},
            ):
                tmpl_por_id[t['id']] = t

        de_reyma = []
        for r in supplier_rows:
            tmpl = r['product_tmpl_id'] and tmpl_por_id.get(r['product_tmpl_id'][0])
            if not tmpl or not tmpl.get('default_code'):
                continue
            de_reyma.append({
                'codigo': tmpl['default_code'],
                'nombre_odoo': tmpl['name'],
                'nombre_reyma': r.get('product_name') or None,
                'uom': tmpl['uom_id'][1] if tmpl.get('uom_id') else None,
                'cubicaje': tmpl.get('volume') or 0,
                'activo': tmpl.get('active', True),
                'fuente': 'reyma_supplierinfo',
            })

        generales = _odoo_execute(
            'product.template', 'search_read',
            ['|', ['default_code', 'ilike', q], ['name', 'ilike', q]],
            fields=['default_code', 'name', 'uom_id', 'volume', 'active'],
            limit=15, context={'active_test': False},
        )
        vistos = {p['codigo'] for p in de_reyma}
        otros = [{
            'codigo': t['default_code'],
            'nombre_odoo': t['name'],
            'nombre_reyma': None,
            'uom': t['uom_id'][1] if t.get('uom_id') else None,
            'cubicaje': t.get('volume') or 0,
            'activo': t.get('active', True),
            'fuente': 'odoo_general',
        } for t in generales if t.get('default_code') and t['default_code'] not in vistos]

    except Exception as e:  # noqa: BLE001 — Odoo caído/timeout no debe tumbar el worker
        logger.warning('reyma/productos/buscar: Odoo falló: %s', e)
        return jsonify({'error': f'No se pudo consultar Odoo: {e}'}), 502

    return jsonify({'q': q, 'candidatos': de_reyma, 'otros': otros})


@app.route('/reabastecimiento/pendiente-reserva', methods=['GET'])
def reabastecimiento_pendiente_reserva():
    """
    «Pendiente de tomar reserva» EN VIVO desde Odoo, por bodega × producto —
    la pantalla de Wilmer («Análisis de movimientos», favorito «Wilmer -
    Reservas.», ir.filters 1166) agregada por producto, más un filtro de
    origen (`location_id` = existencias de la bodega) que en 4ZAC/3PET
    separa la demanda de las recepciones. Definición, el porqué del filtro
    y por qué no se sincroniza: docstring de `pendiente_reserva.py`.

    Query param: `bodegas` — códigos de `stock.warehouse` separados por coma
    (`1CET,4ZAC,3PET`). Obligatorio: la página sabe qué bodegas están en
    alcance (`bodega_map`) y este servicio no.

    Cuatro lecturas a Odoo por request con UNA autenticación, ninguna por
    producto: `stock.warehouse` (códigos → ids), `stock.picking.type` (OUT/INT
    de esas bodegas), UN `read_group` de `stock.move` agrupado por (producto,
    origen) sobre `state not in (cancel, done)` ∧ origen = existencias —
    535 productos en 1.6 s el 2026-09-11 — y `product.product` para
    traducir ids a SKU.

    Respuesta (por SKU, la llave estable — el id de Odoo cambia por build):
      { asOf, bodegas: {'1CET': {sku: {demanda, cantidad, pendiente}}, ...},
        pickingTypes: {'1CET': [2, 5], ...} }
    Un SKU ausente en su bodega = 0 CONOCIDO. Odoo caído = 502, y la
    página lo muestra como «sin dato» (¿?), nunca como 0.

    SOLO LECTURA (search_read / read_group) — ver `_odoo_execute`.
    """
    raw = (request.args.get('bodegas') or '').strip()
    codigos = sorted({c.strip().upper() for c in raw.split(',') if c.strip()})
    if not codigos:
        return jsonify({'error': 'bodegas es obligatorio (códigos de stock.warehouse, separados por coma)'}), 400

    try:
        odoo = _odoo_conectar()
        almacenes = odoo('stock.warehouse', 'search_read', [['code', 'in', codigos]],
                         fields=['code', 'lot_stock_id'])
        codigo_por_wh = {w['id']: w['code'] for w in almacenes}
        # De dónde SALE el movimiento — `WH/Existencias`. Es lo que separa la
        # demanda (sale de existencias) de una recepción en dos pasos
        # (`Entrada → Existencias`, mismo tipo INT en 4ZAC/3PET). Ver el
        # docstring de `pendiente_reserva.py`.
        bodega_por_ubicacion = {w['lot_stock_id'][0]: w['code'] for w in almacenes if w.get('lot_stock_id')}
        faltan = sorted(set(codigos) - set(codigo_por_wh.values()))
        if faltan:
            return jsonify({'error': f'bodegas desconocidas en Odoo: {", ".join(faltan)}'}), 400

        tipos = odoo(
            'stock.picking.type', 'search_read',
            [['warehouse_id', 'in', list(codigo_por_wh)], ['sequence_code', 'in', list(SEQUENCE_CODES)]],
            fields=['sequence_code', 'warehouse_id'],
        )
        tipos_por_bodega = picking_types_por_bodega(tipos, codigo_por_wh)
        tipos = [t for ts in tipos_por_bodega.values() for t in ts]

        grupos, sku_por_producto = [], {}
        if tipos and bodega_por_ubicacion:
            grupos = odoo(
                'stock.move', 'read_group',
                [['state', 'not in', ['cancel', 'done']],
                 ['picking_type_id', 'in', tipos],
                 ['location_id', 'in', list(bodega_por_ubicacion)]],
                ['product_uom_qty:sum', 'quantity:sum'],
                ['product_id', 'location_id'],
                lazy=False,
            )
            # Se responde por SKU y no por id de producto: el id de Odoo cambia
            # con cada build (2026-08-06) y el SKU es la única llave estable —
            # la misma con la que el sync empareja `products`.
            ids = sorted({g['product_id'][0] for g in grupos if g.get('product_id')})
            for p in odoo('product.product', 'search_read', [['id', 'in', ids]],
                          fields=['default_code'], context={'active_test': False}):
                if p.get('default_code'):
                    sku_por_producto[p['id']] = p['default_code']
    except Exception as e:  # noqa: BLE001 — Odoo caído/timeout no debe tumbar el worker
        logger.warning('reabastecimiento/pendiente-reserva: Odoo falló: %s', e)
        return jsonify({'error': f'No se pudo consultar Odoo: {e}'}), 502

    por_bodega = agrupar(grupos, bodega_por_ubicacion, sku_por_producto)
    # Una bodega pedida sin tipos OUT/INT no tiene entrada en `agrupar`;
    # que salga vacía y con su lista de tipos vacía, visible.
    for codigo in codigos:
        por_bodega.setdefault(codigo, {})
    return jsonify({
        'asOf': datetime.now(timezone.utc).isoformat(),
        'bodegas': por_bodega,
        'pickingTypes': tipos_por_bodega,
    })


@app.route('/reyma/factura/pendiente/reintentar', methods=['POST'])
def reyma_factura_pendiente_reintentar():
    """
    Reevalúa líneas que quedaron en `reyma_factura_pendiente` (clave sin
    mapa), después de que Alexis resuelve la clave en
    /inventarios/facturas/pendientes.

    A propósito llama a `evaluar()` — la MISMA regla que carga las facturas
    nuevas, nunca una reimplementación en TypeScript (ver el docstring de
    `reyma_factura_carga.py`). `_mapas_reyma()` relee de Supabase en cada
    llamada, así que ya incluye la fila que Next.js acaba de insertar en
    `reyma_clave_map` antes de llamar acá.

    Entrada: {"lineas": [{archivo, folio_fiscal, factura, fecha, identificador,
    cantidad, unidad, bultos, importe, precio_unitario, observ_destino,
    destino, eta}, ...]} — la forma que guarda `reyma_factura_pendiente`, una
    por fila. `destino`/`eta` viajan por línea (ya son un hecho, decidido por
    Alexis cuando cargó la factura original) y acá se agrupan por prefijo de
    furgón porque así es como `evaluar()` los espera.

    Salida: {filas, retenidas, errores} — la MISMA forma que `evaluar()`
    devuelve. `filas` son las que ya se pueden escribir en
    `reyma_facturas_pdf`; lo que siga en `retenidas` (p. ej. un KGM sin
    tablita de conversión) sigue pendiente — Next.js no las marca `aplicada`.
    """
    body = request.get_json(silent=True) or {}
    entrada = body.get('lineas')
    if not isinstance(entrada, list) or not entrada:
        return jsonify({'error': 'se esperaba "lineas": [...] con al menos un elemento'}), 400

    destinos, etas, lineas = {}, {}, []
    for ln in entrada:
        try:
            archivo = str(ln['archivo'])
            guia = guia_de(archivo)
        except (KeyError, DatoInvalido) as e:
            return jsonify({'error': f'línea inválida: {e}'}), 400
        prefijo = prefijo_de(guia)
        destinos[prefijo] = ln.get('destino')
        etas[prefijo] = ln.get('eta')
        lineas.append({
            'archivo': archivo,
            'folio_fiscal': ln.get('folio_fiscal'),
            'factura': ln.get('factura'),
            'fecha': ln.get('fecha'),
            'identificador': ln.get('identificador'),
            'cantidad': ln.get('cantidad'),
            'unidad': ln.get('unidad'),
            'bultos': ln.get('bultos'),
            'importe': ln.get('importe'),
            'precio_unitario': ln.get('precio_unitario'),
            'observ_destino': ln.get('observ_destino') or '',
        })

    if any(not d for d in destinos.values()):
        return jsonify({'error': 'falta destino en alguna línea'}), 400

    try:
        resultado = evaluar(lineas, destinos, etas,
                             'reintento tras resolver clave en /inventarios/facturas/pendientes',
                             _mapas_reyma())
    except DatoInvalido as e:
        return jsonify({'error': str(e)}), 422

    return jsonify({
        'filas': resultado.filas,
        'retenidas': resultado.retenidas,
        'errores': resultado.errores,
    })


def _enumerate_forecast_months(training_end, prediction_end):
    """Return ['2026-02', '2026-03', ...] for every full month after training_end
    up to and including the month containing prediction_end."""
    from datetime import date as date_cls
    months = []
    year  = training_end.year
    month = training_end.month + 1
    if month > 12:
        month = 1
        year += 1
    while date_cls(year, month, 1) <= prediction_end:
        months.append(f'{year:04d}-{month:02d}')
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
