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

    # Create the run record synchronously so we can return the run_id
    run_result = supabase.table('backtest_runs').insert({
        'training_start_date': '2024-10-01',
        'training_end_date': '2024-10-01',  # Will be updated by engine
        'prediction_month': '2024-10-01',   # Will be updated by engine
        'status': 'running',
    }).execute()

    run_id = run_result.data[0]['id']

    # Run backtest in background thread (Railway has no timeout)
    def _run():
        try:
            sb = get_supabase()
            run_backtest_cycle(sb, training_months, max_products, holding_cost_rate)
        except Exception as e:
            logger.error('Background backtest failed: %s', e)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return jsonify({
        'run_id': run_id,
        'status': 'running',
        'message': 'Backtest iniciado. Consulte /backtest/status/{run_id} para ver el progreso.',
    }), 202


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
