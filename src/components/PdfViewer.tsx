"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import { loadPdfjs } from "@/engine/pdfjs";
import { ChevronDownIcon, ChevronLeftIcon, ExpandIcon, FitPageIcon, FitWidthIcon, ShrinkIcon, ZoomInIcon, ZoomOutIcon } from "./icons";

type Zoom = "fit-width" | "fit-page" | number;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Pages this far from the viewport keep their canvas; beyond it the bitmap is released. */
const KEEP_PAGES = 4;
const GAP = 12;
/** Documents up to this many pages have every page measured up front; longer ones are measured as they scroll in. */
const MEASURE_ALL_UP_TO = 150;

interface Size {
  w: number;
  h: number;
}

function PageCanvas({ doc, pageNumber, scale, size, active, onSize }: { doc: PDFDocumentProxy; pageNumber: number; scale: number; size: Size; active: boolean; onSize: (n: number, s: Size) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const w = Math.floor(size.w * scale);
  const h = Math.floor(size.h * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active) {
      // Release the bitmap for far-away pages.
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        if (Math.abs(base.width - size.w) > 0.5 || Math.abs(base.height - size.h) > 0.5) onSize(pageNumber, { w: base.width, h: base.height });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        // Cap canvas area (about 16.7 MP) so zooming a large page can't exhaust memory.
        const area = viewport.width * viewport.height;
        const shrink = area > 16_700_000 ? Math.sqrt(16_700_000 / area) : 1;
        const vp = shrink < 1 ? page.getViewport({ scale: scale * dpr * shrink }) : viewport;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        task = page.render({ canvas, viewport: vp });
        await task.promise;
        page.cleanup();
        setFailed(false);
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
            setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale, active, size.w, size.h, onSize]);

  return (
    <div className="relative mx-auto overflow-hidden rounded bg-white shadow-md ring-1 ring-black/10" style={{ width: w, height: h }} data-page={pageNumber}>
      <canvas ref={canvasRef} style={{ width: w, height: h }} aria-label={`Page ${pageNumber}`} role="img" />
      {failed && <p className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-neutral-600">This page couldn&apos;t be drawn.</p>}
    </div>
  );
}

/**
 * Multi-page viewer for the generated PDF, rendered locally with pdf.js. Pages are drawn lazily (only those near the
 * viewport hold a bitmap), so long documents stay light. Supports page navigation, zoom, fit width/page and fullscreen.
 */
export function PdfViewer({ blob, label }: { blob: Blob; label: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit-width");
  const [box, setBox] = useState<Size>({ w: 600, h: 600 });
  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState("1");
  const [announce, setAnnounce] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const numPages = doc?.numPages ?? 0;

  // Load the document from the blob. Nothing is uploaded; pdf.js parses it in its own worker.
  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        task = pdfjs.getDocument({ data, enableXfa: false });
        const d = await task.promise;
        if (cancelled) return;
        const first = await d.getPage(1);
        const v = first.getViewport({ scale: 1 });
        const initial: Size[] = Array.from({ length: d.numPages }, () => ({ w: v.width, h: v.height }));
        setSizes(initial);
        setDoc(d);
        setStatus("ready");
        if (d.numPages <= MEASURE_ALL_UP_TO) {
          const all = await Promise.all(Array.from({ length: d.numPages }, async (_, i) => (await d.getPage(i + 1)).getViewport({ scale: 1 })));
          if (!cancelled) setSizes(all.map((vp) => ({ w: vp.width, h: vp.height })));
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob]);

  // Track the scroll container size so fit-width / fit-page follow window resizes and fullscreen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || status !== "ready") return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status, fullscreen]);

  const first = sizes[0] ?? { w: 595, h: 842 };
  const fitWidth = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (box.w - 24) / first.w));
  const fitPage = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fitWidth, (box.h - 24) / first.h));
  const scale = zoom === "fit-width" ? fitWidth : zoom === "fit-page" ? fitPage : zoom;

  const onSize = useCallback((n: number, s: Size) => {
    setSizes((prev) => {
      const cur = prev[n - 1];
      if (!cur || (Math.abs(cur.w - s.w) < 0.5 && Math.abs(cur.h - s.h) < 0.5)) return prev;
      const next = prev.slice();
      next[n - 1] = s;
      return next;
    });
  }, []);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), numPages || 1);
      const el = pageRefs.current[target - 1];
      const sc = scrollRef.current;
      // Instant jumps: overlapping smooth scrolls (rapid Next/Prev, or typing a page number mid-scroll) can cancel each other.
      if (el && sc) sc.scrollTo({ top: el.offsetTop - GAP, behavior: "auto" });
      setCurrent(target);
      setDraft(String(target));
      setAnnounce(`Page ${target} of ${numPages}`);
    },
    [numPages],
  );

  // The page nearest the top third of the viewport is "current".
  const onScroll = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const probe = sc.scrollTop + sc.clientHeight / 3;
    let lo = 0;
    let hi = pageRefs.current.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((pageRefs.current[mid]?.offsetTop ?? 0) <= probe) lo = mid;
      else hi = mid - 1;
    }
    setCurrent((c) => (c === lo + 1 ? c : lo + 1));
    setDraft(String(lo + 1));
  }, []);

  const step = (dir: 1 | -1) => {
    const base = zoom === "fit-width" ? fitWidth : zoom === "fit-page" ? fitPage : zoom;
    const next = dir === 1 ? STEPS.find((s) => s > base + 0.01) : [...STEPS].reverse().find((s) => s < base - 0.01);
    setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next ?? base)));
  };

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        /* fall through to the in-page overlay */
      }
    }
    setFullscreen((f) => !f);
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keep the current page in view when the zoom changes the page heights.
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    if (lastScale.current !== scale && status === "ready") {
      lastScale.current = scale;
      goTo(current);
    }
  }, [scale, status, current, goTo]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && fullscreen && !document.fullscreenElement) setFullscreen(false);
    else if (e.target === scrollRef.current) {
      if (e.key === "+" || e.key === "=") step(1);
      else if (e.key === "-") step(-1);
    }
  };

  const pct = Math.round(scale * 100);
  const btn = "btn btn-ghost btn-icon btn-sm";
  return (
    <section
      ref={rootRef}
      aria-label={label}
      onKeyDown={onKey}
      className={fullscreen ? "fixed inset-0 z-50 flex flex-col bg-[var(--bg)] p-2 sm:p-3" : "card flex flex-col p-2.5 sm:p-3"}
      data-testid="pdf-viewer"
    >
      <div role="toolbar" aria-label="PDF viewer controls" className="mb-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} onClick={() => goTo(current - 1)} disabled={status !== "ready" || current <= 1} aria-label="Previous page" data-testid="pdf-prev">
          <ChevronLeftIcon size={18} />
        </button>
        <form
          className="flex items-center gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(draft, 10);
            if (Number.isFinite(n)) goTo(n);
          }}
        >
          <label htmlFor="pdf-page-input" className="sr-only">
            Page number
          </label>
          <input id="pdf-page-input" className="field !min-h-11 !w-14 !px-2 text-center" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))} disabled={status !== "ready"} data-testid="pdf-page-input" />
          <span className="text-muted" data-testid="pdf-page-count">
            / {numPages || "–"}
          </span>
        </form>
        <button type="button" className={btn} onClick={() => goTo(current + 1)} disabled={status !== "ready" || current >= numPages} aria-label="Next page" data-testid="pdf-next">
          <ChevronLeftIcon size={18} className="rotate-180" />
        </button>
        <span className="mx-1 hidden h-5 w-px bg-[var(--line)] sm:block" aria-hidden="true" />
        <button type="button" className={btn} onClick={() => step(-1)} disabled={status !== "ready" || scale <= MIN_SCALE + 0.01} aria-label="Zoom out" data-testid="pdf-zoom-out">
          <ZoomOutIcon size={18} />
        </button>
        <span className="min-w-12 text-center text-xs tabular-nums text-muted" aria-live="off" data-testid="pdf-zoom-label">
          {pct}%
        </span>
        <button type="button" className={btn} onClick={() => step(1)} disabled={status !== "ready" || scale >= MAX_SCALE - 0.01} aria-label="Zoom in" data-testid="pdf-zoom-in">
          <ZoomInIcon size={18} />
        </button>
        <button type="button" className={btn} onClick={() => setZoom("fit-width")} aria-pressed={zoom === "fit-width"} aria-label="Fit width" title="Fit width" disabled={status !== "ready"} data-testid="pdf-fit-width">
          <FitWidthIcon size={18} />
        </button>
        <button type="button" className={btn} onClick={() => setZoom("fit-page")} aria-pressed={zoom === "fit-page"} aria-label="Fit page" title="Fit page" disabled={status !== "ready"} data-testid="pdf-fit-page">
          <FitPageIcon size={18} />
        </button>
        <button type="button" className={`${btn} ml-auto`} onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} disabled={status !== "ready"} data-testid="pdf-fullscreen">
          {fullscreen ? <ShrinkIcon size={18} /> : <ExpandIcon size={18} />}
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label="PDF pages. Use the arrow keys or Page Up and Page Down to scroll; plus and minus change the zoom."
        aria-busy={status === "loading"}
        className={`relative overflow-auto rounded-lg bg-[var(--surface-2)] p-3 ${fullscreen ? "min-h-0 flex-1" : "h-[min(70vh,44rem)]"}`}
      >
        {status === "loading" && (
          <div className="grid h-full min-h-48 place-items-center" role="status">
            <div className="space-y-3 text-center">
              <div className="indeterminate mx-auto w-40" aria-hidden="true" />
              <p className="text-sm text-muted">Preparing preview…</p>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="grid h-full min-h-48 place-items-center p-4 text-center" role="alert" data-testid="pdf-error">
            <div className="space-y-1">
              <p className="text-sm font-bold">The preview couldn&apos;t be shown.</p>
              <p className="text-xs text-muted">The file itself is fine to download. ({error})</p>
            </div>
          </div>
        )}
        {status === "ready" && doc && (
          <div className="space-y-3" style={{ rowGap: GAP }}>
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1;
              const size = sizes[i] ?? first;
              return (
                <div key={n} ref={(el) => void (pageRefs.current[i] = el)}>
                  <PageCanvas doc={doc} pageNumber={n} scale={scale} size={size} active={Math.abs(n - current) <= KEEP_PAGES} onSize={onSize} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted">
        <ChevronDownIcon size={12} className="shrink-0" />
        Preview rendered on your device. The downloaded PDF keeps its text selectable and searchable.
      </p>
    </section>
  );
}
