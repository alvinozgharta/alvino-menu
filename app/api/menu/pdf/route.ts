import { NextResponse } from 'next/server';
import { connection } from 'next/server';
import { getActiveMenu } from '@/lib/db';

export async function GET() {
  await connection();

  try {
    const menu = await getActiveMenu();

    if (!menu || !menu.fileUrl) {
      return new NextResponse(
        JSON.stringify({ error: 'No active menu available' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch the PDF from UploadThing
    const response = await fetch(menu.fileUrl);

    if (!response.ok) {
      return new NextResponse(
        JSON.stringify({ error: 'Failed to retrieve menu file' }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const pdfBuffer = await response.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(menu.fileName)}"`,
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
        'ETag': `"${menu.fileKey}"`,
      },
    });
  } catch (error) {
    console.error('[API] Error streaming PDF:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error while retrieving menu' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
