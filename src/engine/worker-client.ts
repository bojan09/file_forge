import type { WorkerRequest, WorkerResponse } from "./convert.worker";
import { FileForgeError, type RenderJob, type RenderResult, type Stage } from "./types";

let nextId = 1;

/**
 * Runs the render job in a dedicated Web Worker. Aborting terminates the worker, which is the only
 * way to genuinely stop a long synchronous render. Falls back to the main thread if workers are unavailable.
 */
export async function renderJob(job: RenderJob, opts: { signal?: AbortSignal; onStage?: (s: Stage) => void } = {}): Promise<RenderResult> {
  const { signal, onStage } = opts;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  let worker: Worker | null = null;
  try {
    if (typeof Worker !== "undefined") worker = new Worker(new URL("./convert.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }

  if (!worker) {
    const { runRender } = await import("./render");
    return runRender(job, onStage);
  }

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
