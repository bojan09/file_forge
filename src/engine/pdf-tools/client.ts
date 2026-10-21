import { FileForgeError } from "../types";
import type { ToolWorkerResponse } from "./pdf-tools.worker";
import type { ToolRequest, ToolResult } from "./run";

const WORKER_URL = "/workers/pdf-tools.worker.js";
let nextId = 1;
type Fallback = (req: ToolRequest) => Promise<ToolResult>;
let fallback: Fallback | null = null;
/** Test environments without Worker register the runner here; the app never does. */
export function setToolFallback(fn: Fallback | null) {
  fallback = fn;
}

/** Runs a PDF tool in a dedicated worker. Aborting terminates the worker, which genuinely stops the work. */
export async function runPdfTool(req: ToolRequest, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== "undefined") worker = new Worker(WORKER_URL, { type: "module" });
  } catch {
    worker = null;
  }
  if (!worker && fallback) return fallback(req);
  if (!worker) throw new FileForgeError("unsupported", "This browser cannot run background workers, which the PDF tools need.");
  const w = worker;
  const id = nextId++;
  return new Promise<ToolResult>((resolve, reject) => {
    const onAbort = () => {
      w.terminate();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      w.terminate();
    };
    w.onmessage = (e: MessageEvent<ToolWorkerResponse>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.type === "done") resolve(e.data.result);
      else reject(new FileForgeError(e.data.code, e.data.message));
    };
    w.onerror = () => {
      done();
      reject(new FileForgeError("worker-failed", "The PDF tool stopped unexpectedly. Try again with fewer or smaller files.", true));
    };
    w.postMessage({ id, req });
  });
}
