/**
 * Health Check Endpoint
 * Used by AWS App Runner for health checks
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

