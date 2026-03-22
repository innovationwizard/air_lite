import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || '';

export async function GET(
  _request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const response = await fetch(
      `${ML_SERVICE_URL}/backtest/status/${params.runId}`,
      {
        headers: { 'X-API-Key': ML_SERVICE_API_KEY },
      },
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Backtest status error:', error);
    return NextResponse.json(
      { error: 'Error al consultar el estado del backtest' },
      { status: 500 },
    );
  }
}
