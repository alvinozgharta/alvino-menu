import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { getAdminSession } from '@/lib/auth';
import { UploadThingError } from 'uploadthing/server';

const f = createUploadthing();

export const ourFileRouter = {
  menuUploader: f({
    pdf: {
      maxFileSize: '32MB',
      maxFileCount: 1,
    },
  })
    .middleware(async () => {
      const session = await getAdminSession();
      if (!session) {
        throw new UploadThingError('Unauthorized: Admin login required.');
      }
      return { adminEmail: session.email };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      return {
        uploadedBy: metadata.adminEmail,
        fileKey: file.key,
        fileUrl: file.ufsUrl || file.url,
        fileName: file.name,
      };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
