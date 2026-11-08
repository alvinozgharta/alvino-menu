'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  verifyCredentials,
  createSessionToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSession,
  changeAdminPassword,
} from '@/lib/auth';
import { getAdmin, getActiveMenu, setActiveMenu, type ActiveMenu } from '@/lib/db';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limit';
import { utapi, deleteUploadedFile } from '@/lib/uploadthing';

async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return headerList.get('x-real-ip') || '127.0.0.1';
}

export async function loginAction(
  prevState: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const email = (formData.get('email') as string)?.trim() || '';
  const password = (formData.get('password') as string) || '';

  if (!email || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  const clientIp = await getClientIp();
  const rateLimit = checkRateLimit(clientIp);

  if (!rateLimit.allowed) {
    const minutesLeft = rateLimit.blockedUntil
      ? Math.ceil((rateLimit.blockedUntil - Date.now()) / 60000)
      : 15;
    return {
      success: false,
      error: `Too many failed login attempts. Please try again in ${minutesLeft} minute(s).`,
    };
  }

  const verification = await verifyCredentials(email, password);
  if (!verification.success) {
    const failStatus = recordFailedAttempt(clientIp);
    if (!failStatus.allowed) {
      return {
        success: false,
        error: 'Too many failed login attempts. Your IP has been temporarily locked for 15 minutes.',
      };
    }
    return {
      success: false,
      error: `Invalid email or password. (${failStatus.remainingAttempts} attempt(s) remaining)`,
    };
  }

  // Login successful
  resetRateLimit(clientIp);
  const admin = await getAdmin();
  if (!admin) {
    return { success: false, error: 'Admin record unavailable.' };
  }

  const token = await createSessionToken(admin.email, admin.updatedAt);
  await setAdminSessionCookie(token);

  revalidatePath('/admin');
  return { success: true };
}

export async function logoutAction(): Promise<{ success: boolean }> {
  await clearAdminSessionCookie();
  revalidatePath('/admin');
  return { success: true };
}

export async function changePasswordAction(
  prevState: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string; message?: string }> {
  const session = await getAdminSession();
  if (!session) {
    return { success: false, error: 'Unauthorized. Please log in again.' };
  }

  const currentPassword = (formData.get('currentPassword') as string) || '';
  const newPassword = (formData.get('newPassword') as string) || '';
  const confirmPassword = (formData.get('confirmPassword') as string) || '';

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { success: false, error: 'All password fields are required.' };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: 'New password and confirmation do not match.' };
  }

  if (newPassword.length < 8) {
    return { success: false, error: 'New password must be at least 8 characters long.' };
  }

  const result = await changeAdminPassword(currentPassword, newPassword);
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to change password.' };
  }

  revalidatePath('/admin');
  return {
    success: true,
    message: 'Password successfully changed. You have been logged out. Please log in with your new password.',
  };
}

export async function activateUploadedMenuAction(data: {
  fileKey: string;
  fileUrl: string;
  fileName: string;
}): Promise<{ success: boolean; error?: string; menu?: ActiveMenu }> {
  const session = await getAdminSession();
  if (!session) {
    return { success: false, error: 'Unauthorized: Admin authentication required.' };
  }

  if (!data.fileKey || !data.fileUrl || !data.fileName) {
    return { success: false, error: 'Invalid file metadata.' };
  }

  const oldMenu = await getActiveMenu();

  try {
    // 5. Update the database to make the new PDF the active menu.
    const newMenu = await setActiveMenu({
      fileKey: data.fileKey,
      fileUrl: data.fileUrl,
      fileName: data.fileName,
    });

    // 6. Delete previous PDF from UploadThing.
    if (oldMenu && oldMenu.fileKey && oldMenu.fileKey !== data.fileKey) {
      deleteUploadedFile(oldMenu.fileKey).catch((err) => {
        console.error('[UploadThing] Background deletion failed for old menu:', err);
      });
    }

    // 7. Purge caches
    revalidatePath('/');
    revalidatePath('/api/menu/pdf');
    revalidatePath('/admin');

    return { success: true, menu: newMenu };
  } catch (dbError) {
    console.error('[Menu] Database update failed. Rolling back uploaded file:', dbError);
    // If DB update fails, clean up the newly uploaded file to keep the old PDF intact
    await deleteUploadedFile(data.fileKey);
    return {
      success: false,
      error: 'Database update failed. The new upload was safely rolled back.',
    };
  }
}

export async function uploadMenuDirectAction(
  prevState: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string; menu?: ActiveMenu }> {
  const session = await getAdminSession();
  if (!session) {
    return { success: false, error: 'Unauthorized: Admin authentication required.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || !(file instanceof File)) {
    return { success: false, error: 'Please select a PDF file to upload.' };
  }

  // 2. Validate the file:
  const fileName = file.name || 'menu.pdf';
  const fileExt = fileName.split('.').pop()?.toLowerCase();
  if (fileExt !== 'pdf' || file.type !== 'application/pdf') {
    return { success: false, error: 'Only PDF files (.pdf) are allowed.' };
  }

  const MAX_SIZE = 32 * 1024 * 1024; // 32MB
  if (file.size > MAX_SIZE) {
    return { success: false, error: 'File size exceeds maximum allowed limit of 32MB.' };
  }

  const oldMenu = await getActiveMenu();

  // 3. Upload new PDF to UploadThing
  let uploadRes;
  try {
    uploadRes = await utapi.uploadFiles([file]);
  } catch (uploadErr) {
    console.error('[UploadThing] Upload failed:', uploadErr);
    // Keep old PDF
    return { success: false, error: 'Upload to storage failed. Existing menu is intact.' };
  }

  if (!uploadRes || !uploadRes[0] || uploadRes[0].error || !uploadRes[0].data) {
    const errorMsg = uploadRes?.[0]?.error?.message || 'Failed to upload PDF file.';
    return { success: false, error: errorMsg };
  }

  const uploadedData = uploadRes[0].data;
  const newFileKey = uploadedData.key;
  const newFileUrl = uploadedData.ufsUrl || uploadedData.url;

  // 4. Confirm new upload succeeded, then 5. Update DB
  try {
    const newMenu = await setActiveMenu({
      fileKey: newFileKey,
      fileUrl: newFileUrl,
      fileName,
    });

    // 6. Delete previous PDF from UploadThing
    if (oldMenu && oldMenu.fileKey && oldMenu.fileKey !== newFileKey) {
      deleteUploadedFile(oldMenu.fileKey).catch((delErr) => {
        console.error('[UploadThing] Error deleting previous file, keeping new PDF active:', delErr);
      });
    }

    // 7. Confirm successful replacement & invalidate caches
    revalidatePath('/');
    revalidatePath('/api/menu/pdf');
    revalidatePath('/admin');

    return { success: true, menu: newMenu };
  } catch (dbErr) {
    console.error('[Menu] Database update failed. Cleaning up newly uploaded file:', dbErr);
    // If DB update fails, clean up new file, keep old PDF
    await deleteUploadedFile(newFileKey);
    return {
      success: false,
      error: 'Failed to update database. The new upload was cleaned up and the previous menu is retained.',
    };
  }
}
