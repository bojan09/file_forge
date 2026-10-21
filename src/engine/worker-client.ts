import type { WorkerRequest, WorkerResponse } from "./convert.worker";
import { FileForgeError, type RenderJob, type RenderResult, type Stage } from "./types";

let nextId = 1;
type Fallback = (job: RenderJob, onStage?: (s: Stage) => void) => Promise<RenderResult>;
let fallback: Fallback | null = null;
/** Test environments without Worker register the renderer here; the app never does (keeps the engine out of page scripts). */
export function setRenderFallback(fn: Fallback | null) {
  fallback = fn;
}
const WORKER_URL = "/workers/convert.worker.js";

/**
 * Runs the render job in a dedicated Web Worker. Aborting terminates the worker, which is the only
 * way to genuinely stop a long synchronous render.
 */
export async function renderJob(job: RenderJob, opts: { signal?: AbortSignal; onStage?: (s: Stage) => void } = {}): Promise<RenderResult> {
  const { signal, onStage } = opts;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  let worker: Worker | null = null;
  try {
    // A prebuilt, separately served bundle (scripts/build-worker.mjs): its 2 MB stays out of the page's own scripts.
    if (typeof Worker !== "undefined") worker = new Worker(WORKER_URL, { type: "module" });
  } catch {
    worker = null;
  }

  if (!worker && fallback) return fallback(job, onStage);
  if (!worker) throw new FileForgeError("unsupported", "This browser cannot run background workers, which FileForge needs to convert without freezing the page.");

  const w = worker;
  const id = nextId++;
  return new Promise<RenderResult>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      w.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "stage") onStage?.(m.stage);
      else if (m.type === "done") {
        cleanup();
        resolve(m.result);
      } else {
        cleanup();
        reject(new FileForgeError(m.code, m.message, m.retryable));
      }
    };
    w.onerror = (ev) => {
      cleanup();
      reject(new FileForgeError("worker-failed", ev.message || "The conversion worker crashed. Try again, or use a smaller file.", true));
    };
    const req: WorkerRequest = { id, job };
    w.postMessage(req);
  });
}
