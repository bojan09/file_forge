"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { loadPdfjs } from "@/engine/pdfjs";

/** One shared queue: thumbnails render one at a time so a 300-page file never holds many bitmaps at once. */
let chain: Promise<unknown> = Promise.resolve();

export function usePdfDocument(bytes: Uint8Array | null) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        // pdf.js transfers the buffer to its worker, so it gets a copy.
        const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false });
        destroy = () => void task.destroy();
        const d = await task.promise;
        if (cancelled) return void task.destroy();
        setDoc(d);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
      setDoc(null);
    };
  }, [bytes]);
  return { doc: bytes ? doc : null, failed: bytes ? failed : false };
}

export function PageThumb({ doc, pageIndex, rotate, label }: { doc: PDFDocumentProxy | null; pageIndex: number; rotate: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !visible || drawn) return;
    let cancelled = false;
    chain = chain.then(async () => {
      if (cancelled || !canvas.current) return;
      try {
        const page = await doc.getPage(pageIndex + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 200 / Math.max(base.width, base.height)) * Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const c = canvas.current;
        if (!c || cancelled) return;
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        if (!cancelled) setDrawn(true);
      } catch {
        /* a page that cannot be drawn keeps its blank thumbnail; the tools still work on it */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, visible, drawn, pageIndex]);

  return (
    <div ref={box} className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-surface-2">
      <canvas ref={canvas} role="img" aria-label={label} className="max-h-full max-w-full rounded-sm bg-white shadow-sm transition-transform duration-200" style={{ transform: `rotate(${rotate}deg) scale(${rotate % 180 ? 0.72 : 1})`, visibility: drawn ? "visible" : "hidden" }} />
    </div>
  );
}
