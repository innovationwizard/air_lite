"""
AI Refill Lite — Backtest Engine API
Deployed on Railway. Exposes HTTP endpoints for the Next.js frontend to trigger
backtest cycles and check status.
"""

import os
import logging
import threading

from flask import Flask, request, jsonify
from supabase import create_client

from backtest_engine import run_backtest_cycle
from purchase_scheduler import run_purchase_schedule_cycle

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

ML_SERVICE_API_KEY = os.environ.get('ML_SERVICE_API_KEY', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')


def get_supabase() -> 'Client':
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def verify_api_key():
    """Verify the shared API key from the request header."""
    key = request.headers.get('X-API-Key', '')
    if not ML_SERVICE_API_KEY:
        logger.warning('ML_SERVICE_API_KEY not set — skipping auth in development')
        return True
    return key == ML_SERVICE_API_KEY


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

    supabase = get_supabase()

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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
