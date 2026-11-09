'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface PdfViewerProps {
  pdfUrl: string;
}

interface PageData {
  blobUrl: string;
  width: number;
  height: number;
}

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const [isMounted, setIsMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageAspectRatios, setPageAspectRatios] = useState<Record<number, number>>({});
  const [renderedPages, setRenderedPages] = useState<Record<number, PageData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTasksRef = useRef<Record<number, any>>({});
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      // Revoke all blob URLs on unmount to free memory
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, []);

  const renderPages = useCallback(async (pdfDoc: any) => {
    if (!containerRef.current || !pdfDoc) return;

    const containerWidth = containerRef.current.clientWidth;
    if (containerWidth <= 0) return;

    const targetWidth = Math.min(containerWidth, 1200);
    const dpr = window.devicePixelRatio || 1;

    // Cancel ongoing renders
    Object.values(renderTasksRef.current).forEach((task) => {
      try { task?.cancel(); } catch { /* ignore */ }
    });
    renderTasksRef.current = {};

    // Revoke old blob URLs before creating new ones
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        // --- Offscreen canvas: never attached to the DOM ---
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        // 1. Solid white pre-fill (prevents transparent→black on some GPUs)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Render PDF page with explicit white background
        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          background: 'rgb(255,255,255)',
        });
        renderTasksRef.current[i] = renderTask;
        await renderTask.promise;

        // 3. Convert canvas → Blob → Object URL
        //    Blob URLs are treated as true image resources by ALL browsers,
        //    including Samsung Internet's dark mode engine, which never
        //    inverts real image resources (it would break every photo on the web).
        const blob: Blob = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/png');
        });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.push(blobUrl);

        const displayHeight = Math.round(viewport.height / dpr);

        setRenderedPages((prev) => ({
          ...prev,
          [i]: { blobUrl, width: targetWidth, height: displayHeight },
        }));
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${i}:`, err);
        }
      }
    }
  }, []);

  // Load PDF document
  useEffect(() => {
    if (!isMounted) return;

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const doc = await pdfjs.getDocument({
          url: pdfUrl,
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
        }).promise;

        if (cancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);

        // Pre-fetch aspect ratios for layout placeholders
        const ratios: Record<number, number> = {};
        for (let i = 1; i <= doc.numPages; i++) {
          try {
            const p = await doc.getPage(i);
            const v = p.getViewport({ scale: 1 });
            ratios[i] = v.height / v.width;
          } catch {
            ratios[i] = 1.414; // A4 fallback
          }
        }
        setPageAspectRatios(ratios);
        setIsLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load PDF:', err);
          setError('Unable to load menu. Please refresh.');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      Object.values(renderTasksRef.current).forEach((t) => {
        try { t?.cancel(); } catch { /* ignore */ }
      });
      pdfDocRef.current?.destroy?.();
      pdfDocRef.current = null;
    };
  }, [isMounted, pdfUrl]);

  // Render pages once loaded & re-render on resize
  useEffect(() => {
    if (!isMounted || numPages === 0 || !pdfDocRef.current) return;

    renderPages(pdfDocRef.current);

    let timeout: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (pdfDocRef.current) renderPages(pdfDocRef.current);
      }, 200);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [isMounted, numPages, renderPages]);

  // --- SSR / pre-mount spinner ---
  if (!isMounted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full min-h-screen bg-zinc-950 flex flex-col items-center justify-start overflow-x-hidden selection:bg-transparent"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Loading */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="flex-1 flex items-center justify-center p-6 text-zinc-400 text-sm">
          {error}
        </div>
      )}

      {/* PDF Pages — rendered as <img> with Blob URLs for Samsung compatibility */}
      <div className="w-full flex flex-col items-center gap-1 sm:gap-3 py-0 sm:py-2">
        {Array.from({ length: numPages }, (_, idx) => {
          const pageNum = idx + 1;
          const pd = renderedPages[pageNum];
          const ratio = pageAspectRatios[pageNum] || 1.414;

          return (
            <div
              key={pageNum}
              className="pdf-page-container w-full flex justify-center shadow-lg"
              style={{
                backgroundColor: '#ffffff',
                minHeight: pd ? pd.height : undefined,
              }}
            >
              {pd ? (
                <img
                  src={pd.blobUrl}
                  width={pd.width}
                  height={pd.height}
                  alt=""
                  draggable={false}
                  className="pdf-page-image block max-w-full h-auto"
                  style={{
                    width: pd.width,
                    height: pd.height,
                    backgroundColor: '#ffffff',
                    WebkitTouchCallout: 'none',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              ) : (
                <div
                  className="w-full max-w-[1200px] animate-pulse"
                  style={{
                    aspectRatio: `1 / ${ratio}`,
                    backgroundColor: '#e4e4e7',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
