import { Suspense } from 'react';
import { connection } from 'next/server';
import { getActiveMenu } from '@/lib/db';
import PdfViewer from '@/app/components/PdfViewer';

async function MenuContent() {
  await connection();
  const menu = await getActiveMenu();

  if (!menu) {
    return (
      <main className="min-h-screen w-full flex items-center justify-center bg-zinc-950 text-zinc-500 font-sans text-sm select-none p-4 text-center">
        <p>Menu currently unavailable.</p>
      </main>
    );
  }

  return (
    <main className="w-full min-h-screen bg-zinc-950 m-0 p-0 overflow-x-hidden">
      <PdfViewer pdfUrl="/api/menu/pdf" />
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
        </div>
      }
    >
      <MenuContent />
    </Suspense>
  );
}
