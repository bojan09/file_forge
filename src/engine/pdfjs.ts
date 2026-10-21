/**
 * Loads pdf.js (legacy build, so older browsers work) with its worker served from our own origin.
 * Where there is no Worker (Node, jsdom tests) pdf.js runs its own fake worker, so no worker URL is set there.
 */
let ready = false;

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!ready) {
    if (typeof Worker !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
    ready = true;
  }
  return pdfjs;
}

export type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
