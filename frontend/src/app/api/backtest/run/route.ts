import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { training_months, max_products = 100, holding_cost_rate = 0.25 } = body;

    if (!training_months || training_months < 3) {
      return NextResponse.json(
        { error: 'training_months debe ser >= 3' },
        { status: 400 },
      );
    }

    // Forward to Railway ML service
    const response = await fetch(`${ML_SERVICE_URL}/backtest/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ML_SERVICE_API_KEY,
      },
      body: JSON.stringify({ training_months, max_products, holding_cost_rate }),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Backtest run error:', error);
    return NextResponse.json(
      { error: 'Error al iniciar el backtest' },
      { status: 500 },
    );
  }
}
