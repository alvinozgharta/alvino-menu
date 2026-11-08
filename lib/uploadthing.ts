import { UTApi } from 'uploadthing/server';

export const utapi = new UTApi();

export async function deleteUploadedFile(fileKey: string): Promise<boolean> {
  try {
    const res = await utapi.deleteFiles([fileKey]);
    return res.success;
  } catch (err) {
    console.error(`[UploadThing] Failed to delete file key ${fileKey}:`, err);
    return false;
  }
}
