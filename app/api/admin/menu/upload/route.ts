import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { getActiveMenu, setActiveMenu } from '@/lib/db';
import { utapi, deleteUploadedFile } from '@/lib/uploadthing';

export async function POST(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin authentication required' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided. Please select a valid PDF file.' },
        { status: 400 }
      );
    }

    // Step 2: Validate file on server
    const fileName = file.name || 'menu.pdf';
    const isPdfExt = fileName.toLowerCase().endsWith('.pdf');
    const isPdfMime = file.type === 'application/pdf';

    if (!isPdfExt || !isPdfMime) {
      return NextResponse.json(
        { error: 'Invalid file format. Only PDF files (.pdf) are permitted.' },
        { status: 400 }
      );
    }

    const MAX_SIZE = 32 * 1024 * 1024; // 32MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds maximum allowed limit of 32MB.' },
        { status: 400 }
      );
    }

    const oldMenu = await getActiveMenu();

    // Step 3: Upload the new PDF to UploadThing
    let uploadRes;
    try {
      uploadRes = await utapi.uploadFiles([file]);
    } catch (uploadErr) {
      console.error('[UploadThing] Upload failed:', uploadErr);
      return NextResponse.json(
        { error: 'Failed to upload PDF to storage. The active menu remains unchanged.' },
        { status: 502 }
      );
    }

    if (!uploadRes || !uploadRes[0] || uploadRes[0].error || !uploadRes[0].data) {
      const msg = uploadRes?.[0]?.error?.message || 'Storage upload failed.';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Step 4: Confirm that the new upload succeeded
    const uploadedData = uploadRes[0].data;
    const newFileKey = uploadedData.key;
    const newFileUrl = uploadedData.ufsUrl || uploadedData.url;

    // Step 5: Update database to make new PDF active menu
    let newMenu;
    try {
      newMenu = await setActiveMenu({
        fileKey: newFileKey,
        fileUrl: newFileUrl,
        fileName,
      });
    } catch (dbErr) {
      console.error('[Menu] Database update failed. Cleaning up new upload:', dbErr);
      // DB failed -> delete new file, keep old PDF
      await deleteUploadedFile(newFileKey);
      return NextResponse.json(
        {
          error:
            'Failed to save active menu in database. New file was safely deleted, active menu is intact.',
        },
        { status: 500 }
      );
    }

    // Step 6: Delete previous PDF from UploadThing
    if (oldMenu && oldMenu.fileKey && oldMenu.fileKey !== newFileKey) {
      deleteUploadedFile(oldMenu.fileKey).catch((delErr) => {
        console.error('[UploadThing] Error deleting previous file, keeping new PDF active:', delErr);
      });
    }

    // Step 7: Confirm successful replacement & invalidate caches
    revalidatePath('/');
    revalidatePath('/api/menu/pdf');
    revalidatePath('/admin');

    return NextResponse.json({
      success: true,
      menu: newMenu,
      message: 'Menu replaced successfully.',
    });
  } catch (error) {
    console.error('[Upload] Unexpected error during menu replacement:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during upload.' },
      { status: 500 }
    );
  }
}
