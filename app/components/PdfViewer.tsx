'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface PdfViewerProps {
  pdfUrl: string;
}

interface PageData {
  dataUrl: string;
  width: number;
  height: number;
}

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageAspectRatios, setPageAspectRatios] = useState<{ [pageNum: number]: number }>({});
  const [renderedPages, setRenderedPages] = useState<{ [pageNum: number]: PageData }>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTasksRef = useRef<{ [pageIndex: number]: any }>({});

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const renderPages = useCallback(
    async (pdfDoc: any) => {
      if (!containerRef.current || !pdfDoc) return;

      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth <= 0) return;

      // Fit to container width on mobile; cap on extra-large screens for readability
      const targetWidth = Math.min(containerWidth, 1200);
      const dpr = window.devicePixelRatio || 1;

      // Cancel any ongoing renders
      Object.values(renderTasksRef.current).forEach((task) => {
        try {
          task?.cancel();
        } catch {
          // Ignore cancellation errors
        }
      });
      renderTasksRef.current = {};

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / unscaledViewport.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          // Create an offscreen canvas
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          const context = canvas.getContext('2d', { willReadFrequently: false });
          if (!context) continue;

          // 1. Explicitly fill with solid white background.
          // This prevents Samsung Internet and other browsers from leaving transparent areas black.
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          // 2. Render with PDF.js background set to white
          const renderContext = {
            canvasContext: context,
            viewport: viewport,
            background: 'rgb(255, 255, 255)',
          };

          const renderTask = page.render(renderContext);
          renderTasksRef.current[i] = renderTask;

          await renderTask.promise;

          // 3. Convert to high-resolution JPEG raster image.
          // Mobile browsers (specifically Samsung Internet's Dark Mode) will NOT invert
          // or black out <img> raster elements like they do with raw <canvas> elements.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const displayHeight = Math.round(viewport.height / dpr);

          setRenderedPages((prev) => ({
            ...prev,
            [i]: {
              dataUrl,
              width: targetWidth,
              height: displayHeight,
            },
          }));
        } catch (err: any) {
          if (err?.name !== 'RenderingCancelledException') {
            console.error(`Error rendering page ${i}:`, err);
          }
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!isMounted) return;

    let isCancelled = false;

    async function loadPdf() {
      setIsLoading(true);
      setError(null);

      try {
        const pdfjs = await import('pdfjs-dist');
        if (pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        }

        const loadingTask = pdfjs.getDocument({
          url: pdfUrl,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + pdfjs.version + '/cmaps/',
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);

        // Pre-fetch aspect ratios for smooth layout sizing before image loads
        const ratios: { [pageNum: number]: number } = {};
        for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
          try {
            const p = await doc.getPage(i);
            const v = p.getViewport({ scale: 1 });
            ratios[i] = v.height / v.width;
          } catch {
            ratios[i] = 1.414; // Default A4 ratio fallback
          }
        }
        setPageAspectRatios(ratios);
        setIsLoading(false);
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to load PDF document:', err);
          setError('Unable to load menu. Please refresh.');
          setIsLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
      Object.values(renderTasksRef.current).forEach((task) => {
        try {
          task?.cancel();
        } catch {
          // ignore
        }
      });
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy?.();
        pdfDocRef.current = null;
      }
    };
  }, [isMounted, pdfUrl]);

  useEffect(() => {
    if (!isMounted || numPages === 0 || !pdfDocRef.current) return;

    renderPages(pdfDocRef.current);

    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (pdfDocRef.current) {
          renderPages(pdfDocRef.current);
        }
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isMounted, numPages, renderPages]);

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
      style={{
        WebkitOverflowScrolling: 'touch',
        colorScheme: 'light dark',
      }}
    >
      {/* Minimal neutral loading indicator */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="flex-1 flex items-center justify-center p-6 text-zinc-400 text-sm">
          {error}
        </div>
      )}

      {/* Pages Container - 100% natural vertical scroll, immune to dark-mode canvas inversion */}
      <div className="w-full flex flex-col items-center gap-2 sm:gap-4 py-0 sm:py-2">
        {Array.from({ length: numPages }, (_, index) => {
          const pageNum = index + 1;
          const pageData = renderedPages[pageNum];
          const estimatedRatio = pageAspectRatios[pageNum] || 1.414;

          return (
            <div
              key={pageNum}
              className="w-full flex justify-center shadow-lg bg-zinc-900"
              style={{
                minHeight: pageData ? `${pageData.height}px` : undefined,
              }}
            >
              {pageData ? (
                /* Rendered as an <img> raster to prevent Samsung Internet Dark Mode canvas inversion */
                <img
                  src={pageData.dataUrl}
                  alt={`Page ${pageNum}`}
                  className="block max-w-full h-auto bg-white select-none pointer-events-none"
                  style={{
                    width: `${pageData.width}px`,
                    height: `${pageData.height}px`,
                    colorScheme: 'only light',
                    forcedColorAdjust: 'none',
                    WebkitTouchCallout: 'none',
                    userSelect: 'none',
                  }}
                  draggable={false}
                />
              ) : (
                /* Subtle placeholder until page raster finishes */
                <div
                  className="w-full max-w-[1200px] bg-zinc-900 animate-pulse"
                  style={{
                    aspectRatio: `${1 / estimatedRatio}`,
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
