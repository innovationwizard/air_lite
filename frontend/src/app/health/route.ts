/**
 * Health Check Endpoint (Root Level)
 * Used by AWS App Runner for health checks at /health
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'ai-refill-frontend',
    },
    { status: 200 }
  );
}

