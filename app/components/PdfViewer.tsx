'use client';

import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

interface PdfViewerProps {
  pdfUrl: string;
}

interface PageImage {
  url: string;
  width: number;
  height: number;
}

const subscribeToBrowser = () => () => {};
const getBrowserUserAgent = () => navigator.userAgent;
const getServerUserAgent = () => null;

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const userAgent = useSyncExternalStore(subscribeToBrowser, getBrowserUserAgent, getServerUserAgent);
  const isMounted = userAgent !== null;
  const usePageImages = /SamsungBrowser\//i.test(userAgent ?? '');
  const [pageImages, setPageImages] = useState<Record<number, PageImage>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const numPages = pdfDoc?.numPages ?? 0;
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const renderTasksRef = useRef<Record<number, RenderTask>>({});
  const canvasRefs = useRef<{ [pageIndex: number]: HTMLCanvasElement | null }>({});
  const imageUrlsRef = useRef<Record<number, string>>({});
  const renderGenerationRef = useRef(0);

  const cancelRendering = useCallback(() => {
    ++renderGenerationRef.current;
    Object.values(renderTasksRef.current).forEach((task) => task.cancel());
  }, []);

  const renderPages = useCallback(
    async (pdfDoc: PDFDocumentProxy) => {
      if (!containerRef.current || !pdfDoc) return;

      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth <= 0) return;

      // Fit to container width on mobile; cap on extra-large screens for readability
      const targetWidth = Math.min(containerWidth, 1200);
      const dpr = usePageImages
        ? Math.min(window.devicePixelRatio || 1, 2)
        : window.devicePixelRatio || 1;
      const generation = ++renderGenerationRef.current;
      const isCurrent = () => generation === renderGenerationRef.current;

      // Cancel any ongoing renders
      const previousTasks = Object.values(renderTasksRef.current);
      previousTasks.forEach((task) => {
        try {
          task?.cancel();
        } catch {
          // Ignore cancellation errors
        }
      });
      renderTasksRef.current = {};
      // PDF.js must finish cancelling before a canvas can be reused.
      await Promise.allSettled(previousTasks.map((task) => task.promise));

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (!isCurrent()) return;
        // Keep Samsung's PDF canvas out of the DOM; display the resulting PNG.
        const canvas = usePageImages
          ? document.createElement('canvas')
          : canvasRefs.current[i];
        if (!canvas) continue;

        try {
          const page = await pdfDoc.getPage(i);
          if (!isCurrent()) return;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / unscaledViewport.width;
          // Bound Samsung's bitmap allocation on high-DPI phones and long pages.
          const outputScale = usePageImages
            ? Math.min(
                dpr,
                4096 / targetWidth,
                4096 / (unscaledViewport.height * scale),
                Math.sqrt(4_000_000 / (targetWidth * unscaledViewport.height * scale)),
              )
            : dpr;
          const viewport = page.getViewport({ scale: scale * outputScale });

          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Unable to create a menu page canvas.');

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${targetWidth}px`;
          canvas.style.height = `${viewport.height / outputScale}px`;
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          const renderContext = {
            canvas: null,
            canvasContext: context,
            viewport: viewport,
            background: '#ffffff',
          };

          const renderTask = page.render(renderContext);
          renderTasksRef.current[i] = renderTask;

          await renderTask.promise;
          if (!isCurrent()) return;

          if (usePageImages) {
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((value) => {
                if (value) resolve(value);
                else reject(new Error('Unable to create menu page image.'));
              }, 'image/png');
            });
            if (!isCurrent()) return;

            const url = URL.createObjectURL(blob);
            const previousUrl = imageUrlsRef.current[i];
            imageUrlsRef.current[i] = url;
            setPageImages((previous) => ({
              ...previous,
              [i]: { url, width: targetWidth, height: viewport.height / outputScale },
            }));
            if (previousUrl) URL.revokeObjectURL(previousUrl);
          }
        } catch (err: unknown) {
          if (isCurrent() && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
            console.error(`Error rendering page ${i}:`, err);
            setError('Unable to display a menu page. Please refresh.');
          }
        } finally {
          if (usePageImages) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
    },
    [usePageImages]
  );

  useEffect(() => {
    if (!isMounted) return;

    let isCancelled = false;
    let loadingTask: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;

    async function loadPdf() {
      setIsLoading(true);
      setError(null);
      setPdfDoc(null);
      setPageImages({});

      try {
        // The standard build requires newer JavaScript APIs than some Samsung
        // Internet releases provide. The legacy build supplies their polyfills.
        const pdfjs = usePageImages
          ? await import('pdfjs-dist/legacy/build/pdf.mjs')
          : await import('pdfjs-dist');
        if (isCancelled) return;
        if (pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = usePageImages
            ? `/pdf.worker.legacy.min.mjs?v=${pdfjs.version}`
            : '/pdf.worker.min.mjs';
        }

        loadingTask = pdfjs.getDocument({
          url: pdfUrl,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + pdfjs.version + '/cmaps/',
          cMapPacked: true,
          // Use PDF.js's software image conversion on Samsung Internet.
          ...(usePageImages && {
            isOffscreenCanvasSupported: false,
            isImageDecoderSupported: false,
          }),
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        setPdfDoc(doc);
        setIsLoading(false);
      } catch (err: unknown) {
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
      cancelRendering();
      void loadingTask?.destroy();
      Object.values(imageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      imageUrlsRef.current = {};
    };
  }, [isMounted, pdfUrl, usePageImages, cancelRendering]);

  useEffect(() => {
    if (!isMounted || !pdfDoc) return;

    renderPages(pdfDoc);

    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        renderPages(pdfDoc);
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      cancelRendering();
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isMounted, pdfDoc, renderPages, cancelRendering]);

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

      {/* Pages Container - 100% natural vertical scroll, zero toolbar, zero branding */}
      <div className="w-full flex flex-col items-center gap-2 sm:gap-4 py-0 sm:py-2">
        {Array.from({ length: numPages }, (_, index) => {
          const pageNum = index + 1;
          const pageImage = pageImages[pageNum];
          return (
            <div
              key={pageNum}
              className="w-full flex justify-center shadow-lg bg-zinc-900"
            >
              {usePageImages ? (
                pageImage ? (
                  // Blob URLs are generated locally; Next Image optimization is unnecessary.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pageImage.url}
                    width={pageImage.width}
                    height={pageImage.height}
                    alt={`Menu page ${pageNum}`}
                    draggable={false}
                    className="pdf-page-image block max-w-full h-auto bg-white"
                  />
                ) : (
                  <div className="w-full max-w-[1200px] aspect-[1/1.414] bg-zinc-900 animate-pulse" />
                )
              ) : (
                <canvas
                  ref={(el) => {
                    canvasRefs.current[pageNum] = el;
                  }}
                  className="block max-w-full h-auto bg-white"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
