import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Get ALL cookies from browser request
    const cookieHeader = request.headers.get('cookie');

    if (!cookieHeader) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();

    // Forward to backend API with ALL cookies from browser
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.airefill.app';
    const apiResponse = await fetch(`${apiUrl}/api/v1/bi/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader  // Forward all cookies
      },
      body: JSON.stringify(body)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('[EXPORT PROXY] Backend error:', apiResponse.status, errorText);
      return NextResponse.json(
        { success: false, error: 'Export failed' },
        { status: apiResponse.status }
      );
    }

    // Get file data and headers
    const buffer = await apiResponse.arrayBuffer();
    const contentType = apiResponse.headers.get('Content-Type') || 'application/octet-stream';
    const contentDisposition = apiResponse.headers.get('Content-Disposition') || 'attachment';

    // Return file to browser
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Content-Length': buffer.byteLength.toString()
      }
    });

  } catch (error) {
    console.error('[EXPORT PROXY] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}